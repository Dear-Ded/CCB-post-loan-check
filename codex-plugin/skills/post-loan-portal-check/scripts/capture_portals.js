const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");
const { chromium } = require("playwright");
const { AuditLog } = require("./framework/audit");
const { DataSourceRegistry } = require("./framework/data_source_registry");
const { loadRuntimePolicy, browserCompatibilityArgs } = require("./framework/runtime_policy");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}

function safeName(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function askUser(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${message}\nPress Enter to re-check, or type SKIP to record unresolved: `, (answer) => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

async function clickLikelySearch(page) {
  const selectors = [
    "input[type=search]",
    "input[name=q]",
    "input[name=query]",
    "input[name=keyword]",
    "input[name=keywords]",
    "input[name=searchword]",
    "input[name=word]",
    "input[id*=search i]",
    "input[class*=search i]",
    "input[placeholder*=搜索]",
    "input[placeholder*=请输入]",
    "textarea[name=wd]",
    "textarea[name=word]"
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.count()) {
        await locator.click({ timeout: 2000 });
        return locator;
      }
    } catch (_) {
      // Try the next selector.
    }
  }
  return null;
}

async function fillPortalSearch(page, company) {
  const input = await clickLikelySearch(page);
  if (!input) return false;
  await input.fill(company, { timeout: 5000 });
  await page.keyboard.press("Enter");
  await page.waitForLoadState("domcontentloaded", { timeout: 12000 }).catch(() => {});
  await sleep(2500);
  return true;
}

async function navigateWithRetries(page, url) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await sleep(2000);
    }
  }
}

async function pageHealth(page) {
  const title = await page.title().catch(() => "");
  const url = page.url();
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const bodyLength = bodyText.replace(/\s+/g, "").length;
  const lower = `${title}\n${url}\n${bodyText}`.toLowerCase();
  const titleLower = String(title || "").toLowerCase();
  const compactBody = bodyText.replace(/\s+/g, "");
  const suspicious = [
    "not found",
    "access denied",
    "无法访问",
    "页面不存在",
    "出错",
    "错误",
    "挑战项",
    "安全验证",
    "拖动滑块",
    "请登录",
    "网络不给力"
  ].filter((word) => lower.includes(word.toLowerCase()));
  if (/^(404|403|500)(\s|$)/.test(titleLower) || /error\s*(404|403|500)/.test(titleLower)) {
    suspicious.push(titleLower.match(/404|403|500/)?.[0] || "error");
  }
  if (bodyLength < 120 && /(404|403|500|server error|服务器错误|页面不存在)/i.test(compactBody)) {
    suspicious.push("error-page");
  }
  return {
    title,
    url,
    bodyLength,
    suspicious,
    ok: bodyLength > 30 && suspicious.length === 0
  };
}

async function waitForManualIfNeeded(page, targetName, manualTimeoutSeconds, manualMode) {
  let health = await pageHealth(page);
  if (health.ok) return { manualWaited: false, before: health, after: health };

  const before = health;
  await page.bringToFront().catch(() => {});
  if (manualMode === "prompt") {
    while (!health.ok) {
      console.log(`[manual] ${targetName} is not acceptable yet: ${health.suspicious.join(", ") || "short/blank page"}`);
      const answer = await askUser(`[manual] Fix login, page challenge, or error page for ${targetName} in the opened browser.`);
      if (answer.toLowerCase() === "skip") break;
      health = await pageHealth(page);
    }
  } else {
    console.log(`[manual] ${targetName} may need attention: ${health.suspicious.join(", ") || "short/blank page"}`);
    console.log(`[manual] Complete login, page challenge, or confirmation if needed. Waiting ${manualTimeoutSeconds}s, then continuing.`);
    await sleep(Math.max(0, Number(manualTimeoutSeconds || 0)) * 1000);
    health = await pageHealth(page);
  }
  return { manualWaited: true, before, after: health };
}

function baiduSearchUrl(query, pageNumber) {
  const pn = (Number(pageNumber) - 1) * 10;
  return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&pn=${pn}`;
}

async function capture(page, target, screenshotPath, manualTimeoutSeconds, manualMode) {
  await waitForManualIfNeeded(page, target.name, manualTimeoutSeconds, manualMode);
  await page.setViewportSize({ width: 1365, height: 768 });
  await sleep(1000);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const stat = fs.statSync(screenshotPath);
  const health = await pageHealth(page);
  return {
    targetId: target.id,
    targetName: target.name,
    url: health.url,
    title: health.title,
    bodyLength: health.bodyLength,
    suspicious: health.suspicious,
    ok: health.bodyLength > 30 && stat.size > 8000 && health.suspicious.length === 0,
    screenshot: screenshotPath,
    screenshotSize: stat.size,
    capturedAt: new Date().toISOString()
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const company = args.company;
  const outDir = args["out-dir"];
  const headed = Boolean(args.headed) || !Boolean(args.headless);
  const manualTimeoutSeconds = Number(args["manual-timeout"] || 180);
  const manualMode = args["manual-mode"] || (Boolean(args.headless) ? "timeout" : "prompt");
  const skillRoot = process.env.POST_LOAN_SKILL_ROOT || path.resolve(__dirname, "..");

  if (!company) throw new Error("--company is required");
  if (!outDir) throw new Error("--out-dir is required");

  const siteConfig = JSON.parse(fs.readFileSync(path.join(skillRoot, "references", "sites.json"), "utf8"));
  const screenshotsDir = path.join(outDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const audit = new AuditLog(outDir);
  const runtimePolicy = loadRuntimePolicy({ skillRoot, audit });
  const sourceRegistry = new DataSourceRegistry({
    config: siteConfig,
    audit
  });
  const sourceHealth = process.env.POST_LOAN_DISABLE_SOURCE_HEALTHCHECK === "1"
    ? []
    : await sourceRegistry.healthCheckAvailable();
  const dataSourceResults = await sourceRegistry.query(company);

  const userDataDir = path.join(os.homedir(), ".codex", "post-loan-portal-check", "chrome-profile");
  fs.mkdirSync(userDataDir, { recursive: true });

  const executablePath = fs.existsSync("C:\\Users\\80983\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Users\\80983\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"
    : undefined;

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: !headed,
    viewport: { width: 1365, height: 768 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    args: browserCompatibilityArgs(runtimePolicy)
  });

  const page = context.pages()[0] || await context.newPage();
  const manifest = {
    company,
    startedAt: new Date().toISOString(),
    outputDir: outDir,
    screenshotsDir,
    sourceHealth,
    dataSourceResults,
    targets: [],
    notes: [
      "司法网站如出现挑战项、登录或安全确认，需在授权浏览器会话中完成后继续截图；本流程只记录真实结果页。",
      "门户站内搜索不可用时，自动退回到 Baidu site:domain 查询并在 strategyUsed 中记录。"
    ]
  };

  for (const target of siteConfig.targets) {
    const screenshotPath = path.join(screenshotsDir, `${String(manifest.targets.length + 1).padStart(2, "0")}-${safeName(target.name)}.png`);
    const item = { ...target };
    try {
      if (target.strategy === "baidu-page") {
        item.strategyUsed = "baidu";
        await navigateWithRetries(page, baiduSearchUrl(company, target.page || 1));
      } else if (target.strategy === "manual-judicial") {
        item.strategyUsed = "manual-official";
        await navigateWithRetries(page, target.officialUrl);
        console.log(`[manual] ${target.name}: search "${company}" in the official site, complete any page challenge or login, then continue.`);
        await page.bringToFront().catch(() => {});
        if (manualMode === "prompt") {
          await askUser(`[manual] Finish ${target.name} search for "${company}" in the opened browser.`);
        } else {
          await sleep(manualTimeoutSeconds * 1000);
        }
      } else {
        item.strategyUsed = "portal-search";
        await navigateWithRetries(page, target.officialUrl);
        const searched = await fillPortalSearch(page, company).catch(() => false);
        if (!searched) {
          item.strategyUsed = "baidu-site-fallback";
          await navigateWithRetries(page, baiduSearchUrl(`site:${target.officialDomain} ${company}`, 1));
        }
      }

      const result = await capture(page, item, screenshotPath, manualTimeoutSeconds, manualMode);
      manifest.targets.push({ ...item, ...result });
      console.log(`[ok] ${target.name} -> ${screenshotPath}`);
    } catch (error) {
      manifest.targets.push({
        ...item,
        ok: false,
        error: String(error && error.stack ? error.stack : error),
        screenshot: fs.existsSync(screenshotPath) ? screenshotPath : null,
        capturedAt: new Date().toISOString()
      });
      console.log(`[error] ${target.name}: ${error.message || error}`);
    }
  }

  manifest.finishedAt = new Date().toISOString();
  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  audit.flush();
  await context.close();
  console.log(`[manifest] ${manifestPath}`);
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
