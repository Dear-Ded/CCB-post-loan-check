const assert = require("assert");
const { buildRetryPlan, recommendedAction } = require("../packages/core-skill/scripts/framework/retry_plan");

assert.strictEqual(recommendedAction(["session_or_login_required"]), "refresh_session_then_retry");
assert.strictEqual(recommendedAction(["entry_or_page_unavailable"]), "retry_with_route_rotation");
assert.strictEqual(recommendedAction(["source_cooldown"]), "retry_after_cooldown");
assert.strictEqual(recommendedAction(["page_challenge_unresolved"]), "retry_managed_official_confirmation");
assert.strictEqual(recommendedAction(["result_state_unconfirmed"]), "retry_with_longer_result_wait");
assert.strictEqual(recommendedAction(["authorized_provider_missing"]), "retry_required_official_sources");

const plan = buildRetryPlan([
  { company: "A", ok: true },
  {
    company: "B",
    orgCode: "CODE",
    ok: false,
    attempts: 2,
    error: "failed",
    judicialDiagnostics: { categories: [{ category: "entry_or_page_unavailable" }] },
    missingEvidence: [{ id: "judicial_enforcement", label: "China Enforcement", reason: "missing" }]
  }
]);
assert.strictEqual(plan.ok, false);
assert.strictEqual(plan.failedCount, 1);
assert.strictEqual(plan.byAction.retry_with_route_rotation, 1);
assert.strictEqual(plan.items[0].company, "B");
assert.strictEqual(plan.items[0].orgCode, "CODE");

const singleObjectPlan = buildRetryPlan({
  company: "C",
  ok: false,
  error: "single object failed"
});
assert.strictEqual(singleObjectPlan.failedCount, 1);
assert.strictEqual(singleObjectPlan.items[0].company, "C");

const wrappedPlan = buildRetryPlan({
  items: [
    { company: "D", ok: false, error: "wrapped failed" }
  ]
});
assert.strictEqual(wrappedPlan.failedCount, 1);
assert.strictEqual(wrappedPlan.items[0].company, "D");

console.log("retry-plan ok");
