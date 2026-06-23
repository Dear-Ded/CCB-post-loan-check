const fs = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("playwright");
const { AuditLog } = require("./framework/audit");
const { SearchManager } = require("./framework/search_manager");
const { SessionManager } = require("./framework/session_manager");
const { TaskQueue } = require("./framework/task_queue");
const { SourceStateStore } = require("./framework/source_state_store");
const { DataSourceRegistry } = require("./framework/data_source_registry");
const { buildSubjectGraph } = require("./framework/subject_graph");
const { resolveInvestigationMode } = require("./framework/investigation_mode");
const { loadRuntimePolicy, browserCompatibilityArgs } = require("./framework/runtime_policy");
const { ChallengeMode } = require("./framework/challenge_policy");
const { ChallengeEngine } = require("./framework/challenge_engine");
const { JudicialSourcePolicy } = require("./framework/judicial_sources");
const { buildRequiredEvidence, assertRequiredEvidence } = require("./framework/evidence_contract");
const { JudicialRunScheduler } = require("./framework/judicial_run_scheduler");
const {
  ENFORCEMENT_ROUTES,
  JUDGMENT_ROUTES
} = require("./framework/judicial_routes");
const {
  attachEnforcementResponseAudit,
  getEnforcementDiagnosticState,
  getCaptchaState,
  isCaptchaFailure: isEnforcementCaptchaFailure,
  isResultState: isEnforcementModuleResultState,
  waitForCaptchaChange
} = require("./framework/enforcement_source");
const { classifyOfficialPageProbe } = require("./framework/judicial_diagnostics");

function parseArgs(argv) {
  const out = { person: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    const value = next && !next.startsWith("--") ? next : true;
    if (key === "person") out.person.push(value);
    else out[key] = value;
    if (value === next) i += 1;
  }
  return out;
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeStage(message) {
  const file = process.env.POST_LOAN_STAGE_LOG;
  const line = `${new Date().toISOString()}\t${message}\n`;
  if (file) {
    try { fs.appendFileSync(file, line, "utf8"); } catch {}
  }
  console.log(message);
}

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function envChoice(name, fallback) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  return value || fallback;
}

