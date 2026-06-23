const fs = require("fs");
const path = require("path");

function fromCodePoints(points) {
  return String.fromCodePoint(...points);
}

const LOGIN_RE = new RegExp(fromCodePoints([0x767b, 0x5f55]));
const PLEASE_LOGIN_RE = new RegExp(fromCodePoints([0x8bf7, 0x767b, 0x5f55]));
const CODE_RE = new RegExp(fromCodePoints([0x9a8c, 0x8bc1, 0x7801]));
const CHECK_CODE_RE = new RegExp(fromCodePoints([0x6821, 0x9a8c, 0x7801]));
const CONFIRM_ITEM_RE = new RegExp(fromCodePoints([0x786e, 0x8ba4, 0x9879]));
const LOAD_FAILED_RE = new RegExp(fromCodePoints([0x52a0, 0x8f7d, 0x5931, 0x8d25]));
const NOT_CONFIRMED_RE = new RegExp(fromCodePoints([0x672a, 0x80fd, 0x786e, 0x8ba4]));
const STILL_NOT_CONFIRMED_RE = new RegExp(fromCodePoints([0x5c1a, 0x672a, 0x786e, 0x8ba4]));
const AUTH_JUDICIAL_RE = new RegExp(fromCodePoints([0x6388, 0x6743, 0x53f8, 0x6cd5]));

function readJson(file) {
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function classifyMessage(message) {
  const text = String(message || "");
  if (/waf|WZWS|403 Forbidden|status\":?\s*403|status\":?\s*400|static resource|core resource/i.test(text)) return "waf_or_static_resource_blocked";
  if (/cooling down|cooldown/i.test(text)) return "source_cooldown";
  if (/login/i.test(text) || LOGIN_RE.test(text) || PLEASE_LOGIN_RE.test(text)) return "session_or_login_required";
  if (/failed to load|required subject and challenge fields|Target page|closed|timeout|Timed out/i.test(text) || LOAD_FAILED_RE.test(text)) return "entry_or_page_unavailable";
  if (/result page was not validated|result_not_confirmed|not reach a result|did not reach a confirmed result/i.test(text) || NOT_CONFIRMED_RE.test(text) || STILL_NOT_CONFIRMED_RE.test(text)) return "result_state_unconfirmed";
  if (/captcha|challenge/i.test(text) || CODE_RE.test(text) || CHECK_CODE_RE.test(text) || CONFIRM_ITEM_RE.test(text)) return "page_challenge_unresolved";
  if (/authorized judicial provider|authorized provider/i.test(text) || AUTH_JUDICIAL_RE.test(text)) return "authorized_provider_missing";
  return text ? "other" : "unknown";
}

function classifyEvents(events) {
  const categories = new Map();
  const add = (category, event) => {
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(event);
  };

  for (const event of events) {
    const type = String(event.type || "");
    const message = String(event.error || event.reason || event.lastReason || event.missingReason || event.textSample || "");
    if (/judgment_portal_capture_failed/.test(type)) add(classifyMessage(message), event);
    if (/enforcement_captcha_attempt_failed|enforcement_captcha_changed_before_submit/.test(type)) add("page_challenge_unresolved", event);
    if (/enforcement_page_recovered/.test(type)) add("entry_or_page_unavailable", event);
    if (/judicial_source_failure|judicial_attempt_failed/.test(type)) add(classifyMessage(message), event);
    if (/enforcement_response/.test(type) && (Number(event.status) === 400 || Number(event.status) === 403)) {
      add("waf_or_static_resource_blocked", event);
    }
    if (/source_state_cooldown|judicial_source_cooling_down/.test(type)) add("source_cooldown", event);
    if (/judgment_authorized_provider_used|enforcement_authorized_provider_used|person_enforcement_authorized_provider_used/.test(type)) add("authorized_provider_used", event);
  }

  return [...categories.entries()].map(([category, items]) => ({
    category,
    count: items.length,
    samples: items.slice(-3).map((item) => ({
      type: item.type,
      at: item.at,
      sourceId: item.sourceId || "",
      subjectName: item.subjectName || "",
      route: item.route || "",
      reason: item.reason || item.error || item.lastReason || ""
    }))
  })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function missingJudicialEvidence(manifest) {
  const missing = asArray(manifest?.requiredEvidence?.missingRequired);
  return missing
    .filter((item) => /judicial|enforcement|person_enforcement/.test(String(item.id || "")))
    .map((item) => ({
      id: item.id,
      label: item.label,
      reason: item.missingReason
    }));
}

function summarizeJudicialDiagnostics({ runDir, manifestPath } = {}) {
  const manifestFile = manifestPath || (runDir ? path.join(runDir, "template-slots-manifest.json") : "");
  const auditFile = runDir ? path.join(runDir, "audit-events.json") : "";
  const manifestExists = Boolean(manifestFile && fs.existsSync(manifestFile));
  const manifest = readJson(manifestFile) || {};
  const events = asArray(readJson(auditFile));
  const missing = missingJudicialEvidence(manifest);
  const eventCategories = classifyEvents(events);
  const providerUsed = eventCategories.some((item) => item.category === "authorized_provider_used");
  const categories = [...eventCategories];

  if (!manifestExists) {
    categories.unshift({
      category: "required_judicial_evidence_missing",
      count: 1,
      samples: [{
        type: "manifest",
        at: "",
        sourceId: "judicial_required_evidence",
        subjectName: "",
        route: "",
        reason: "manifest_not_created"
      }]
    });
  } else if (missing.length) {
    categories.unshift({
      category: "required_judicial_evidence_missing",
      count: missing.length,
      samples: missing.map((item) => ({
        type: "requiredEvidence",
        at: "",
        sourceId: item.id,
        subjectName: "",
        route: "",
        reason: item.reason
      }))
    });
  }

  if (!categories.length && manifest?.judicialEnabled !== false) {
    categories.push({
      category: "judicial_completed",
      count: 1,
      samples: []
    });
  }

  return {
    ok: manifestExists && missing.length === 0,
    providerUsed,
    missing,
    categories
  };
}

module.exports = {
  classifyEvents,
  classifyMessage,
  summarizeJudicialDiagnostics
};
