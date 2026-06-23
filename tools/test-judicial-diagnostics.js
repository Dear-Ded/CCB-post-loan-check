const assert = require("assert");
const { classifyEvents, classifyMessage } = require("../packages/core-skill/scripts/framework/judicial_diagnostics");

assert.strictEqual(classifyMessage("China Enforcement did not reach a confirmed result page"), "result_state_unconfirmed");
assert.strictEqual(classifyMessage("captcha changed before submit"), "page_challenge_unresolved");
assert.strictEqual(classifyMessage("login required"), "session_or_login_required");
assert.strictEqual(classifyMessage("failed to load required subject and challenge fields"), "entry_or_page_unavailable");
assert.strictEqual(classifyMessage("no authorized judicial provider evidence was available"), "authorized_provider_missing");
assert.strictEqual(classifyMessage("403 Forbidden WZWS-RAY waf"), "waf_or_static_resource_blocked");

const categories = classifyEvents([
  { type: "judgment_portal_capture_failed", error: "result page was not validated" },
  { type: "enforcement_captcha_attempt_failed", textSample: "captcha error" },
  { type: "judicial_source_failure", reason: "cooling down until later" },
  { type: "enforcement_response", status: 400, url: "https://zxgk.court.gov.cn/static2/js/main.js" },
  { type: "enforcement_authorized_provider_used" }
]);

assert.deepStrictEqual(categories.map((item) => item.category), [
  "authorized_provider_used",
  "page_challenge_unresolved",
  "result_state_unconfirmed",
  "source_cooldown",
  "waf_or_static_resource_blocked"
]);

console.log("judicial-diagnostics ok");
