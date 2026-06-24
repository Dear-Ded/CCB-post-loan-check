const assert = require("assert");
const {
  classifyEvents,
  classifyMessage,
  classifyOfficialPageProbe,
  readinessFromCategory,
  summarizeOfficialReadiness
} = require("../packages/core-skill/scripts/framework/judicial_diagnostics");

assert.strictEqual(classifyMessage("China Enforcement did not reach a confirmed result page"), "result_state_unconfirmed");
assert.strictEqual(classifyMessage("captcha changed before submit"), "page_challenge_unresolved");
assert.strictEqual(classifyMessage("login required"), "session_or_login_required");
assert.strictEqual(classifyMessage("failed to load required subject and challenge fields"), "entry_or_page_unavailable");
assert.strictEqual(classifyMessage("no authorized judicial provider evidence was available"), "authorized_provider_missing");
assert.strictEqual(classifyMessage("403 Forbidden WZWS-RAY waf"), "waf_or_static_resource_blocked");
assert.strictEqual(classifyMessage("judicial_wenshu aborted by capture budget"), "capture_budget_exhausted");
assert.strictEqual(readinessFromCategory("judgment", "official_form_ready"), "ready");
assert.strictEqual(readinessFromCategory("judgment", "session_or_login_required"), "needs_authorized_session");
assert.strictEqual(readinessFromCategory("official_navigation", "official_navigation_not_subject_result"), "navigation_only");

assert.strictEqual(classifyOfficialPageProbe({
  url: "https://zxgk.court.gov.cn/zhzxgk/",
  title: "",
  textSample: "",
  responses: [{ status: 400, url: "https://zxgk.court.gov.cn/zhzxgk/" }]
}), "waf_or_static_resource_blocked");
assert.strictEqual(classifyOfficialPageProbe({
  url: "https://zxgk.court.gov.cn/zhzxgk/",
  title: "",
  textSample: "",
  responses: [{ status: 200, url: "https://zxgk.court.gov.cn/" }]
}), "blank_or_empty_official_page");
assert.strictEqual(classifyOfficialPageProbe({
  hasNameField: true,
  hasChallengeField: true,
  textSample: "被执行人姓名/名称 身份证号码/组织机构代码 验证码"
}), "official_form_ready");
assert.strictEqual(classifyOfficialPageProbe({
  hasNameField: true,
  hasChallengeField: true,
  textSample: "综合查询被执行人 被执行人姓名/名称 身份证号码/组织机构代码 执行法院范围 全国法院 验证码 查询"
}), "official_form_ready");
assert.strictEqual(classifyOfficialPageProbe({
  hasResultState: true,
  textSample: "查询结果 未查询到相关信息"
}), "official_result_state");
assert.strictEqual(classifyOfficialPageProbe({
  url: "https://cjdh.court.gov.cn/performInformation.html",
  title: "最高人民法院服务人民群众系统场景导航",
  officialNavigationOnly: true,
  textSample: "失信被执行人 限制消费人员 更多>> 执行公告"
}), "official_navigation_not_subject_result");

const categories = classifyEvents([
  { type: "judgment_portal_capture_failed", error: "result page was not validated" },
  { type: "enforcement_captcha_attempt_failed", textSample: "captcha error" },
  { type: "judicial_source_failure", reason: "cooling down until later" },
  { type: "enforcement_official_route_unusable", category: "blank_or_empty_official_page" },
  { type: "enforcement_response", status: 400, url: "https://zxgk.court.gov.cn/static2/js/main.js" },
  { type: "enforcement_authorized_provider_used" }
]);

assert.deepStrictEqual(categories.map((item) => item.category), [
  "authorized_provider_used",
  "blank_or_empty_official_page",
  "page_challenge_unresolved",
  "result_state_unconfirmed",
  "source_cooldown",
  "waf_or_static_resource_blocked"
]);

const readiness = summarizeOfficialReadiness([
  { type: "official_route_preflight", sourceType: "judgment", route: "wenshu_home", category: "official_form_ready", url: "https://wenshu.court.gov.cn/" },
  { type: "official_route_preflight", sourceType: "judgment", route: "wenshu_search", category: "session_or_login_required", url: "https://wenshu.court.gov.cn/website/wenshu/" },
  { type: "official_route_preflight", sourceType: "enforcement", route: "zhzxgk_query", category: "official_form_ready", url: "https://zxgk.court.gov.cn/zhzxgk/" },
  { type: "official_route_preflight", sourceType: "official_navigation", route: "court_service_navigation_execution", category: "official_navigation_not_subject_result", url: "https://cjdh.court.gov.cn/performInformation.html" }
]);
assert.strictEqual(readiness.judgment.readyRoutes, 1);
assert.strictEqual(readiness.judgment.resultCapableRoutes, 2);
assert.strictEqual(readiness.enforcement.readyRoutes, 1);
assert.strictEqual(readiness.official_navigation.resultCapableRoutes, 0);
assert.strictEqual(readiness.official_navigation.routes[0].readiness, "navigation_only");

console.log("judicial-diagnostics ok");
