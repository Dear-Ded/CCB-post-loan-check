function asArray(value) {
  if (value && Array.isArray(value.items)) return value.items;
  if (value && typeof value === "object" && !Array.isArray(value)) return [value];
  return Array.isArray(value) ? value : [];
}

function categoriesOf(item) {
  return asArray(item?.judicialDiagnostics?.categories).map((category) => String(category.category || ""));
}

function recommendedAction(categories) {
  const set = new Set(categories);
  if (set.has("session_or_login_required")) return "refresh_session_then_retry";
  if (set.has("entry_or_page_unavailable")) return "retry_with_route_rotation";
  if (set.has("source_cooldown")) return "retry_after_cooldown";
  if (set.has("page_challenge_unresolved")) return "retry_managed_official_confirmation";
  if (set.has("result_state_unconfirmed")) return "retry_with_longer_result_wait";
  if (set.has("authorized_provider_missing")) return "retry_required_official_sources";
  if (set.has("required_judicial_evidence_missing")) return "retry_required_judicial_sources";
  return "retry_failed_run";
}

function buildRetryPlan(summary) {
  const rows = asArray(summary);
  const items = [];
  for (const row of rows) {
    if (row?.ok) continue;
    const categories = categoriesOf(row);
    const missingEvidence = asArray(row?.missingEvidence).map((item) => ({
      id: item.id || "",
      label: item.label || "",
      reason: item.reason || ""
    }));
    items.push({
      company: row.company || "",
      orgCode: row.orgCode || "",
      attempts: row.attempts || 0,
      action: recommendedAction(categories),
      categories,
      missingEvidence,
      evidenceDir: row.evidenceDir || "",
      manifest: row.manifest || "",
      lastError: row.error || ""
    });
  }
  const byAction = items.reduce((acc, item) => {
    acc[item.action] = (acc[item.action] || 0) + 1;
    return acc;
  }, {});
  return {
    schemaVersion: "retry-plan/v1",
    ok: items.length === 0,
    generatedAt: new Date().toISOString(),
    failedCount: items.length,
    byAction,
    items
  };
}

module.exports = {
  buildRetryPlan,
  recommendedAction
};
