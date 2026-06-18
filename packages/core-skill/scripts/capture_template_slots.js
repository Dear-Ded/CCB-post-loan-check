const fs = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("playwright");
const { AuditLog } = require("./framework/audit");
const { SearchManager } = require("./framework/search_manager");
const { SessionManager } = require("./framework/session_manager");
const { TaskQueue } = require("./framework/task_queue");
const { SourceStateStore } = require("./framework/source_state_store");
const { ChallengeMode } = require("./framework/challenge_policy");
const { JudicialSourcePolicy } = require("./framework/judicial_sources");
const {
  attachEnforcementResponseAudit,
  getEnforcementDiagnosticState,
  getCaptchaState,
  isCaptchaFailure: isEnforcementCaptchaFailure,
  isResultState: isEnforcementModuleResultState,
  waitForCaptchaChange
} = require("./framework/enforcement_source");

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

async function waitUntil(page, label, predicate, timeoutMs = 10 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate().catch(() => false)) return true;
    if (page.isClosed && page.isClosed()) throw new Error(`Page closed while waiting for ${label}`);
    await page.waitForTimeout(1500);
  }
  throw new Error(`Timed out waiting for ${label}`);
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
      await goto(page, url);
      const text = await pageText(page);
      if (text && !/网络不给力|访问异常|系统繁忙|服务异常|502|503|504/.test(text)) return;
      lastError = new Error(`${label} returned an abnormal or blank page`);
    } catch (error) {
      lastError = error;
    }
    console.log(`${label} 加载失败或异常，正在第 ${i + 1}/${attempts} 次重试...`);
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
  shots.push({
    slot: shots.length + 1,
    name,
    screenshot: file,
    text,
    url,
    validation: validateCapture(name, text, url, options)
  });
}

async function tryCapturePortal(page, shots, name, file, url, scrollY = 0, options = {}) {
  try {
    await goto(page, url);
    await capture(page, shots, name, file, scrollY, options);
    return { ok: true, name, url, file };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    console.log(`${name} 抓取失败，跳过该门户：${message}`);
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

async function tryCapturePortalCandidates(page, shots, name, candidates, audit, company, add) {
  const startedCount = shots.length;
  const attempts = [];
  for (const candidate of candidates) {
    const file = candidate.file || add(candidate.name || name);
    const beforeCount = shots.length;
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
  }
  audit?.record("portal_candidates_failed", { name, company, attempts });
  return { ok: false, name, attempts, screenshotsBefore: startedCount, screenshotsAfter: shots.length };
}

async function captureCompleteScroll(page, shots, add, baseName) {
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
        console.log(`${engine.name}第 ${pageNo} 页加载失败，尝试下一个搜索源。`);
        blocked = true;
        break;
      }
      const text = await pageText(page);
      const termHits = companyTerms.filter((term) => text.includes(term)).length;
      const subjectMatched = text.includes(company) || termHits >= Math.min(2, companyTerms.length);
      if (!engine.validUrl(page.url()) || await isSearchVerificationPage(page, engine.id) || !subjectMatched) {
        console.log(`${engine.name}第 ${pageNo} 页不是可用主体搜索结果页，尝试下一个搜索源。`);
        blocked = true;
        break;
      }
      await captureCompleteScroll(page, shots, add, `${engine.name}第${pageNo}页`);
      captured += 1;
    }
    if (!blocked && captured > 0) return;
  }
  console.log(`所有搜索源均未取得可用的主体搜索结果页，搜索证据本次空缺。`);
}

function safePart(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 80);
}

function makeAdd(outDir, shots) {
  return (name) => path.join(outDir, `${String(shots.length + 1).padStart(2, "0")}-${safePart(name)}.png`);
}

