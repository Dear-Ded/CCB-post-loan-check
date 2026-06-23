const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { AuditLog } = require("./framework/audit");
const { SearchManager } = require("./framework/search_manager");
const { ChallengeEngine } = require("./framework/challenge_engine");
const { SourceStateStore } = require("./framework/source_state_store");
const { buildRequiredEvidence } = require("./framework/evidence_contract");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith("--") ? next : true;
    if (out[key] === next) i += 1;
  }
  return out;
}

function safePart(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 80);
}

function makeAdd(outDir, shots) {
  return (name) => path.join(outDir, `${String(shots.length + 1).padStart(2, "0")}-${safePart(name)}.png`);
}

async function pageText(page) {
  return (await page.locator("body").innerText({ timeout: 3000 }).catch(() => "")).replace(/\s+/g, " ");
}

function validateBasic(text, url, company, { requireSubject = false } = {}) {
  const problems = [];
  if (!text || text.replace(/\s+/g, "").length < 30) problems.push("blank_or_short_page");
  if (/login|passport|verify|captcha|安全验证|访问异常|异常流量|unusualtraffic/i.test(`${url} ${text}`)) {
    problems.push("login_challenge_or_abnormal_page");
  }
  if (requireSubject && !String(text || "").includes(company)) problems.push("subject_not_found");
  return { ok: problems.length === 0, problems };
}

async function capture(page, manifest, name, url, options = {}) {
  const shots = manifest.screenshots || [];
  const outDir = manifest.outputDir || path.dirname(options.manifestPath);
  const add = makeAdd(outDir, shots);
  const file = add(name);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: file, fullPage: false });
  const text = await pageText(page);
  const validation = validateBasic(text, page.url(), manifest.company, options);
  const entry = {
    slot: shots.length + 1,
    name,
    screenshot: file,
    text,
    url: page.url(),
    validation
  };
  if (!validation.ok) {
    fs.rmSync(file, { force: true });
    return { ok: false, entry, validation };
  }
  shots.push(entry);
  manifest.screenshots = shots;
  return { ok: true, entry, validation };
}

async function captureCompleteScroll(page, manifest, baseName) {
  const shots = manifest.screenshots || [];
  const beforeCount = shots.length;
  const add = makeAdd(manifest.outputDir, shots);
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
    await page.evaluate((y) => window.scrollTo(0, y), deduped[i]).catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: file, fullPage: false });
    const text = await pageText(page);
    shots.push({
      slot: shots.length + 1,
      name: `${baseName}${suffix}`,
      screenshot: file,
      text,
      url: page.url(),
      validation: validateBasic(text, page.url(), manifest.company)
    });
  }
  manifest.screenshots = shots;
  return shots.slice(beforeCount).filter((shot) => shot.validation?.ok);
}

function missingIds(manifest) {
  const evidence = buildRequiredEvidence(manifest);
  return new Set((evidence.missingRequired || []).map((item) => item.id));
}

async function repairSearch(context, manifest, audit) {
  const page = await context.newPage();
  const searchManager = new SearchManager({
    audit,
    stateStore: new SourceStateStore({ file: path.join(manifest.outputDir, "repair-source-state.json"), audit }),
    challengeEngine: new ChallengeEngine({ audit })
  });
  try {
    return await searchManager.capture({
      page,
      company: manifest.company,
      add: makeAdd(manifest.outputDir, manifest.screenshots || []),
      captureCompleteScroll: async (searchPage, addFile, baseName) => {
        return captureCompleteScroll(searchPage, manifest, baseName);
      },
      discardCaptures: (entries) => {
        const discardSet = new Set(entries);
        for (const entry of entries) {
          if (entry?.screenshot) fs.rmSync(entry.screenshot, { force: true });
        }
        manifest.screenshots = (manifest.screenshots || []).filter((shot) => !discardSet.has(shot));
      }
    });
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.manifest;
  if (!manifestPath) throw new Error("--manifest is required");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.outputDir = manifest.outputDir || path.dirname(manifestPath);
  manifest.screenshots = manifest.screenshots || [];
  const audit = new AuditLog(manifest.outputDir);
  const before = buildRequiredEvidence(manifest);
  const ids = missingIds(manifest);

  const userDataDir = path.join(os.homedir(), ".codex", "post-loan-portal-check", "repair-required-evidence-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: Boolean(args.headless),
    viewport: { width: 1268, height: 755 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai"
  });

  try {
    const page = await context.newPage();
    const company = encodeURIComponent(manifest.company);
    const tasks = [
      ["portal_henan_emergency", "河南省应急管理厅", `https://yjglt.henan.gov.cn/wzjs/?keywords=${company}`, false],
      ["portal_henan_ecology", "河南省生态环境厅", `https://sthjt.henan.gov.cn/wzjs/?keywords=${company}`, false],
      ["portal_henan_market", "河南省市场监督管理局", `https://scjg.henan.gov.cn/search/?keywords=${company}`, false]
    ];
    if (ids.has("portal_health_commission")) {
      tasks.push(["portal_health_commission", "河南省卫生健康委员会", `https://wsjkw.henan.gov.cn/so.html?keywords=${company}`, true]);
      tasks.push(["portal_health_commission", "濮阳市卫生健康委员会", `https://weijian.puyang.gov.cn/?keywords=${company}`, true]);
    }
    for (const [id, name, url, requireSubject] of tasks) {
      if (!ids.has(id)) continue;
      const result = await capture(page, manifest, name, url, { manifestPath, requireSubject });
      audit.record("required_evidence_repair_attempt", { id, name, url, ok: result.ok, validation: result.validation });
      if (result.ok) ids.delete(id);
    }
    await page.close().catch(() => {});
    if (ids.has("search_engine_pages")) {
      const result = await repairSearch(context, manifest, audit);
      audit.record("required_evidence_search_repair_attempt", result);
    }
  } finally {
    await context.close().catch(() => {});
  }

  manifest.requiredEvidence = buildRequiredEvidence(manifest);
  manifest.repairRequiredEvidence = {
    attemptedAt: new Date().toISOString(),
    before,
    after: manifest.requiredEvidence
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  audit.record("required_evidence_repair_completed", {
    ok: manifest.requiredEvidence.ok,
    missingRequired: manifest.requiredEvidence.missingRequired
  });
  audit.flush();
  console.log(JSON.stringify({ ok: manifest.requiredEvidence.ok, missingRequired: manifest.requiredEvidence.missingRequired }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
