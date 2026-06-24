const assert = require("assert");
const {
  parseArgs,
  routeReadiness,
  sourceRoutes,
  summarize
} = require("./diagnose-official-sources");

const args = parseArgs(["--company", "濮阳测试有限公司", "--json", "--timeout-ms", "9000", "--fail-on-unready"]);
assert.strictEqual(args.company, "濮阳测试有限公司");
assert.strictEqual(args.json, true);
assert.strictEqual(args.timeoutMs, 9000);
assert.strictEqual(args.failOnUnready, true);

const routes = sourceRoutes("濮阳测试有限公司");
assert.ok(routes.some((route) => route.sourceType === "judgment" && route.urlValue.includes("wenshu.court.gov.cn")));
assert.ok(routes.some((route) => route.sourceType === "enforcement" && route.urlValue.includes("zxgk.court.gov.cn")));
assert.ok(routes.some((route) => route.sourceType === "official_navigation" && route.resultCapable === false));
assert.strictEqual(routeReadiness({ resultCapable: false }, "official_navigation_not_subject_result"), "navigation_only");
assert.strictEqual(routeReadiness({ resultCapable: true }, "official_form_ready"), "ready");
assert.strictEqual(routeReadiness({ resultCapable: true }, "session_or_login_required"), "needs_authorized_session");
assert.strictEqual(routeReadiness({ resultCapable: true }, "page_challenge_unresolved"), "needs_managed_confirmation");
assert.strictEqual(routeReadiness({ resultCapable: true }, "blank_or_empty_official_page"), "unavailable");

const summary = summarize([
  { sourceType: "judgment", resultCapable: true, readiness: "needs_authorized_session", category: "session_or_login_required" },
  { sourceType: "enforcement", resultCapable: true, readiness: "ready", category: "official_form_ready" },
  { sourceType: "official_navigation", resultCapable: false, readiness: "navigation_only", category: "official_navigation_not_subject_result" }
]);
assert.strictEqual(summary.judgment.readyRoutes, 0);
assert.strictEqual(summary.enforcement.readyRoutes, 1);
assert.strictEqual(summary.official_navigation.resultCapableRoutes, 0);

console.log("official-source-diagnostics ok");