function parsePerson(value) {
  const [name, idNumber] = String(value).split("|");
  if (!name || !idNumber) throw new Error(`Invalid --person value. Use "姓名|身份证号": ${value}`);
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
  if (!compact) problems.push("页面正文为空");
  const pageSignal = `${url} ${compact}`;
  const isCourtOrEnforcement = url.includes("wenshu.court.gov.cn") || url.includes("zxgk.court.gov.cn");
  if (/login|passport|verify|captcha|安全验证|网络不给力|访问异常/.test(pageSignal)) {
    problems.push("疑似登录页、验证码页或异常页");
  }
  if (!isCourtOrEnforcement && /登录/.test(pageSignal)) {
    problems.push("疑似登录页");
  }
  if (url.includes("wappass.baidu.com") || url.includes("passport.baidu.com")) {
    problems.push("百度安全验证页");
  }
  if (name.includes("河南省应急管理厅") && !url.includes("yjglt.henan.gov.cn/wzjs")) problems.push("不是河南应急搜索结果页");
  if (name.includes("河南省生态环境厅") && !url.includes("sthjt.henan.gov.cn/wzjs")) problems.push("不是河南生态环境搜索结果页");
  if (name.includes("河南省市场监督管理局") && !url.includes("scjg.henan.gov.cn/search")) problems.push("不是河南市场监管搜索结果页");
  if (name.includes("河南省卫生健康委员会") && !(url.includes("wsjkw.henan.gov.cn") || url.includes("baidu.com"))) problems.push("不是河南卫健委结果页或站内检索兜底页");
  if (name.includes("中国裁判文书网") && !url.includes("wenshu.court.gov.cn")) problems.push("不是裁判文书网页面");
  if (name.includes("中国执行信息公开网") && !url.includes("zxgk.court.gov.cn")) problems.push("不是执行公开网页面");
  if (name.includes("被执行") && !url.includes("zxgk.court.gov.cn")) problems.push("个人被执行查询未在执行公开网完成");
  if ((name.includes("中国执行信息公开网") || name.includes("被执行")) && !options.enforcementValidated) {
    problems.push("执行公开网尚未确认进入查询结果/无结果页面");
  }
  if (name.includes("百度搜索") && !url.includes("baidu.com/s")) problems.push("不是百度搜索结果页");
  if (name.includes("Bing搜索") && !url.includes("bing.com/search")) problems.push("不是 Bing 搜索结果页");
  if (name.includes("360搜索") && !url.includes("so.com/s")) problems.push("不是 360 搜索结果页");
  if (name.includes("搜狗搜索") && !url.includes("sogou.com/web")) problems.push("不是搜狗搜索结果页");
  return { ok: problems.length === 0, problems };
}

async function getEnforcementFields(page) {
  return page.evaluate(() => ({
    name: document.querySelector("#pName")?.value || "",
    card: document.querySelector("#pCardNum")?.value || "",
    captcha: document.querySelector("#yzm")?.value || ""
  })).catch(() => ({ name: "", card: "", captcha: "" }));
}

function isCaptchaFailure(text) {
  return /验证码.*(错误|不正确|有误|失效|为空)|校验码.*(错误|不正确|有误)|请输入.*验证码|验证码不能为空/.test(text);
}

function isEnforcementResultState(text) {
  return /查询结果|未查询到|暂无数据|没有找到|无符合条件|没有符合条件|无相关信息|查询无结果|案号|执行法院|立案时间|执行标的/.test(text);
}

async function waitForEnforcementReady(page, label) {
  const url = "https://zxgk.court.gov.cn/zhzxgk/";
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await gotoWithRetries(page, url, label, 2).catch(() => {});
    const formReady = await page.locator("#pName").first().isVisible({ timeout: 8000 }).catch(() => false);
    const captchaReady = await page.locator("#yzm").first().isVisible({ timeout: 3000 }).catch(() => false);
    if (formReady && captchaReady) return;

    const text = await pageText(page);
    if (/登录|请登录|用户登录/.test(text)) {
      console.log(`${label} 需要登录，请在打开的页面完成登录。完成后不用回来说明，我会自动继续。`);
      await waitUntil(page, `${label} login/form ready`, async () => {
        const body = await pageText(page);
        const pNameVisible = await page.locator("#pName").first().isVisible({ timeout: 1000 }).catch(() => false);
        const captchaVisible = await page.locator("#yzm").first().isVisible({ timeout: 1000 }).catch(() => false);
        return (pNameVisible && captchaVisible) || (!/登录|请登录|用户登录/.test(body) && pNameVisible);
      }, 10 * 60 * 1000);
      const pNameVisible = await page.locator("#pName").first().isVisible({ timeout: 3000 }).catch(() => false);
      const captchaVisible = await page.locator("#yzm").first().isVisible({ timeout: 3000 }).catch(() => false);
      if (pNameVisible && captchaVisible) return;
    }

    console.log(`${label} 查询页未加载完整，正在第 ${attempt + 1}/6 次重试...`);
    await page.waitForTimeout(1500 * attempt);
  }
  throw new Error(`${label} 查询页加载失败，未找到姓名、证件号码和验证码输入框`);
}