async function waitUntil(page, label, predicate, timeoutMs = 10 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate().catch(() => false)) return true;
    if (page.isClosed && page.isClosed()) throw new Error(`Page closed while waiting for ${label}`);
    await page.waitForTimeout(1500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function withTimeout(label, timeoutMs, task) {
  let timer = null;
  const controller = new AbortController();
  try {
    return await Promise.race([
      task(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

async function gotoWithRetries(page, url, label, attempts = 5) {
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      if (page.isClosed && page.isClosed()) throw new Error(`${label} page is closed before navigation`);
      await goto(page, url);
      const text = await pageText(page);
      if (text && !/网络不给力|访问异常|系统繁忙|服务异常|502|503|504/.test(text)) return;
      lastError = new Error(`${label} returned an abnormal or blank page`);
    } catch (error) {
      lastError = error;
    }
    if (i < attempts) {
      console.log(`${label} 加载失败或异常，正在第 ${i + 1}/${attempts} 次重试...`);
    }
    if (page.isClosed && page.isClosed()) throw lastError || new Error(`${label} page was closed`);
    await page.waitForTimeout(1500 * i);
  }
  throw lastError || new Error(`${label} failed to load`);
}

function baiduUrl(query, pn = 0) {
  return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&pn=${pn}`;
}

function bingUrl(query) {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
}

function bingPageUrl(query, pageNo) {
  const first = (pageNo - 1) * 10 + 1;
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${first}`;
}

const searchEngines = [
  {
    id: "baidu",
    name: "百度搜索",
    url: (query, pageNo) => baiduUrl(query, (pageNo - 1) * 10),
    validUrl: (url) => url.includes("baidu.com/s")
  },
  {
    id: "so360",
    name: "360搜索",
    url: (query, pageNo) => `https://www.so.com/s?q=${encodeURIComponent(query)}&pn=${pageNo}`,
    validUrl: (url) => url.includes("so.com/s")
  },
  {
    id: "sogou",
    name: "搜狗搜索",
    url: (query, pageNo) => `https://www.sogou.com/web?query=${encodeURIComponent(query)}&page=${pageNo}`,
    validUrl: (url) => url.includes("sogou.com/web")
  },
  {
    id: "bing",
    name: "Bing搜索",
    url: (query, pageNo) => bingPageUrl(query, pageNo),
    validUrl: (url) => url.includes("bing.com/search")
  }
];

async function pageText(page) {
  return (await page.locator("body").innerText({ timeout: 3000 }).catch(() => "")).replace(/\s+/g, " ");
}

async function isSearchVerificationPage(page, engine) {
  const url = page.url();
  const text = await pageText(page);
  const signal = `${url} ${text}`.replace(/\s+/g, "");
  return /wappass\.baidu\.com|passport\.baidu\.com|captcha|verify|unusualtraffic|安全验证|百度安全验证|请输入验证码|人机验证|验证你不是机器人|网络不给力|访问异常|系统检测到|异常流量|访问过于频繁/.test(signal);
}

async function screenshot(page, file, scrollY = 0) {
  await page.evaluate((y) => window.scrollTo(0, y), scrollY).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: file, fullPage: false });
}

async function capture(page, shots, name, file, scrollY = 0, options = {}) {
  await screenshot(page, file, scrollY);
  const text = await pageText(page);
  const url = page.url();
  const entry = {
    slot: shots.length + 1,
    name,
    screenshot: file,
    text,
    url,
    validation: validateCapture(name, text, url, options)
  };
  if (!entry.validation.ok && !options.keepInvalid) {
    fs.rmSync(file, { force: true });
    if (options.audit) {
      options.audit.record("invalid_capture_rejected", {
        name,
        url,
        problems: entry.validation.problems
      });
    }
    return null;
  }
  shots.push(entry);
  return entry;
}

async function tryCapturePortal(page, shots, name, file, url, scrollY = 0, options = {}) {
  try {
    await goto(page, url);
    const shot = await capture(page, shots, name, file, scrollY, options);
    if (!shot) return { ok: false, name, url, file, error: "capture_validation_failed" };
    return { ok: true, name, url, file };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    console.log(`${name} 抓取失败，尝试其他入口或等待回补：${message}`);
    return { ok: false, name, url, error: message };
  }
}

function isUsefulPortalCapture(result, company) {
  if (!result?.ok) return false;
  const shot = result.shot;
  if (!shot) return true;
  if (!shot.validation?.ok) return false;
  const text = String(shot.text || "");
  return text.includes(company) || !result.requireSubjectMatch;
}

async function tryCapturePortalCandidates(pageOrContext, shots, name, candidates, audit, company, add) {
  const startedCount = shots.length;
  const attempts = [];
  const context = typeof pageOrContext.newPage === "function" ? pageOrContext : null;
  for (const candidate of candidates) {
    const page = context ? await context.newPage() : pageOrContext;
    const file = candidate.file || add(candidate.name || name);
    const beforeCount = shots.length;
    try {
      const result = await tryCapturePortal(page, shots, candidate.name || name, file, candidate.url, candidate.scrollY || 0, candidate.options || {});
      const shot = shots[shots.length - 1];
      result.shot = shots.length > beforeCount ? shot : null;
      result.requireSubjectMatch = Boolean(candidate.requireSubjectMatch);
      attempts.push({
        label: candidate.name || name,
        url: candidate.url,
        ok: result.ok,
        validationOk: result.shot?.validation?.ok,
        subjectMatched: result.shot ? String(result.shot.text || "").includes(company) : false,
        error: result.error || ""
      });
      if (isUsefulPortalCapture(result, company)) {
        audit?.record("portal_candidate_selected", { name, company, attempts });
        return result;
      }
      if (shots.length > beforeCount) {
        shots.splice(beforeCount, shots.length - beforeCount);
        try { fs.unlinkSync(file); } catch {}
      }
    } finally {
      if (context) await page.close().catch(() => {});
    }
  }
  audit?.record("portal_candidates_failed", { name, company, attempts });
  throw new Error(`${name} all portal candidates failed: ${attempts.map((item) => `${item.label}:${item.error || "not_validated"}`).join("; ")}`);
}

async function captureCompleteScroll(page, shots, add, baseName) {
  const beforeCount = shots.length;
  const metrics = await page.evaluate(() => ({
    scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    viewportHeight: window.innerHeight
  })).catch(() => ({ scrollHeight: 755, viewportHeight: 755 }));
  const step = Math.max(320, Math.floor(metrics.viewportHeight * 0.82));
  const positions = [];
  for (let y = 0; y < metrics.scrollHeight; y += step) positions.push(y);
  const last = Math.max(0, metrics.scrollHeight - metrics.viewportHeight);
  if (!positions.includes(last)) positions.push(last);
  const deduped = [...new Set(positions)].sort((a, b) => a - b);
  for (let i = 0; i < deduped.length; i += 1) {
    const suffix = deduped.length === 1 ? "" : `-${i + 1}`;
    const file = add(`${baseName}${suffix}`);
    await capture(page, shots, `${baseName}${suffix}`, file, deduped[i]);
  }
  return shots.slice(beforeCount);
}

async function captureSearchEvidence(page, shots, add, company) {
  const query = company;
  const companyTerms = company
    .replace(/[（）()]/g, " ")
    .replace(/有限公司|股份|集团|分行|公司/g, " ")
    .split(/\s+/)
    .flatMap((part) => part.length > 4 ? [part, part.slice(0, 2), part.slice(2, 4)] : [part])
    .filter((part) => part && part.length >= 2);
  for (const engine of searchEngines) {
    let captured = 0;
    let blocked = false;
    for (const pageNo of [1, 2, 3]) {
      try {
        await page.goto(engine.url(query, pageNo), { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(600);
      } catch (error) {
        console.log(`${engine.name} page ${pageNo} failed to load; trying next search source.`);
        blocked = true;
        break;
      }
      const text = await pageText(page);
      const termHits = companyTerms.filter((term) => text.includes(term)).length;
      const subjectMatched = text.includes(company) || termHits >= Math.min(2, companyTerms.length);
      if (!engine.validUrl(page.url()) || await isSearchVerificationPage(page, engine.id) || !subjectMatched) {
        console.log(`${engine.name} page ${pageNo} is not a valid subject result page; trying next search source.`);
        blocked = true;
        break;
      }
      await captureCompleteScroll(page, shots, add, `${engine.name}-page-${pageNo}`);
      captured += 1;
    }
    if (!blocked && captured > 0) return;
  }
  console.log("No complete same-engine subject search evidence was captured in this run.");
}

function safePart(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 80);
}

function envDisabled(...names) {
  return names.some((name) => /^(1|true|yes|on)$/i.test(String(process.env[name] || "")));
}

function envNumber(names, fallback) {
  for (const name of names) {
    const value = Number(process.env[name]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return fallback;
}

function makeAdd(outDir, shots) {
  return (name) => path.join(outDir, `${String(shots.length + 1).padStart(2, "0")}-${safePart(name)}.png`);
}

function discardCaptures(shots, entries) {
  const discardSet = new Set(entries);
  for (const item of entries) {
    if (item?.screenshot) fs.rmSync(item.screenshot, { force: true });
  }
  for (let i = shots.length - 1; i >= 0; i -= 1) {
    if (discardSet.has(shots[i])) shots.splice(i, 1);
  }
}

async function saveOfficialPageDiagnostic(page, outDir, label, audit, metadata = {}) {
  if (!page || page.isClosed?.() || !outDir) return null;
  const url = page.url();
  if (!/wenshu\.court\.gov\.cn|zxgk\.court\.gov\.cn/.test(url)) return null;
  const diagnosticDir = path.join(outDir, "_official-page-diagnostics");
  fs.mkdirSync(diagnosticDir, { recursive: true });
  const base = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safePart(label)}`;
  const screenshot = path.join(diagnosticDir, `${base}.png`);
  const html = path.join(diagnosticDir, `${base}.html`);
  const meta = path.join(diagnosticDir, `${base}.json`);
  const title = await page.title().catch(() => "");
  const text = await pageText(page).catch(() => "");
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => null);
  fs.writeFileSync(html, await page.content().catch(() => ""), "utf8");
  fs.writeFileSync(meta, JSON.stringify({
    label,
    url,
    title,
    textSample: text.slice(0, 500),
    savedAt: new Date().toISOString(),
    ...metadata
  }, null, 2), "utf8");
  audit?.record("official_page_diagnostic_saved", {
    label,
    url,
    screenshot,
    html,
    meta,
    ...metadata
  });
  return { screenshot, html, meta };
}

function parsePerson(value) {
  const [name, idNumber] = String(value).split("|");
  if (!name || !idNumber) throw new Error(`Invalid --person value. Use "name|idNumber": ${value}`);
  return { name, idNumber };
}

function findCreditCodes(text) {
  return [...new Set(String(text).match(/\b[0-9A-Z]{18}\b/g) || [])]
    .filter((code) => /^[0-9A-Z]{2}[0-9A-Z]{6}[0-9A-Z]{9}[0-9A-Z]$/.test(code));
}

async function lookupOrgCode(context, company) {
  const page = await context.newPage();
  try {
    const queries = [
      `"${company}" "统一社会信用代码"`,
      `${company} 统一社会信用代码`,
      `${company} 工商信息 统一社会信用代码`
    ];
    for (const query of queries) {
      for (const url of [bingUrl(query), baiduUrl(query, 0)]) {
        await goto(page, url);
        const text = await pageText(page);
        if (!text.includes(company)) continue;
        const codes = findCreditCodes(text);
        if (codes.length === 1) return { code: codes[0], source: page.url(), ambiguous: false };
        if (codes.length > 1) return { code: codes[0], source: page.url(), ambiguous: true, candidates: codes };
      }
    }
    return { code: "", source: "", ambiguous: false };
  } finally {
    await page.close().catch(() => {});
  }
}

function validateCapture(name, text, url, options = {}) {
  const compact = String(text || "").replace(/\s+/g, "");
  const problems = [];
  if (!compact) problems.push("empty_page_text");
  const pageSignal = `${url} ${compact}`;
  const isCourtOrEnforcement = url.includes("wenshu.court.gov.cn") || url.includes("zxgk.court.gov.cn");
  const isSearchResult =
    url.includes("baidu.com/s") ||
    url.includes("bing.com/search") ||
    url.includes("so.com/s") ||
    url.includes("sogou.com/web");
  if (/login|passport|verify|captcha|安全验证|访问异常|异常流量|unusualtraffic/i.test(pageSignal)) {
    problems.push("login_challenge_or_abnormal_page");
  }
  if (!isCourtOrEnforcement && !isSearchResult && /登录|请登录|login/i.test(pageSignal)) {
    problems.push("login_page");
  }
  if (url.includes("wappass.baidu.com") || url.includes("passport.baidu.com")) {
    problems.push("search_engine_challenge_page");
  }
  if (url.includes("wenshu.court.gov.cn") && options.company) {
    const hasSubject = compact.includes(String(options.company).replace(/\s+/g, ""));
    const hasResultState = /暂无数据|未检索到|检索结果|搜索结果|裁判日期/.test(compact);
    if (!hasSubject && !hasResultState) problems.push("judgment_subject_result_not_confirmed");
  }
  if (url.includes("zxgk.court.gov.cn") && !options.enforcementValidated) {
    problems.push("enforcement_result_not_confirmed");
  }
  return { ok: problems.length === 0, problems };
}

function hasJudgmentResultState(text) {
  return /暂无数据|未检索到|检索结果|搜索结果|查询结果|共检索到|裁判日期|案件名称|案号|法院层级|文书类型|审判程序/.test(String(text || ""));
}

async function getEnforcementFields(page) {
  return page.evaluate(() => ({
    name: document.querySelector("#pName")?.value || "",
    card: document.querySelector("#pCardNum")?.value || "",
    captcha: document.querySelector("#yzm")?.value || ""
  })).catch(() => ({ name: "", card: "", captcha: "" }));
}

async function fillAndVerifyEnforcementFields(page, name, codeOrId) {
  const delayMs = Math.max(0, Number(process.env.POST_LOAN_FORM_TYPE_DELAY_MS || 45));
  async function fillField(selector, value) {
    const target = page.locator(selector).first();
    await target.click({ clickCount: 3 }).catch(() => {});
    await page.waitForTimeout(Math.max(80, delayMs * 2));
    await target.fill("").catch(() => {});
    if (delayMs > 0) {
      await target.pressSequentially(String(value), { delay: delayMs }).catch(async () => {
        await target.fill(String(value));
      });
    } else {
      await target.fill(String(value)).catch(() => {});
    }
    await page.evaluate(({ selector, value }) => {
      const node = document.querySelector(selector);
      if (!node) return;
      node.value = value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.dispatchEvent(new Event("blur", { bubbles: true }));
    }, { selector, value: String(value) }).catch(() => {});
    await page.waitForTimeout(Math.max(120, delayMs * 2));
  }
  await fillField("#pName", name);
  await fillField("#pCardNum", codeOrId);
  await waitUntil(page, `enforcement fields for ${name}`, async () => {
    const fields = await getEnforcementFields(page);
    return fields.name.trim() === name && fields.card.trim() === codeOrId;
  }, 20000);
}

function sameCaptchaDigest(a, b) {
  if (!a?.ok || !b?.ok) return true;
  return a.sha256 === b.sha256 && a.bytes === b.bytes;
}

async function waitForStableCaptchaInput(page, subjectName, options = {}) {
  const defaultWait = options.noPrompt ? 1000 : 45000;
  const captchaWaitMs = Number(process.env.POST_LOAN_CAPTCHA_INPUT_WAIT_MS || defaultWait);
  await waitUntil(page, `China Enforcement captcha input for ${subjectName}`, async () => {
    const value = await page.locator("#yzm").inputValue().catch(() => "");
    return value.trim().length >= 4;
  }, captchaWaitMs);
  let previous = "";
  for (let i = 0; i < 8; i += 1) {
    const current = await page.locator("#yzm").inputValue().catch(() => "");
    if (current.trim().length >= 4 && current === previous) return current.trim();
    previous = current;
    await page.waitForTimeout(250);
  }
  return previous.trim();
}

function isCaptchaFailure(text) {
  const imageTextCode = ["验", "证", "码"].join("");
  return new RegExp(`${imageTextCode}.*(错误|不正确|有误|失效|为空)|校验码.*(错误|不正确|有误)|请输入.*${imageTextCode}|${imageTextCode}不能为空|确认项.*(错误|失效|为空)`).test(text);
}

function isEnforcementResultState(text) {
  return /查询结果|未查询到|暂无数据|没有找到|无符合条件|没有符合条件|无相关信息|查询无结果|案号|执行法院|立案时间|执行标的/.test(text);
}

async function navigateFromEnforcementHome(page, label, audit, routeId = "") {
  const readyNow = await page.locator("#pName").first().isVisible({ timeout: 1000 }).catch(() => false);
  const challengeNow = await page.locator("#yzm").first().isVisible({ timeout: 1000 }).catch(() => false);
  if (readyNow && challengeNow) return false;
  const entrySelectors = routeId === "shixin_query"
    ? ["a[href*='shixin/']", "a:has-text('失信被执行人')", "text=失信被执行人"]
    : routeId === "zhixing_query"
      ? ["a[href*='zhixing/']", "a:has-text('被执行人信息')", "text=被执行人信息"]
      : ["a[href*='zhzxgk/']", "a:has-text('执行综合查询')", "text=执行综合查询"];
  for (const selector of entrySelectors) {
    const target = page.locator(selector).first();
    if (!(await target.isVisible({ timeout: 1000 }).catch(() => false))) continue;
    audit?.record("enforcement_home_entry_selected", {
      label,
      selector,
      url: page.url()
    });
    const href = await target.getAttribute("href").catch(() => "");
    if (href) {
      await goto(page, new URL(href, page.url()).toString());
    } else {
      await target.click().catch(() => {});
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2500);
    return true;
  }
  const direct = routeId === "shixin_query"
    ? "https://zxgk.court.gov.cn/shixin/"
    : routeId === "zhixing_query"
      ? "https://zxgk.court.gov.cn/zhixing/"
      : "https://zxgk.court.gov.cn/zhzxgk/";
  if (page.url().startsWith("https://zxgk.court.gov.cn/")) {
    audit?.record("enforcement_home_entry_selected", {
      label,
      selector: "direct_query_url",
      url: page.url()
    });
    await goto(page, direct).catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2500);
    return true;
  }
  return false;
}

async function enforcementPageProbe(page) {
  const text = await pageText(page);
  const diagnostic = await getEnforcementDiagnosticState(page).catch(() => null);
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    textSample: text.slice(0, 300),
    hasNameField: await page.locator("#pName").first().isVisible({ timeout: 500 }).catch(() => false),
    hasChallengeField: await page.locator("#yzm").first().isVisible({ timeout: 500 }).catch(() => false),
    diagnostic
  };
}

async function waitForEnforcementReady(page, label, audit, options = {}) {
  const maxAttempts = Number(options.readyAttempts || process.env.POST_LOAN_ENFORCEMENT_READY_ATTEMPTS || 3);
  const loadTimeoutMs = Number(process.env.POST_LOAN_ENFORCEMENT_LOAD_TIMEOUT_MS || (options.noPrompt ? 4000 : 8000));
  const fieldTimeoutMs = Number(process.env.POST_LOAN_ENFORCEMENT_FIELD_TIMEOUT_MS || (options.noPrompt ? 2500 : 8000));
  const settleMs = Number(process.env.POST_LOAN_ENFORCEMENT_SETTLE_MS || (options.noPrompt ? 700 : 2500));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await page.waitForLoadState("domcontentloaded", { timeout: loadTimeoutMs }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: loadTimeoutMs }).catch(() => {});
    await page.waitForTimeout(settleMs);
    const alreadyReady = await page.locator("#pName").first().isVisible({ timeout: 1500 }).catch(() => false);
    const challengeReady = await page.locator("#yzm").first().isVisible({ timeout: 1500 }).catch(() => false);
    const bodyText = await pageText(page).catch(() => "");
    if (alreadyReady && challengeReady) {
      page.__postLoanEnforcementRoute = page.__postLoanEnforcementRoute || "current_page";
      return;
    }
    if (/被执行人姓名\/名称|身份证号码\/组织机构代码|验证码|全国法院信息综合查询|综合查询/.test(bodyText)) {
      await page.waitForTimeout(2200);
      const pNameVisible = await page.locator("#pName").first().isVisible({ timeout: 3000 }).catch(() => false);
      const captchaVisible = await page.locator("#yzm").first().isVisible({ timeout: 3000 }).catch(() => false);
      if (pNameVisible && captchaVisible) {
        page.__postLoanEnforcementRoute = page.__postLoanEnforcementRoute || "home_text_ready";
        return;
      }
    }

    const route = ENFORCEMENT_ROUTES[(attempt - 1) % ENFORCEMENT_ROUTES.length];
    writeStage(`${label} loading route ${route.id} (${attempt}/${maxAttempts})`);
    await gotoWithRetries(page, route.url(), `${label} ${route.id}`, 1).catch(() => {});
    if (route.id.includes("home")) {
      await navigateFromEnforcementHome(page, label, audit, route.id).catch(() => false);
    }
    await page.waitForLoadState("domcontentloaded", { timeout: loadTimeoutMs }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: loadTimeoutMs }).catch(() => {});
    await page.waitForTimeout(settleMs);
    const formReady = await page.locator("#pName").first().isVisible({ timeout: fieldTimeoutMs }).catch(() => false);
    const captchaReady = await page.locator("#yzm").first().isVisible({ timeout: fieldTimeoutMs }).catch(() => false);
    if (formReady && captchaReady) {
      page.__postLoanEnforcementRoute = route.id;
      return;
    }

    const text = await pageText(page);
    const probe = await enforcementPageProbe(page).catch((error) => ({ error: String(error.message || error), textSample: text.slice(0, 300) }));
    const category = classifyOfficialPageProbe(probe);
    const routeLooksUnusable = !formReady && !captchaReady && (
      String(probe.textSample || text || "").trim().length < 20 ||
      /400|403|Forbidden|Bad Request|页面不存在|访问异常|系统繁忙|Service Unavailable/i.test(`${probe.title || ""} ${probe.textSample || ""}`)
    );
    if (routeLooksUnusable) {
      audit?.record("enforcement_official_route_unusable", {
        label,
        attempt,
        route: route.id,
        category,
        probe
      });
      await saveOfficialPageDiagnostic(page, options.outDir, `zxgk-${route.id}-attempt-${attempt}`, audit, {
        label,
        route: route.id,
        attempt,
        reason: "route_unusable_or_blank"
      }).catch(() => null);
      if (attempt < maxAttempts) continue;
    }
    if (/登录|请登录|用户登录/.test(text)) {
      console.log(`${label} authorization session is not ready; waiting for the prepared browser session to become available.`);
      await waitUntil(page, `${label} login/form ready`, async () => {
        const body = await pageText(page);
        const pNameVisible = await page.locator("#pName").first().isVisible({ timeout: 1000 }).catch(() => false);
        const captchaVisible = await page.locator("#yzm").first().isVisible({ timeout: 1000 }).catch(() => false);
        return (pNameVisible && captchaVisible) || (!/登录|请登录|用户登录/.test(body) && pNameVisible);
      }, Number(process.env.POST_LOAN_LOGIN_WAIT_MS || 120000));
      const pNameVisible = await page.locator("#pName").first().isVisible({ timeout: 3000 }).catch(() => false);
      const captchaVisible = await page.locator("#yzm").first().isVisible({ timeout: 3000 }).catch(() => false);
      if (pNameVisible && captchaVisible) return;
    }

    if (attempt < maxAttempts) {
      console.log(`${label} query page is not ready; retrying ${attempt + 1}/${maxAttempts}.`);
    }
    const failedProbe = await enforcementPageProbe(page).catch((error) => ({ error: String(error.message || error) }));
      audit?.record("enforcement_ready_probe_failed", {
        label,
        attempt,
        route: route.id,
        category: classifyOfficialPageProbe(failedProbe),
        probe: failedProbe
      });
    await page.waitForTimeout((options.noPrompt ? 1000 : 4000) * attempt);
  }
  throw new Error(`${label} query page failed to load required subject and challenge fields.`);
}

async function fillEnforcementQuery(page, name, codeOrId, options = {}) {
  await waitForEnforcementReady(page, `China Enforcement ${name}`, global.__postLoanAudit, options);
  await fillAndVerifyEnforcementFields(page, name, codeOrId);
  await page.locator("#yzm").click().catch(() => {});
}

async function clickEnforcementSearch(page) {
  const selectors = [
    "button.btn-zxgk",
    "button:has-text('查询')",
    "input[type=button][value*='查询']",
    "a:has-text('查询')"
  ];
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    if (await target.isVisible({ timeout: 1000 }).catch(() => false)) {
      await target.click();
      return;
    }
  }
  await page.keyboard.press("Enter");
}

function judgmentSearchInput(page) {
  return page.locator([
    "input.searchKey.search-inp",
    "input.searchKey",
    "#searchKey",
    "#query",
    "input[name='searchWord']",
    "input[name='keyWord']",
    "input[placeholder*='输入案由']",
    "input[placeholder*='全文检索']",
    "input[placeholder*='关键词']"
  ].join(", ")).first();
}

async function hasVisibleJudgmentSearchInput(page) {
  return judgmentSearchInput(page).isVisible({ timeout: 1200 }).catch(() => false);
}

async function isJudgmentLoginPage(page, text = "") {
  if (await hasVisibleJudgmentSearchInput(page)) return false;
  const title = await page.title().catch(() => "");
  const signal = `${page.url()} ${title} ${text}`.replace(/\s+/g, "");
  return /181010CARHS5BS3C|登录\/注册|返回首页注册|用户登录|请登录/.test(signal);
}

async function waitForJudgmentResultPage(page, company, beforeUrl, timeoutMs = 30000) {
  await waitUntil(page, "judgment search result page", async () => {
    const text = await pageText(page);
    if (await isJudgmentLoginPage(page, text)) return false;
    const compact = text.replace(/\s+/g, "");
    const hasSubject = compact.includes(String(company || "").replace(/\s+/g, ""));
    const hasResultState = hasJudgmentResultState(compact);
    const movedFromHome = beforeUrl && page.url() !== beforeUrl && !/\/$/.test(page.url());
    return page.url().includes("wenshu.court.gov.cn") && (hasSubject || hasResultState || (movedFromHome && hasResultState));
  }, timeoutMs);
}

async function fillAndSearchJudgments(page, company, audit, options = {}) {
  const resultWaitMs = Number(options.resultWaitMs || process.env.POST_LOAN_JUDGMENT_RESULT_WAIT_MS || 12000);
  const initialText = await pageText(page);
  if (page.url().includes("wenshu.court.gov.cn") && (initialText.includes(company) || hasJudgmentResultState(initialText))) {
    return;
  }
  if (await isJudgmentLoginPage(page, initialText)) {
    throw new Error("China Judgments Online login page reached before search");
  }
  const beforeUrl = page.url();
  const searchInput = judgmentSearchInput(page);
  await searchInput.waitFor({ state: "visible", timeout: 15000 });
  await searchInput.click({ clickCount: 3 }).catch(() => {});
  await searchInput.fill("").catch(() => {});
  await searchInput.type(company, { delay: 35 }).catch(async () => {
    await searchInput.fill(company);
  });
  await page.evaluate((subject) => {
    const inputs = [...document.querySelectorAll("input.searchKey.search-inp, input.searchKey, input[type='text']")];
    const target = inputs.find((node) => /输入案由|全文检索|关键词|法院|当事人|律师/.test(node.placeholder || "")) || inputs[0];
    if (!target) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    target.focus();
    if (setter) setter.call(target, subject);
    else target.value = subject;
    for (const type of ["keydown", "keypress", "input", "keyup", "change", "blur"]) {
      target.dispatchEvent(new Event(type, { bubbles: true }));
    }
  }, company).catch(() => {});
  await waitUntil(page, "judgment search input filled", async () => {
    const value = await searchInput.inputValue().catch(() => "");
    return value.trim() === company || value.includes(company);
  }, 10000);
  const searchButtons = [
    ".search-rightBtn.search-click",
    ".search-click",
    "#searchBtn",
    ".searchBtn",
    ".search-btn",
    "button:has-text('搜索')",
    "div:has-text('搜索')",
    "a:has-text('搜索')",
    "input[type=button][value*='搜索']",
    "input[type=submit][value*='搜索']",
    "text=搜索"
  ];
  for (const selector of searchButtons) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      audit?.record("judgment_home_search_submit", {
        company,
        selector,
        beforeUrl,
        inputValue: await searchInput.inputValue().catch(() => "")
      });
      await Promise.allSettled([
        page.waitForLoadState("domcontentloaded", { timeout: 12000 }),
        page.waitForLoadState("networkidle", { timeout: 15000 }),
        button.click({ delay: 80 })
      ]);
      await waitForJudgmentResultPage(page, company, beforeUrl, resultWaitMs).catch(() => {});
      return;
    }
  }
  await page.keyboard.press("Enter");
  await waitForJudgmentResultPage(page, company, beforeUrl, resultWaitMs).catch(() => {});
}

async function captureJudgmentPortal(page, shots, add, company, audit, scheduler, options = {}) {
  const attempts = Number(options.attempts || 3);
  const settleBaseMs = Number(options.settleBaseMs || 3000);
  const browserContext = page.context();
  let currentPage = page;
  return scheduler.runWithRetries("judicial_wenshu", attempts, async (attempt) => {
    writeStage(`judgment capture attempt ${attempt}`);
    const file = add("中国裁判文书网");
    const route = JUDGMENT_ROUTES[(attempt - 1) % JUDGMENT_ROUTES.length];
    audit?.record("judgment_route_selected", { company, attempt, route: route.id });
    if (!currentPage || currentPage.isClosed()) currentPage = await browserContext.newPage();
    try {
      if (route.id === "wenshu_home") {
        await goto(currentPage, route.url(company));
        await currentPage.locator("input.searchKey, #searchKey, input[placeholder*='输入案由'], input[placeholder*='关键词'], input[type='text']").first()
          .waitFor({ state: "visible", timeout: 12000 })
          .catch(() => {});
      } else {
        await gotoWithRetries(currentPage, route.url(company), `China Judgments Online ${company} ${route.id}`, 2);
      }
      writeStage(`judgment route loaded ${route.id}`);
      const beforeSearchText = await pageText(currentPage);
      if (!await isJudgmentLoginPage(currentPage, beforeSearchText)) {
        await fillAndSearchJudgments(currentPage, company, audit, {
          resultWaitMs: Number(options.resultWaitMs || process.env.POST_LOAN_JUDGMENT_RESULT_WAIT_MS || 12000)
        });
      }
      await currentPage.waitForTimeout(settleBaseMs + attempt * 1000);
      const judgmentShot = await capture(currentPage, shots, "中国裁判文书网", file, 0, { company, audit });
      if (!judgmentShot) {
        await saveOfficialPageDiagnostic(currentPage, options.outDir, `wenshu-${route.id}-attempt-${attempt}`, audit, {
          company,
          route: route.id,
          attempt,
          error: "result_page_not_validated"
        }).catch(() => null);
        throw new Error("China Judgments Online result page was not validated");
      }
      return judgmentShot;
    } catch (error) {
      await saveOfficialPageDiagnostic(currentPage, options.outDir, `wenshu-${route.id}-attempt-${attempt}-failed`, audit, {
        company,
        route: route.id,
        attempt,
        error: String(error.message || error)
      }).catch(() => null);
      if (/Target page|context or browser has been closed|frame was detached|ERR_ABORTED|page is closed|page was closed/i.test(String(error.message || error))) {
        await currentPage.close().catch(() => {});
        currentPage = await browserContext.newPage();
      }
      throw error;
    }
  }, { signal: options.signal, ignoreCooldown: Boolean(options.ignoreCooldown) });
}

async function warmOfficialJudicialOrigins(context, audit, options = {}) {
  const urls = [
    ...JUDGMENT_ROUTES.map((route) => route.url("")),
    ...ENFORCEMENT_ROUTES.map((route) => route.url())
  ];
  const timeoutMs = Number(options.timeoutMs || 15000);
  const page = await context.newPage();
  const results = [];
  try {
    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        const text = await pageText(page).catch(() => "");
        results.push({
          url,
          ok: true,
          finalUrl: page.url(),
          title: await page.title().catch(() => ""),
          hasEnforcementForm: await page.locator("#pName").first().isVisible({ timeout: 300 }).catch(() => false),
          textSample: text.slice(0, 120)
        });
      } catch (error) {
        results.push({ url, ok: false, error: String(error.message || error) });
      }
      await page.waitForTimeout(500);
    }
  } finally {
    await page.close().catch(() => {});
  }
  audit?.record("official_judicial_origins_warmed", { results });
  return results;
}

async function installOfficialPortalRequestCompatibility(context, audit) {
  if (envFlag("POST_LOAN_DISABLE_OFFICIAL_HEADER_COMPAT", false)) {
    audit?.record("official_portal_request_header_compat_disabled", { domain: "zxgk.court.gov.cn" });
    return;
  }
  let logged = 0;
  await context.route("**://zxgk.court.gov.cn/**", async (route) => {
    const request = route.request();
    const headers = { ...request.headers() };
    const removed = [];
    for (const key of Object.keys(headers)) {
      if (/^sec-fetch-/i.test(key)) {
        removed.push(key);
        delete headers[key];
      }
    }
    if (removed.length && logged < 12) {
      logged += 1;
      audit?.record("official_portal_request_header_compat", {
        domain: "zxgk.court.gov.cn",
        url: request.url(),
        removed
      });
    }
    await route.continue({ headers });
  });
}

async function getCaptchaSignature(page) {
  const state = await getCaptchaState(page);
  return `${state.imageSrc}|${state.imageComplete}|${state.imageSize}|${state.hidden}`;
}

async function prepareEnforcementChallenge(page, subjectName, codeOrId, audit) {
  await waitForEnforcementReady(page, `China Enforcement ${subjectName}`, audit);
  await fillAndVerifyEnforcementFields(page, subjectName, codeOrId);
  await page.locator("#yzm").click().catch(() => {});
  const diagnostic = await getEnforcementDiagnosticState(page);
  audit?.record("enforcement_diagnostic_prepared", {
    subjectName,
    state: diagnostic
  });
  return diagnostic;
}

async function resetEnforcementCaptcha(page, subjectName, codeOrId, audit) {
  console.log(`China Enforcement ${subjectName}: refreshing page challenge and restoring query fields.`);
  audit?.record("enforcement_captcha_reset_started", { subjectName });
  await waitForEnforcementReady(page, `China Enforcement ${subjectName}`, audit);
  await fillAndVerifyEnforcementFields(page, subjectName, codeOrId);
  await page.locator("#yzm").fill("").catch(() => {});
  const beforeDiagnostic = await getEnforcementDiagnosticState(page);
  const beforeState = beforeDiagnostic.captcha;
  audit?.record("enforcement_diagnostic_before_refresh", {
    subjectName,
    state: beforeDiagnostic
  });
  audit?.record("enforcement_captcha_state_before_refresh", { subjectName, state: beforeState });
  const captchaImage = page.locator("img[src*='captcha'], img[src*='verify'], img[src*='code'], #captchaImg, .captcha img").first();
  if (await captchaImage.isVisible({ timeout: 1000 }).catch(() => false)) {
    await captchaImage.click({ force: true }).catch(() => {});
  } else {
    await page.keyboard.press("Control+R").catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    await waitForEnforcementReady(page, `China Enforcement ${subjectName}`, audit);
    await fillAndVerifyEnforcementFields(page, subjectName, codeOrId);
  }
  const afterState = await waitForCaptchaChange(page, beforeState, 8000, beforeDiagnostic.captchaDigest);
  await fillAndVerifyEnforcementFields(page, subjectName, codeOrId);
  const afterDiagnostic = await getEnforcementDiagnosticState(page);
  audit?.record("enforcement_captcha_reset_completed", { subjectName, state: afterState });
  audit?.record("enforcement_diagnostic_after_refresh", {
    subjectName,
    state: afterDiagnostic
  });
  await page.locator("#yzm").click().catch(() => {});
  return afterDiagnostic;
}

async function runEnforcementAfterCaptcha(page, subjectName, codeOrId, audit, options = {}) {
  const mode = options.mode || "assisted";
  attachEnforcementResponseAudit(page, audit, subjectName);
  let displayedCaptcha = await prepareEnforcementChallenge(page, subjectName, codeOrId, audit);
  const maxAttempts = Number(options.confirmAttempts || process.env.POST_LOAN_ENFORCEMENT_CONFIRM_ATTEMPTS || 3);
  const resultWaitMs = Number(options.resultWaitMs || process.env.POST_LOAN_ENFORCEMENT_RESULT_WAIT_MS || 12000);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`China Enforcement ${subjectName}: waiting for page challenge confirmation, attempt ${attempt}/${maxAttempts}.`);
    audit?.record("enforcement_captcha_waiting", { subjectName, attempt, mode });
    const imageTextRequested = Boolean(options.challengeEngine) && (mode === ChallengeMode.AUTO || envFlag("POST_LOAN_ENABLE_EXECUTION_IMAGE_TEXT", false));
    audit?.record("enforcement_official_image_text_policy", {
      subjectName,
      attempt,
      mode,
      requested: imageTextRequested,
      enabled: false,
      reason: "official_judicial_source_requires_managed_official_confirmation"
    });
    const enteredCaptcha = await waitForStableCaptchaInput(page, subjectName, options);
    if (enteredCaptcha.trim().length < 4) continue;
    await fillAndVerifyEnforcementFields(page, subjectName, codeOrId);
    const currentDiagnostic = await getEnforcementDiagnosticState(page);
    if (!sameCaptchaDigest(displayedCaptcha.captchaDigest, currentDiagnostic.captchaDigest)) {
      console.log(`China Enforcement ${subjectName}: page challenge changed before submit; waiting again.`);
      audit?.record("enforcement_captcha_changed_before_submit", {
        subjectName,
        attempt,
        displayed: displayedCaptcha.captchaDigest,
        current: currentDiagnostic.captchaDigest
      });
      displayedCaptcha = await resetEnforcementCaptcha(page, subjectName, codeOrId, audit);
      continue;
    }
    const submitState = await getCaptchaState(page);
    audit?.record("enforcement_submit_attempt", {
      subjectName,
      attempt,
      captchaLength: enteredCaptcha.trim().length,
      captchaState: submitState,
      diagnostic: currentDiagnostic
    });

    await page.waitForTimeout(Number(process.env.POST_LOAN_BEFORE_SUBMIT_WAIT_MS || 900) + Math.floor(Math.random() * 700));
    await clickEnforcementSearch(page);
    await page.waitForTimeout(Number(process.env.POST_LOAN_AFTER_SUBMIT_WAIT_MS || 2500));

    const confirmed = await waitUntil(page, `China Enforcement result for ${subjectName}`, async () => {
      const text = await pageText(page);
      if (isCaptchaFailure(text) || isEnforcementCaptchaFailure(text)) return true;
      return isEnforcementResultState(text) || isEnforcementModuleResultState(text);
    }, resultWaitMs).then(() => true).catch(() => false);

    const text = await pageText(page);
    if (confirmed && (isEnforcementResultState(text) || isEnforcementModuleResultState(text)) && !isCaptchaFailure(text) && !isEnforcementCaptchaFailure(text)) {
      console.log(`China Enforcement ${subjectName}: confirmed result/no-result page.`);
      page.__postLoanEnforcementValidated = true;
      audit?.record("enforcement_result_confirmed", {
        subjectName,
        attempt,
        url: page.url(),
        diagnostic: await getEnforcementDiagnosticState(page)
      });
      return { ok: true, text };
    }

    console.log(`China Enforcement ${subjectName}: result was not confirmed; refreshing the page challenge and waiting again.`);
    audit?.record("enforcement_captcha_attempt_failed", {
      subjectName,
      attempt,
      url: page.url(),
      textSample: text.slice(0, 200),
      diagnostic: await getEnforcementDiagnosticState(page)
    });
    displayedCaptcha = await resetEnforcementCaptcha(page, subjectName, codeOrId, audit);
  }
  throw new Error(`China Enforcement ${subjectName}: repeated page challenge/query attempts did not reach a result page.`);
}

async function completeEnforcementQuery(context, page, subjectName, codeOrId, audit, options = {}) {
  let current = page;
  const maxRecoveries = Number(options.recoveries || process.env.POST_LOAN_ENFORCEMENT_RECOVERIES || 2);
  for (let recovery = 1; recovery <= maxRecoveries; recovery += 1) {
    try {
      writeStage(`enforcement query recovery ${recovery} for ${subjectName}`);
      if (!current || current.isClosed()) {
        current = await context.newPage();
        await fillEnforcementQuery(current, subjectName, codeOrId, options);
      }
      await runEnforcementAfterCaptcha(current, subjectName, codeOrId, audit, options);
      writeStage(`enforcement query confirmed for ${subjectName}`);
      return current;
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      if (recovery === maxRecoveries) {
        await saveOfficialPageDiagnostic(current, options.outDir, `zxgk-${subjectName}-recovery-${recovery}`, audit, {
          subjectName,
          recovery,
          error: message
        }).catch(() => null);
      }
      if (!/Target page|has been closed|Page closed/.test(message) || recovery === maxRecoveries) throw error;
      console.log(`China Enforcement ${subjectName}: page closed; reopening ${recovery + 1}/${maxRecoveries}.`);
      audit?.record("enforcement_page_recovered", { subjectName, recovery, error: message });
      current = await context.newPage();
      await fillEnforcementQuery(current, subjectName, codeOrId, options);
    }
  }
  return current;
}

function assertRequiredJudicialEvidence(shots, { smokeQuick, judicialEnabled, persons = [] } = {}) {
  if (smokeQuick) {
    throw new Error("SmokeQuick output is not final delivery. Formal reports must include China Judgments Online and China Enforcement result evidence.");
  }
  if (!judicialEnabled) {
    throw new Error("Judicial sources are not enabled. Formal reports require assisted or auto mode for required judicial/execution evidence.");
  }

  const validShots = shots.filter((shot) => shot?.validation?.ok);
  const hasJudgments = validShots.some((shot) => String(shot.url || "").includes("wenshu.court.gov.cn"));
  const hasEnforcement = validShots.some((shot) => (
    String(shot.url || "").includes("zxgk.court.gov.cn")
  ));
  if (!hasJudgments) {
    throw new Error("Missing validated China Judgments Online result page; refusing to build final report.");
  }
  if (!hasEnforcement) {
    throw new Error("Missing validated China Enforcement Information result page; refusing to build final report.");
  }

  for (const person of persons) {
    const name = String(person?.name || "");
    if (!name) continue;
    const hasPersonEnforcement = validShots.some((shot) => (
      String(shot.url || "").includes("zxgk.court.gov.cn") && String(shot.name || "").includes(name)
    ));
    if (!hasPersonEnforcement) {
      throw new Error(`Missing validated personal enforcement result page for ${name}; refusing to build final report.`);
    }
  }
}

async function createBrowserContext({ chromium, chrome, profile, headless, requiresForeground, runtimePolicy, audit, preferPersistentProfile = false }) {
  const defaultBrowserEngine = preferPersistentProfile && chrome
    ? "local"
    : ((headless && !requiresForeground) ? "playwright" : "local");
  const browserEngine = envChoice("POST_LOAN_BROWSER_ENGINE", defaultBrowserEngine);
  const persistence = envChoice(
    "POST_LOAN_BROWSER_PERSISTENCE",
    ((headless && !requiresForeground) && !preferPersistentProfile) ? "ephemeral" : "persistent"
  );
  const useBundledChromium = browserEngine === "playwright" || envFlag("POST_LOAN_USE_BUNDLED_CHROMIUM", false);
  const usePersistentProfile = persistence !== "ephemeral" && !envFlag("POST_LOAN_DISABLE_PERSISTENT_PROFILE", false);
  const launchOptions = {
    headless: headless && !requiresForeground,
    viewport: { width: 1268, height: 755 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    args: browserCompatibilityArgs(runtimePolicy)
  };

  if (!useBundledChromium && chrome) {
    launchOptions.executablePath = chrome;
  }

  audit?.record("browser_context_strategy", {
    browserEngine,
    persistence,
    useBundledChromium,
    usePersistentProfile,
    executablePath: launchOptions.executablePath || "playwright-bundled"
  });

  async function installAndReturn(session) {
    await installOfficialPortalRequestCompatibility(session.context, audit);
    return session;
  }

  if (usePersistentProfile) {
    try {
      const context = await chromium.launchPersistentContext(profile, launchOptions);
      return installAndReturn({ browser: null, context, persistent: true });
    } catch (error) {
      const firstError = error;
      audit?.record("browser_context_persistent_launch_failed", {
        executablePath: launchOptions.executablePath,
        persistence,
        profile,
        error: String(firstError.message || firstError)
      });
      if (launchOptions.executablePath) {
        try {
          const fallbackOptions = { ...launchOptions };
          delete fallbackOptions.executablePath;
          const context = await chromium.launchPersistentContext(profile, fallbackOptions);
          audit?.record("browser_context_fallback_to_bundled", { persistence });
          return installAndReturn({ browser: null, context, persistent: true });
        } catch (bundledError) {
          audit?.record("browser_context_bundled_persistent_launch_failed", {
            persistence,
            profile,
            error: String(bundledError.message || bundledError)
          });
        }
      }
      const tempProfile = path.join(path.dirname(profile), `.temp-${process.pid}-${Date.now()}`);
      fs.mkdirSync(tempProfile, { recursive: true });
      const tempOptions = { ...launchOptions };
      delete tempOptions.executablePath;
      const context = await chromium.launchPersistentContext(tempProfile, tempOptions);
      audit?.record("browser_context_fallback_to_temp_profile", { persistence, profile, tempProfile });
      return installAndReturn({ browser: null, context, persistent: true, tempProfile });
    }
  }

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: launchOptions.headless,
      args: launchOptions.args,
      ...(launchOptions.executablePath ? { executablePath: launchOptions.executablePath } : {})
    });
  } catch (error) {
    if (!launchOptions.executablePath) throw error;
    audit?.record("browser_context_local_launch_failed", {
      executablePath: launchOptions.executablePath,
      persistence,
      error: String(error.message || error)
    });
    browser = await chromium.launch({
      headless: launchOptions.headless,
      args: launchOptions.args
    });
    audit?.record("browser_context_fallback_to_bundled", { persistence });
  }
  const context = await browser.newContext({
    viewport: launchOptions.viewport,
    locale: launchOptions.locale,
    timezoneId: launchOptions.timezoneId
  });
  return installAndReturn({ browser, context, persistent: false });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const company = args.company;
  const outDir = args["out-dir"];
  let orgCode = args["org-code"] || "";
  const subjectType = args["subject-type"] || "enterprise";
  const includeHealthCommission = Boolean(args["include-health-commission"]);
  const smokeQuick = Boolean(args["smoke-quick"]);
  const skipSearch = Boolean(args["skip-search"]);
  const judicialMode = args["judicial-mode"] || ChallengeMode.ASSISTED;
  const noPrompt = Boolean(args["no-prompt"]);
  const headless = Boolean(args.headless) || noPrompt;
  const requiresForeground = !noPrompt && !smokeQuick && judicialMode !== ChallengeMode.BLOCKED;
  const persons = args.person.map(parsePerson);

  if (!company || !outDir) throw new Error("--company and --out-dir are required");
  if (subjectType === "person" && !orgCode) throw new Error("--org-code must be the personal ID number for person subjects");
  writeStage(`capture started for ${company}`);

  if (!smokeQuick && judicialMode !== ChallengeMode.BLOCKED) {
    if (noPrompt) {
      console.log("Running in background mode. Official portals and validation checks will run automatically.");
    } else {
      console.log("Running portal query. If an authorized browser session needs attention, the prepared page will stay open and the task will continue after readiness is detected.");
      if (persons.length) console.log(`Personal enforcement subjects: ${persons.map((p) => p.name).join(", ")}.`);
    }
  } else {
    console.log("Background/smoke mode: only non-final available sources will run.");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const audit = new AuditLog(outDir);
  global.__postLoanAudit = audit;
  writeStage("audit initialized");
  const investigationMode = resolveInvestigationMode({ requestedMode: args.mode || args["investigation-mode"], audit });
  const runtimePolicy = loadRuntimePolicy({ skillRoot: path.join(__dirname, ".."), audit, investigationMode });
  audit.record("run_started", { company, subjectType, includeHealthCommission, smokeQuick, judicialMode, noPrompt, investigationMode: investigationMode.mode });
  const skipNonEssentialSourceQueries = noPrompt && !envFlag("POST_LOAN_ENABLE_BACKGROUND_SOURCE_ENRICHMENT", false);
  const chromeCandidates = [
    process.env.POST_LOAN_CHROME_EXE,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe") : ""
  ].filter(Boolean);
  const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  const runtimeRoot = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies");
  const pythonCandidates = [
    process.env.POST_LOAN_PYTHON_EXE,
    path.join(runtimeRoot, "python", "python.exe"),
    "/usr/bin/python3",
    "/usr/bin/python",
    "python3",
    "python"
  ].filter(Boolean);
  const pythonExe = pythonCandidates.find((candidate) => {
    if (/^python3?$/.test(candidate)) return true;
    return fs.existsSync(candidate);
  }) || "python";
  const sessionManager = new SessionManager({ audit });
  const profileScope = smokeQuick ? "government" : "judicial";
  const persistentProfile = sessionManager.profilePath(profileScope);
  const previousSession = sessionManager.readState(profileScope);
  const useRunProfile = smokeQuick || envFlag("POST_LOAN_FORCE_CLEAN_PROFILE", noPrompt && !previousSession);
  const profile = useRunProfile
    ? path.join(persistentProfile, `run-${Date.now()}-${process.pid}`)
    : persistentProfile;
  fs.mkdirSync(profile, { recursive: true });
  audit.record("browser_profile_policy", {
    scope: profileScope,
    useRunProfile,
    reason: useRunProfile ? (smokeQuick ? "smoke_quick" : "background_without_valid_session") : "persistent_session_available"
  });
  const sourceStateStore = new SourceStateStore({ file: path.join(persistentProfile, "source-state.json"), audit });
  const judicialScheduler = new JudicialRunScheduler({
    audit,
    stateStore: sourceStateStore,
    baseDelayMs: investigationMode.judicialBaseDelayMs,
    retryDelayMs: investigationMode.judicialRetryDelayMs,
    jitterMs: investigationMode.judicialJitterMs,
    cooldownMs: investigationMode.judicialCooldownMs
  });
  const siteConfigPath = path.join(__dirname, "..", "references", "sites.json");
  const siteConfig = readJsonFile(siteConfigPath);
  const sourceRegistry = new DataSourceRegistry({
    config: siteConfig,
    audit,
    stateStore: sourceStateStore
  });
  const sourceHealthDisabled = skipNonEssentialSourceQueries || envDisabled(
    "POST_LOAN_DISABLE_SOURCE_HEALTHCHECK",
    "POST_LOAN_DISABLE_SOURCE_HEALTHCHECK"
  );
  const sourceHealth = sourceHealthDisabled ? [] : await sourceRegistry.healthCheckAvailable();
  writeStage("source health check completed");
  const dataSourceResults = skipNonEssentialSourceQueries ? [] : await sourceRegistry.query(company, { includeCredentialed: investigationMode.includeCredentialed });
  writeStage("data source registry query completed");
  const graphDepth = Number(args["graph-depth"] || envNumber(["POST_LOAN_GRAPH_DEPTH", "POST_LOAN_GRAPH_DEPTH"], investigationMode.graphDepth));
  const subjectGraph = skipNonEssentialSourceQueries ? {
    root: company,
    nodes: [],
    edges: [],
    skipped: true,
    reason: "background_source_enrichment_disabled"
  } : await buildSubjectGraph({
    registry: sourceRegistry,
    rootSubject: company,
    maxDepth: graphDepth,
    maxNodes: Number(args["graph-max-nodes"] || envNumber(["POST_LOAN_GRAPH_MAX_NODES", "POST_LOAN_GRAPH_MAX_NODES"], investigationMode.graphMaxNodes)),
    audit
  });
  const judicialPolicy = new JudicialSourcePolicy({ mode: judicialMode, audit });
  const challengeEngine = new ChallengeEngine({
    audit,
    policyFile: investigationMode.challengePolicyFile || process.env.POST_LOAN_CHALLENGE_POLICY,
    allowLowRiskImageTextRecognition: Boolean(investigationMode.lowRiskOcr && runtimePolicy.lowRiskImageTextRecognition.enabled) || envFlag("POST_LOAN_ENABLE_LOW_RISK_IMAGE_TEXT", false),
    pythonExe,
    imageTextHelperPath: path.join(__dirname, "optional_image_text_recognition_provider.py"),
    investigationMode
  });
  audit.record("browser_profile_selected", { scope: profileScope, profile, persistentProfile, hasPreviousSession: Boolean(previousSession) });
  const browserSession = await createBrowserContext({
    chromium,
    chrome,
    profile,
    headless,
    requiresForeground,
    runtimePolicy,
    audit,
    preferPersistentProfile: investigationMode.mode === "expert" || investigationMode.mode === "deep"
  });
  const { context, browser } = browserSession;
  writeStage("browser context launched");

  const page = await context.newPage();
  const enforcementPage = smokeQuick ? null : await context.newPage();
  writeStage("browser pages prepared");
  if (!smokeQuick && investigationMode.judicialWarmup) {
    await warmOfficialJudicialOrigins(context, audit, { timeoutMs: investigationMode.mode === "expert" ? 26000 : (investigationMode.mode === "deep" ? 22000 : 15000) }).catch((error) => {
      audit.record("official_judicial_origins_warmup_failed", { error: String(error.message || error) });
    });
    writeStage("official judicial origins warmed");
  }
  const shots = [];
  const add = makeAdd(outDir, shots);

  let orgCodeLookup = null;
  if (subjectType === "enterprise" && !orgCode && !smokeQuick) {
    console.log("No unified social credit code was provided; trying public lookup first.");
    orgCodeLookup = await lookupOrgCode(context, company);
    orgCode = orgCodeLookup.code;
    if (!orgCode) {
      throw new Error(`Could not determine unified social credit code / organization code for ${company}. Please provide it when starting the task.`);
    }
    if (orgCodeLookup.ambiguous) {
      console.log(`Multiple possible org codes found; using first: ${orgCode}. Candidates: ${orgCodeLookup.candidates.join(", ")}`);
    } else {
      console.log(`Unified social credit code found: ${orgCode}`);
    }
  }

  if (!smokeQuick && judicialPolicy.shouldBlock()) {
    audit.record("judicial_sources_blocked", { company, mode: judicialMode });
  }

  const judicialEnabled = !smokeQuick && !judicialPolicy.shouldBlock();

  if (judicialEnabled) {
    writeStage("judicial preparation started");
    judicialPolicy.recordDecision("wenshu", judicialPolicy.canAutoSolveCaptcha() ? "auto_mode" : "assisted_mode");
    judicialPolicy.recordDecision("zhixing", judicialPolicy.canAutoSolveCaptcha() ? "auto_mode" : "assisted_mode");
    try {
      await withTimeout("enforcement preparation", Number(process.env.POST_LOAN_ENFORCEMENT_PREP_TIMEOUT_MS || 45000), async () => {
        await waitForEnforcementReady(enforcementPage, `China Enforcement ${company}`, audit, {
          readyAttempts: Number(process.env.POST_LOAN_ENFORCEMENT_PREP_ATTEMPTS || Math.min(2, investigationMode.enforcementReadyAttempts || 2))
        });
      });
      writeStage("enforcement page prepared");
    } catch (error) {
      audit.record("enforcement_prepare_deferred", { company, error: String(error.message || error) });
      writeStage("enforcement preparation deferred to capture phase");
    }
    writeStage("judicial preparation completed");
  }

  const personQueries = [];
  for (const person of judicialEnabled ? persons : []) {
    const personPage = await context.newPage();
    try {
      await withTimeout(
        `personal enforcement preparation ${person.name}`,
        Number(process.env.POST_LOAN_PERSON_ENFORCEMENT_PREP_TIMEOUT_MS || 30000),
        () => fillEnforcementQuery(personPage, person.name, person.idNumber, {
          readyAttempts: Number(process.env.POST_LOAN_ENFORCEMENT_PREP_ATTEMPTS || Math.min(2, investigationMode.enforcementReadyAttempts || 2))
        })
      );
      personQueries.push({ person, page: personPage });
    } catch (error) {
      audit.record("person_enforcement_prepare_failed", { person: person.name, error: String(error.message || error) });
      await personPage.close().catch(() => {});
    }
  }

  if (judicialEnabled) {
    console.log("Judicial sources will be queried during the required capture phase.");
  } else {
    console.log("Judicial sources are not enabled for this non-final run.");
  }

  const portalQueue = new TaskQueue({
    audit,
    concurrency: Number(args["portal-concurrency"] || process.env.POST_LOAN_PORTAL_CONCURRENCY || (noPrompt ? 3 : 2)),
    defaultRetries: 1,
    defaultTimeoutMs: Number(args["portal-timeout-ms"] || process.env.POST_LOAN_PORTAL_TIMEOUT_MS || 45000)
  });
  async function withPortalPage(task) {
    const isolatedPage = await context.newPage();
    try {
      return await task(isolatedPage);
    } finally {
      await isolatedPage.close().catch(() => {});
    }
  }
  portalQueue.add({
    id: "portal-henan-emergency",
    sourceId: "henan_emergency",
    run: async () => tryCapturePortalCandidates(
      context,
      shots,
      "河南省应急管理厅",
      [
        {
          name: "河南省应急管理厅",
          url: `https://yjglt.henan.gov.cn/wzjs/?keywords=${encodeURIComponent(company)}`,
          requireSubjectMatch: false
        },
        {
          name: "河南省应急管理厅",
          url: "https://yjglt.henan.gov.cn/",
          requireSubjectMatch: false
        }
      ],
      audit,
      company,
      add
    )
  });
  portalQueue.add({
    id: "portal-henan-ecology",
    sourceId: "henan_ecology",
    run: async () => tryCapturePortalCandidates(
      context,
      shots,
      "河南省生态环境厅",
      [
        {
          name: "河南省生态环境厅",
          url: `https://sthjt.henan.gov.cn/wzjs/?keywords=${encodeURIComponent(company)}`,
          requireSubjectMatch: false
        },
        {
          name: "河南省生态环境厅",
          url: "https://sthjt.henan.gov.cn/",
          requireSubjectMatch: false
        }
      ],
      audit,
      company,
      add
    )
  });
  portalQueue.add({
    id: "portal-henan-market",
    sourceId: "henan_market",
    run: async () => tryCapturePortalCandidates(
      context,
      shots,
      "河南省市场监督管理局",
      [
        {
          name: "河南省市场监督管理局",
          url: `https://scjg.henan.gov.cn/search/?keywords=${encodeURIComponent(company)}`,
          requireSubjectMatch: false
        },
        {
          name: "河南省市场监督管理局",
          url: "https://scjg.henan.gov.cn/",
          requireSubjectMatch: false
        }
      ],
      audit,
      company,
      add
    )
  });
  if (includeHealthCommission) {
    portalQueue.add({
      id: "portal-health-local-or-provincial",
      sourceId: "henan_health",
      run: async () => tryCapturePortalCandidates(
        context,
        shots,
        "河南省卫生健康委员会",
        [
          {
            name: "濮阳市卫生健康委员会",
            url: `https://weijian.puyang.gov.cn/?keywords=${encodeURIComponent(company)}`,
            requireSubjectMatch: true
          },
          {
            name: "河南省卫生健康委员会",
            url: `https://wsjkw.henan.gov.cn/so.html?keywords=${encodeURIComponent(company)}`,
            requireSubjectMatch: true
          },
          {
            name: "河南省卫生健康委员会",
            url: `https://wsjkw.henan.gov.cn/`,
            requireSubjectMatch: false
          },
          {
            name: "濮阳市卫生健康委员会",
            url: `https://weijian.puyang.gov.cn/`,
            requireSubjectMatch: false
          }
        ],
        audit,
        company,
        add
      )
    });
  }
  await portalQueue.runAll();
  writeStage("portal queue completed");
  audit.record("portal_queue_completed", {
    company,
    results: portalQueue.results || []
  });

  if (judicialEnabled) {
    writeStage("judicial capture started");
    let judgmentCaptured = false;
    let judgmentPage = null;

    try {
      judgmentPage = await context.newPage();
      const judgmentShot = await withTimeout(
        "judgment portal capture",
        Number(process.env.POST_LOAN_JUDGMENT_CAPTURE_TIMEOUT_MS || (investigationMode.mode === "expert" ? 70000 : 50000)),
        (signal) => captureJudgmentPortal(judgmentPage, shots, add, company, audit, judicialScheduler, {
          attempts: investigationMode.judgmentAttempts,
          settleBaseMs: investigationMode.judgmentSettleBaseMs,
          resultWaitMs: investigationMode.mode === "expert" ? 18000 : (investigationMode.mode === "deep" ? 15000 : 12000),
          outDir,
          signal,
          ignoreCooldown: true
        })
      );
      judgmentCaptured = Boolean(judgmentShot);
    } catch (error) {
      audit.record("judgment_portal_capture_failed", { company, error: String(error.message || error) });
      await saveOfficialPageDiagnostic(judgmentPage, outDir, "wenshu-capture-failed", audit, {
        company,
        error: String(error.message || error)
      }).catch(() => null);
      writeStage(`judgment capture failed: ${String(error.message || error)}`);
    } finally {
      if (judgmentPage) await judgmentPage.close().catch(() => {});
    }

    if (!judgmentCaptured) {
      audit.record("judgment_official_result_missing", {
        company,
        requirement: "formal_report_requires_wenshu_official_result_screenshot"
      });
    }

    let validatedEnforcementPage = null;
    try {
      console.log("Starting China Enforcement Information required query.");
      const enterpriseEnforcementPage = await context.newPage();
      validatedEnforcementPage = await withTimeout(
        "enterprise enforcement capture",
        Number(process.env.POST_LOAN_ENFORCEMENT_CAPTURE_TIMEOUT_MS || (investigationMode.mode === "expert" ? 90000 : 65000)),
        (signal) => judicialScheduler.runWithRetries("judicial_zhixing_enterprise", 2, async () => (
          completeEnforcementQuery(context, enterpriseEnforcementPage, company, orgCode, audit, {
            mode: judicialMode,
            noPrompt,
            challengeEngine,
            readyAttempts: investigationMode.enforcementReadyAttempts,
            confirmAttempts: investigationMode.enforcementConfirmAttempts,
            recoveries: investigationMode.enforcementRecoveries,
            resultWaitMs: investigationMode.enforcementResultWaitMs,
            outDir
          })
        ), { ignoreCooldown: true, signal })
      );
      for (const query of personQueries) {
        console.log(`Waiting for personal enforcement result confirmation for ${query.person.name}.`);
        query.page = await judicialScheduler.runWithRetries(`judicial_zhixing_person_${safePart(query.person.name)}`, 2, async () => (
          completeEnforcementQuery(context, query.page, query.person.name, query.person.idNumber, audit, {
            mode: judicialMode,
            noPrompt,
            challengeEngine,
            readyAttempts: investigationMode.enforcementReadyAttempts,
            confirmAttempts: investigationMode.enforcementConfirmAttempts,
            recoveries: investigationMode.enforcementRecoveries,
            resultWaitMs: investigationMode.enforcementResultWaitMs,
            outDir
          })
        ), { ignoreCooldown: true });
      }
    } catch (error) {
      console.log(`China Enforcement Information did not reach a confirmed result page: ${error && error.message ? error.message : error}`);
      audit.record("enforcement_portal_capture_failed", { company, error: String(error.message || error) });
      for (const officialPage of context.pages()) {
        await saveOfficialPageDiagnostic(officialPage, outDir, "zxgk-capture-failed", audit, {
          company,
          error: String(error.message || error)
        }).catch(() => null);
      }
    }

    if (!validatedEnforcementPage) {
        throw new Error("China Enforcement Information did not reach a confirmed official result page; refusing to build final report.");
    }

    file = add("中国执行信息公开网");
    if (validatedEnforcementPage) {
      await capture(validatedEnforcementPage, shots, "中国执行信息公开网", file, 0, { enforcementValidated: Boolean(validatedEnforcementPage.__postLoanEnforcementValidated) });
    }
  }

  for (const query of personQueries) {
    const person = query.person;
    const personPage = query.page;
    file = add(`个人被执行信息-${person.name}`);
    const personShot = await capture(personPage, shots, `个人被执行信息-${person.name}`, file, 0, { enforcementValidated: Boolean(personPage.__postLoanEnforcementValidated) });
    if (!personShot) audit.record("person_enforcement_official_result_missing", { company, person: person.name });

    const detailLinks = personPage.locator("a:has-text('查看'), a:has-text('详情'), text=查看");
    const detailCount = await detailLinks.count().catch(() => 0);
    for (let i = 0; i < detailCount; i += 1) {
      const before = context.pages();
      await detailLinks.nth(i).click().catch(() => {});
      await personPage.waitForTimeout(1500);
      const after = context.pages();
      const detailPage = after.find((p) => !before.includes(p)) || personPage;
      file = add(`个人被执行详情-${person.name}-${i + 1}`);
      await capture(detailPage, shots, `个人被执行详情-${person.name}-${i + 1}`, file);
      if (detailPage !== personPage) await detailPage.close().catch(() => {});
    }
  }

  let searchResult = { skipped: Boolean(skipSearch), ok: false, engine: "", pages: 0 };
  if (!skipSearch) {
    writeStage("search capture started");
    const searchManager = new SearchManager({
      audit,
      cooldownMs: Number(args["search-cooldown-ms"] || 8 * 60 * 1000),
      stateStore: sourceStateStore,
      challengeEngine
    });
    searchResult = await searchManager.capture({
      page,
      company,
      add,
      captureCompleteScroll: async (searchPage, addFile, baseName) => {
        return captureCompleteScroll(searchPage, shots, addFile, baseName);
      },
      discardCaptures: (entries) => discardCaptures(shots, entries)
    });
    audit.record("search_result_recorded", { company, ...searchResult });
  } else {
    audit.record("search_skipped", { company });
  }

  assertRequiredJudicialEvidence(shots, { smokeQuick, judicialEnabled, persons });
  writeStage("required judicial evidence asserted");

  const manifest = {
    company,
    orgCode,
    orgCodeLookup,
    subjectType,
    includeHealthCommission,
    smokeQuick,
    skipSearch,
    judicialEnabled,
    investigationMode,
    searchResult,
    sourceHealth,
    dataSourceResults,
    subjectGraph,
    persons: persons.map((p) => ({ name: p.name })),
    templateSlots: true,
    generatedAt: new Date().toISOString(),
    screenshots: shots,
    outputDir: outDir
  };
  manifest.requiredEvidence = buildRequiredEvidence(manifest);
  fs.writeFileSync(path.join(outDir, "template-slots-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  assertRequiredEvidence(manifest);
  audit.record("run_completed", { company, screenshotCount: shots.length });
  if (!useRunProfile) {
    sessionManager.writeState(profileScope, {
      status: "valid",
      company,
      smokeQuick,
      judicialMode,
      lastRunAt: new Date().toISOString()
    });
  }
  audit.flush();
  await context.close();
  if (browser) await browser.close().catch(() => {});
  if (useRunProfile || !browserSession.persistent) fs.rmSync(profile, { recursive: true, force: true });
  console.log(path.join(outDir, "template-slots-manifest.json"));
}

main().catch((error) => {
  try {
    global.__postLoanAudit?.record("run_failed", { error: String(error && error.message ? error.message : error) });
    global.__postLoanAudit?.flush();
  } catch {}
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
