#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const {
  ENFORCEMENT_ROUTES,
  JUDGMENT_ROUTES,
  OFFICIAL_EXECUTION_NAVIGATION_ROUTES
} = require("../scripts/framework/judicial_routes");
const {
  classifyOfficialPageProbe
} = require("../scripts/framework/judicial_diagnostics");
const {
  browserCompatibilityArgs,
  loadRuntimePolicy
} = require("../scripts/framework/runtime_policy");

function parseArgs(argv) {
  const args = {
    company: "",
    json: false,
    headed: false,
    timeoutMs: 15000,
    output: "",
    failOnUnready: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--company" || arg === "-CompanyName") args.company = argv[++index] || "";
    else if (arg === "--json" || arg === "-Json") args.json = true;
    else if (arg === "--headed") args.headed = true;
    else if (arg === "--timeout-ms") args.timeoutMs = Number(argv[++index] || args.timeoutMs);
    else if (arg === "--output" || arg === "-Output") args.output = argv[++index] || "";
    else if (arg === "--fail-on-unready") args.failOnUnready = true;
  }
  return args;
}

function nowIso() {
  return new Date().toISOString();
}

function compactText(value, limit = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function sourceRoutes(company) {
  return [
    ...JUDGMENT_ROUTES.map((route) => ({
      ...route,
      sourceType: "judgment",
      resultCapable: route.resultCapable !== false,
      urlValue: route.url("")
    })),
    ...ENFORCEMENT_ROUTES.map((route) => ({
      ...route,
      sourceType: "enforcement",
      resultCapable: route.resultCapable !== false,
      urlValue: route.url(company || "")
    })),
    ...OFFICIAL_EXECUTION_NAVIGATION_ROUTES.map((route) => ({
      ...route,
      sourceType: "official_navigation",
      resultCapable: false,
      urlValue: route.url(company || "")
    }))
  ];
}

function routeReadiness(route, category) {
  if (category === "network_access_denied" || category === "blank_or_empty_official_page" || category === "entry_or_page_unavailable") return "unavailable";
  if (route.resultCapable === false) return "navigation_only";
  if (category === "official_form_ready" || category === "official_result_state") return "ready";
  if (category === "session_or_login_required") return "needs_authorized_session";
  if (category === "page_challenge_unresolved") return "needs_managed_confirmation";
  if (category === "partial_form_loaded") return "partial";
  return "unavailable";
}

async function visible(page, selector) {
  return page.locator(selector).first().isVisible({ timeout: 300 }).catch(() => false);
}

async function probeRoute(page, route, timeoutMs) {
  const responses = [];
  const onResponse = (response) => {
    const url = response.url();
    if (/court\.gov\.cn/i.test(url)) {
      responses.push({
        status: response.status(),
        url: url.slice(0, 240)
      });
    }
  };
  page.on("response", onResponse);
  try {
    await page.goto(route.urlValue, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(6000, timeoutMs) }).catch(() => {});
    await page.waitForTimeout(600);
    const text = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
    const title = await page.title().catch(() => "");
    const probe = {
      url: page.url(),
      title,
      textSample: compactText(text),
      responses: responses.slice(-20),
      hasNameField: await visible(page, "#pName"),
      hasChallengeField: await visible(page, "#yzm"),
      hasSearchButton: await visible(page, "button,input[type='button'],input[type='submit'],a"),
      hasJudgmentSearchInput: await visible(page, [
        "input.searchKey.search-inp",
        "input.searchKey",
        "#searchKey",
        "#query",
        "input[name='searchWord']",
        "input[name='keyWord']",
        "input[placeholder*='输入案由']",
        "input[placeholder*='全文检索']",
        "input[placeholder*='关键词']"
      ].join(", ")),
      officialNavigationOnly: route.resultCapable === false
    };
    if (probe.hasJudgmentSearchInput && route.sourceType === "judgment") {
      probe.hasNameField = true;
      probe.hasSearchButton = true;
    }
    const category = route.resultCapable === false
      ? "official_navigation_not_subject_result"
      : classifyOfficialPageProbe(probe);
    return {
      route: route.id,
      sourceType: route.sourceType,
      resultCapable: route.resultCapable !== false,
      url: route.urlValue,
      ok: true,
      finalUrl: page.url(),
      title,
      category,
      readiness: routeReadiness(route, category),
      textSample: compactText(text, 160),
      responses: responses.slice(-8)
    };
  } catch (error) {
    const errorText = String(error.message || error);
    const category = classifyOfficialPageProbe({
      url: route.urlValue,
      error: errorText,
      officialNavigationOnly: route.resultCapable === false
    });
    return {
      route: route.id,
      sourceType: route.sourceType,
      resultCapable: route.resultCapable !== false,
      url: route.urlValue,
      ok: false,
      category,
      readiness: routeReadiness(route, category),
      error: errorText
    };
  } finally {
    page.off("response", onResponse);
  }
}

function summarize(results) {
  const bySource = {};
  for (const result of results) {
    if (!bySource[result.sourceType]) {
      bySource[result.sourceType] = {
        readyRoutes: 0,
        resultCapableRoutes: 0,
        categories: {}
      };
    }
    const summary = bySource[result.sourceType];
    if (result.resultCapable) summary.resultCapableRoutes += 1;
    if (result.readiness === "ready") summary.readyRoutes += 1;
    summary.categories[result.category] = (summary.categories[result.category] || 0) + 1;
  }
  return bySource;
}

async function diagnose(args) {
  const policy = loadRuntimePolicy({ skillRoot: path.resolve(__dirname, "..") });
  const browser = await chromium.launch({
    headless: !args.headed,
    args: browserCompatibilityArgs(policy)
  });
  const context = await browser.newContext({
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1365, height: 900 }
  });
  const page = await context.newPage();
  const results = [];
  try {
    for (const route of sourceRoutes(args.company)) {
      results.push(await probeRoute(page, route, args.timeoutMs));
      await page.waitForTimeout(350);
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  const payload = {
    generatedAt: nowIso(),
    company: args.company,
    policy: {
      browserCompatibilityTuning: Boolean(policy?.browserCompatibilityTuning?.enabled),
      lowRiskImageTextRecognition: Boolean(policy?.lowRiskImageTextRecognition?.enabled)
    },
    ironRule: "official-source-readiness-only; no fabricated evidence; no substitute screenshots",
    summary: summarize(results),
    results
  };
  if (args.output) {
    fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  return payload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = await diagnose(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    for (const result of payload.results) {
      process.stdout.write(`${result.sourceType}/${result.route}: ${result.readiness} (${result.category}) ${result.finalUrl || result.url}\n`);
    }
  }
  const hasReadyJudicial = ["judgment", "enforcement"].every((sourceType) => {
    const item = payload.summary[sourceType];
    return item && item.readyRoutes > 0;
  });
  if (args.failOnUnready && !hasReadyJudicial) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  diagnose,
  parseArgs,
  routeReadiness,
  sourceRoutes,
  summarize
};