async function fillEnforcementQuery(page, name, codeOrId) {
  await waitForEnforcementReady(page, `执行公开网 ${name}`);
  await page.locator("#pName").fill(name).catch(() => {});
  await page.locator("#pCardNum").fill(codeOrId).catch(() => {});
  await waitUntil(page, `enforcement fields for ${name}`, async () => {
    const fields = await getEnforcementFields(page);
    return fields.name.trim() === name && fields.card.trim() === codeOrId;
  }, 20000);
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

async function fillAndSearchJudgments(page, company) {
  const searchInput = page.locator([
    "input.searchKey",
    "input[placeholder*='输入案由']",
    "input[placeholder*='全文检索']",
    "input[placeholder*='关键词']",
    "input[type='text']"
  ].join(", ")).first();
  await searchInput.waitFor({ state: "visible", timeout: 15000 });
  await searchInput.click({ clickCount: 3 }).catch(() => {});
  await searchInput.fill(company);
  await waitUntil(page, "judgment search input filled", async () => {
    const value = await searchInput.inputValue().catch(() => "");
    return value.includes(company);
  }, 10000);
  const searchButtons = [
    "button:has-text('搜索')",
    "a:has-text('搜索')",
    "text=搜索"
  ];
  for (const selector of searchButtons) {
    const button = page.locator(selector).last();
    if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      await button.click();
      return;
    }
  }
  await page.keyboard.press("Enter");
}

async function getCaptchaSignature(page) {
  const state = await getCaptchaState(page);
  return `${state.imageSrc}|${state.imageComplete}|${state.imageSize}|${state.hidden}`;
}

async function resetEnforcementCaptcha(page, subjectName, codeOrId, audit) {
  console.log(`执行公开网 ${subjectName} 正在刷新验证码并恢复查询条件...`);
  audit?.record("enforcement_captcha_reset_started", { subjectName });
  await waitForEnforcementReady(page, `执行公开网 ${subjectName}`);
  await page.locator("#pName").fill(subjectName).catch(() => {});
  await page.locator("#pCardNum").fill(codeOrId).catch(() => {});
  await page.locator("#yzm").fill("").catch(() => {});
  const beforeState = await getCaptchaState(page);
  audit?.record("enforcement_diagnostic_before_refresh", {
    subjectName,
    state: await getEnforcementDiagnosticState(page)
  });
  audit?.record("enforcement_captcha_state_before_refresh", { subjectName, state: beforeState });
  const captchaImage = page.locator("img[src*='captcha'], img[src*='verify'], img[src*='code'], #captchaImg, .captcha img").first();
  if (await captchaImage.isVisible({ timeout: 1000 }).catch(() => false)) {
    await captchaImage.click({ force: true }).catch(() => {});
  } else {
    await page.keyboard.press("Control+R").catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    await waitForEnforcementReady(page, `执行公开网 ${subjectName}`);
    await page.locator("#pName").fill(subjectName).catch(() => {});
    await page.locator("#pCardNum").fill(codeOrId).catch(() => {});
  }
  const afterState = await waitForCaptchaChange(page, beforeState, 8000);
  audit?.record("enforcement_captcha_reset_completed", { subjectName, state: afterState });
  audit?.record("enforcement_diagnostic_after_refresh", {
    subjectName,
    state: await getEnforcementDiagnosticState(page)
  });
  await page.locator("#yzm").click().catch(() => {});
}

