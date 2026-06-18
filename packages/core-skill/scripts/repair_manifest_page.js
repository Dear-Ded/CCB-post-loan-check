const fs = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("playwright");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      out[key] = next && !next.startsWith("--") ? next : true;
      if (out[key] === next) i += 1;
    }
  }
  return out;
}

function baiduSearchUrl(query, pageNumber = 1) {
  return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&pn=${(Number(pageNumber) - 1) * 10}`;
}

async function pageHealth(page) {
  const title = await page.title().catch(() => "");
  const url = page.url();
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const bodyLength = bodyText.replace(/\s+/g, "").length;
  const lower = `${title}\n${url}\n${bodyText}`.toLowerCase();
  const suspicious = [
    "not found",
    "access denied",
    "无法访问",
    "页面不存在",
    "出错",
    "错误",
    "验证码",
    "安全验证",
    "拖动滑块",
    "请登录",
    "网络不给力"
  ].filter((word) => lower.includes(word.toLowerCase()));
  return { title, url, bodyLength, suspicious, ok: bodyLength > 30 && suspicious.length === 0 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.manifest;
  const targetId = args.target;
  const mode = args.mode || "baidu-site";
  const scroll = Number(args.scroll || 0);
  if (!manifestPath || !targetId) throw new Error("--manifest and --target are required");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const target = manifest.targets.find((item) => item.id === targetId || item.targetId === targetId);
  if (!target) throw new Error(`Target not found: ${targetId}`);

  const userDataDir = path.join(os.homedir(), ".codex", "post-loan-portal-check", `repair-profile-${Date.now()}`);
  const executablePath = fs.existsSync("C:\\Users\\80983\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Users\\80983\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"
    : undefined;
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    viewport: { width: 1365, height: 768 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai"
  });
  const page = context.pages()[0] || await context.newPage();
  const query = mode === "baidu-page"
    ? manifest.company
    : `site:${target.officialDomain} ${manifest.company}`;
  await page.goto(baiduSearchUrl(query, target.page || 1), { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  if (scroll > 0) {
    await page.evaluate((y) => window.scrollTo(0, y), scroll);
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: target.screenshot, fullPage: false });
  const stat = fs.statSync(target.screenshot);
  const health = await pageHealth(page);
  Object.assign(target, {
    strategyUsed: mode === "baidu-page" ? "baidu-retry" : "baidu-site-fallback",
    url: health.url,
    title: health.title,
    bodyLength: health.bodyLength,
    suspicious: health.suspicious,
    ok: health.bodyLength > 30 && stat.size > 8000 && health.suspicious.length === 0,
    screenshotSize: stat.size,
    capturedAt: new Date().toISOString()
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await context.close();
  console.log(`${target.targetName || target.name}: ok=${target.ok} suspicious=${target.suspicious.join(",")}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