async function runEnforcementAfterCaptcha(page, subjectName, codeOrId, audit, options = {}) {
  const mode = options.mode || "assisted";
  attachEnforcementResponseAudit(page, audit, subjectName);
  await resetEnforcementCaptcha(page, subjectName, codeOrId, audit);
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    console.log(`等待执行公开网 ${subjectName} 的验证码输入，第 ${attempt}/12 次...`);
    audit?.record("enforcement_captcha_waiting", { subjectName, attempt, mode });
    await waitUntil(page, `China Enforcement captcha input for ${subjectName}`, async () => {
      const value = await page.locator("#yzm").inputValue().catch(() => "");
      return value.trim().length >= 4;
    }, 10 * 60 * 1000);
    await page.waitForTimeout(500);
    const enteredCaptcha = await page.locator("#yzm").inputValue().catch(() => "");
    if (enteredCaptcha.trim().length < 4) continue;
    const submitState = await getCaptchaState(page);
    const submitDiagnostic = await getEnforcementDiagnosticState(page);
    audit?.record("enforcement_submit_attempt", {
      subjectName,
      attempt,
      captchaLength: enteredCaptcha.trim().length,
      captchaState: submitState,
      diagnostic: submitDiagnostic
    });

    await clickEnforcementSearch(page);
    await page.waitForTimeout(2500);

    const confirmed = await waitUntil(page, `China Enforcement result for ${subjectName}`, async () => {
      const text = await pageText(page);
      if (isCaptchaFailure(text) || isEnforcementCaptchaFailure(text)) return true;
      return isEnforcementResultState(text) || isEnforcementModuleResultState(text);
    }, 30000).then(() => true).catch(() => false);

    const text = await pageText(page);
    if (confirmed && (isEnforcementResultState(text) || isEnforcementModuleResultState(text)) && !isCaptchaFailure(text) && !isEnforcementCaptchaFailure(text)) {
      console.log(`执行公开网 ${subjectName} 已确认进入查询结果/无结果页面。`);
      page.__postLoanEnforcementValidated = true;
      audit?.record("enforcement_result_confirmed", {
        subjectName,
        attempt,
        url: page.url(),
        diagnostic: await getEnforcementDiagnosticState(page)
      });
      return { ok: true, text };
    }

    console.log(`执行公开网 ${subjectName} 尚未确认查询成功，可能是验证码错误、验证码已刷新或页面无响应。正在刷新验证码，请输入新图上的验证码。`);
    audit?.record("enforcement_captcha_attempt_failed", {
      subjectName,
      attempt,
      url: page.url(),
      textSample: text.slice(0, 200),
      diagnostic: await getEnforcementDiagnosticState(page)
    });
    await resetEnforcementCaptcha(page, subjectName, codeOrId, audit);
  }
  throw new Error(`执行公开网 ${subjectName} 多次验证码/查询未成功，拒绝截图`);
}

async function completeEnforcementQuery(context, page, subjectName, codeOrId, audit, options = {}) {
  let current = page;
  for (let recovery = 1; recovery <= 3; recovery += 1) {
    try {
      if (!current || current.isClosed()) {
        current = await context.newPage();
        await fillEnforcementQuery(current, subjectName, codeOrId);
      }
      await runEnforcementAfterCaptcha(current, subjectName, codeOrId, audit, options);
      return current;
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      if (!/Target page|has been closed|Page closed/.test(message) || recovery === 3) throw error;
      console.log(`执行公开网 ${subjectName} 页面已关闭，正在重新打开并恢复查询，第 ${recovery + 1}/3 次...`);
      audit?.record("enforcement_page_recovered", { subjectName, recovery, error: message });
      current = await context.newPage();
      await fillEnforcementQuery(current, subjectName, codeOrId);
    }
  }
  return current;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const company = args.company;
  const outDir = args["out-dir"];
  let orgCode = args["org-code"] || "";
  const subjectType = args["subject-type"] || "enterprise";
  const includeHealthCommission = Boolean(args["include-health-commission"]);
  const skipJudicial = Boolean(args["skip-judicial"]);
  const skipSearch = Boolean(args["skip-search"]);
  const judicialMode = args["judicial-mode"] || ChallengeMode.ASSISTED;
  const headless = Boolean(args.headless);
  const requiresForeground = !skipJudicial && judicialMode !== ChallengeMode.BLOCKED;
  const persons = args.person.map(parsePerson);

  if (!company || !outDir) throw new Error("--company and --out-dir are required");
  if (subjectType === "person" && !orgCode) throw new Error("--org-code must be the personal ID number for person subjects");

  if (!skipJudicial && judicialMode !== ChallengeMode.BLOCKED) {
    console.log("启动阶段只麻烦用户一次：");
    console.log("1. 请在打开的 Chrome 中登录中国裁判文书网。");
    console.log("2. 中国执行信息公开网可能需要登录；如果页面提示登录，请在启动阶段完成登录。");
    console.log("3. 中国执行信息公开网页面经常加载失败，我会自动多次重试；你只需要等页面出现输入框。");
    console.log("4. 请在每个中国执行信息公开网页面只输入验证码。名称、组织机构代码/身份证号由我填。");
    console.log("5. 验证码可能多次不对或过期；如果页面没有进入查询结果/无结果状态，我不会截图，会继续等你重新输入验证码。");
    if (persons.length) console.log(`6. 本次会同步查询 ${persons.map((p) => p.name).join("、")} 的被执行信息；相关验证码也会在启动阶段一次性处理。`);
    console.log("完成后不用回来告诉我，脚本会自动检测，确认真的查询成功后再截图并继续交付。");
  } else {
    console.log("后台查询模式：本次不需要人工登录或验证码，系统将自动完成可用门户查询。");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const audit = new AuditLog(outDir);
  audit.record("run_started", { company, subjectType, includeHealthCommission, skipJudicial, judicialMode });
  const chromeCandidates = [
    process.env.POST_LOAN_CHROME_EXE,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe") : ""
  ].filter(Boolean);
  const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  const sessionManager = new SessionManager({ audit });
  const profileScope = skipJudicial ? "government" : "judicial";
  const persistentProfile = sessionManager.profilePath(profileScope);
  const profile = skipJudicial
    ? path.join(persistentProfile, `run-${Date.now()}-${process.pid}`)
    : persistentProfile;
  fs.mkdirSync(profile, { recursive: true });
  const sourceStateStore = new SourceStateStore({ file: path.join(persistentProfile, "source-state.json"), audit });
  const judicialPolicy = new JudicialSourcePolicy({ mode: judicialMode, audit });
  const previousSession = sessionManager.readState(profileScope);
  audit.record("browser_profile_selected", { scope: profileScope, profile, persistentProfile, hasPreviousSession: Boolean(previousSession) });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chrome,
    headless: headless && !requiresForeground,
    viewport: { width: 1268, height: 755 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai"
  });

  const page = await context.newPage();
  const enforcementPage = skipJudicial ? null : await context.newPage();
  const shots = [];
  const add = makeAdd(outDir, shots);

  let orgCodeLookup = null;
  if (subjectType === "enterprise" && !orgCode && !skipJudicial) {
    console.log("未提供统一社会信用代码，先自动查询企业代码...");
    orgCodeLookup = await lookupOrgCode(context, company);
    orgCode = orgCodeLookup.code;
    if (!orgCode) {
      throw new Error(`未能自动确定 ${company} 的统一社会信用代码/组织机构代码。请在启动任务时补充该代码。`);
    }
    if (orgCodeLookup.ambiguous) {
      console.log(`自动查到多个疑似代码，先使用第一个：${orgCode}。候选：${orgCodeLookup.candidates.join(", ")}`);
    } else {
      console.log(`自动查到统一社会信用代码：${orgCode}`);
    }
  }

  if (!skipJudicial && judicialPolicy.shouldBlock()) {
    audit.record("judicial_sources_blocked", { company, mode: judicialMode });
  }

  const judicialEnabled = !skipJudicial && !judicialPolicy.shouldBlock();

  if (judicialEnabled) {
    judicialPolicy.recordDecision("wenshu", judicialPolicy.canAutoSolveCaptcha() ? "auto_mode" : "assisted_mode");
    judicialPolicy.recordDecision("zhixing", judicialPolicy.canAutoSolveCaptcha() ? "auto_mode" : "assisted_mode");
    await goto(page, "https://wenshu.court.gov.cn/");
    await fillEnforcementQuery(enforcementPage, company, orgCode);
  }

  const personQueries = [];
  for (const person of judicialEnabled ? persons : []) {
    const personPage = await context.newPage();
    await fillEnforcementQuery(personPage, person.name, person.idNumber);
    personQueries.push({ person, page: personPage });
  }

  if (judicialEnabled) {
    console.log("等待裁判文书网登录成功...");
    await waitUntil(page, "China Judgments Online login", async () => {
      const body = await pageText(page);
      return body.includes("退出") || body.includes("欢迎您");
    });
    console.log("裁判文书网登录已确认，先执行裁判文书搜索，执行公开网稍后单独处理。");
  } else {
    console.log("本次按临时口径跳过裁判文书网和执行信息公开网。");
  }

  const portalQueue = new TaskQueue({ audit, concurrency: 1, defaultRetries: 1, defaultTimeoutMs: 90000 });
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
    run: async () => withPortalPage((portalPage) => tryCapturePortal(portalPage, shots, "河南省应急管理厅", add("河南省应急管理厅"), `https://yjglt.henan.gov.cn/wzjs/?keywords=${encodeURIComponent(company)}`))
  });
  portalQueue.add({
    id: "portal-henan-ecology",
    sourceId: "henan_ecology",
    run: async () => withPortalPage((portalPage) => tryCapturePortal(portalPage, shots, "河南省生态环境厅", add("河南省生态环境厅"), `https://sthjt.henan.gov.cn/wzjs/?keywords=${encodeURIComponent(company)}`))
  });
  portalQueue.add({
    id: "portal-henan-market",
    sourceId: "henan_market",
    run: async () => withPortalPage((portalPage) => tryCapturePortal(portalPage, shots, "河南省市场监督管理局", add("河南省市场监督管理局"), `https://scjg.henan.gov.cn/search/?keywords=${encodeURIComponent(company)}`))
  });
  if (includeHealthCommission) {
    portalQueue.add({
      id: "portal-health-local-or-provincial",
      sourceId: "henan_health",
      run: async () => withPortalPage((portalPage) => tryCapturePortalCandidates(
        portalPage,
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
      ))
    });
  }
  await portalQueue.runAll();
  audit.record("portal_queue_completed", {
    company,
    results: portalQueue.results || []
  });

  if (judicialEnabled) {
    file = add("中国裁判文书网");
    await goto(page, `https://wenshu.court.gov.cn/website/wenshu/181217BMTKHNT2W0/index.html?s21=${encodeURIComponent(company)}`);
    await fillAndSearchJudgments(page, company);
    await page.waitForTimeout(4000);
    await capture(page, shots, "中国裁判文书网", file);

    let validatedEnforcementPage = null;
    try {
      console.log("开始单独处理执行公开网验证码。");
      validatedEnforcementPage = await completeEnforcementQuery(context, enforcementPage, company, orgCode, audit, { mode: judicialMode });
      for (const query of personQueries) {
        console.log(`等待 ${query.person.name} 的个人被执行查询验证码输入...`);
        query.page = await completeEnforcementQuery(context, query.page, query.person.name, query.person.idNumber, audit, { mode: judicialMode });
      }
    } catch (error) {
      console.log(`执行公开网未能确认进入结果页：${error && error.message ? error.message : error}`);
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
    await capture(personPage, shots, `个人被执行信息-${person.name}`, file, 0, { enforcementValidated: Boolean(personPage.__postLoanEnforcementValidated) });

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

  if (!skipSearch) {
    const searchManager = new SearchManager({
      audit,
      cooldownMs: Number(args["search-cooldown-ms"] || 8 * 60 * 1000),
      stateStore: sourceStateStore
    });
    await searchManager.capture({
      page,
      company,
      add,
      captureCompleteScroll: async (searchPage, addFile, baseName) => {
        await captureCompleteScroll(searchPage, shots, addFile, baseName);
      }
    });
  } else {
    audit.record("search_skipped", { company });
  }

  const manifest = {
    company,
    orgCode,
    orgCodeLookup,
    subjectType,
    includeHealthCommission,
    skipJudicial,
    persons: persons.map((p) => ({ name: p.name })),
    templateSlots: true,
    generatedAt: new Date().toISOString(),
    screenshots: shots,
    outputDir: outDir
  };
  fs.writeFileSync(path.join(outDir, "template-slots-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  audit.record("run_completed", { company, screenshotCount: shots.length });
  sessionManager.writeState(profileScope, {
    status: "valid",
    company,
    skipJudicial,
    judicialMode,
    lastRunAt: new Date().toISOString()
  });
  audit.flush();
  await context.close();
  if (skipJudicial) fs.rmSync(profile, { recursive: true, force: true });
  console.log(path.join(outDir, "template-slots-manifest.json"));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
