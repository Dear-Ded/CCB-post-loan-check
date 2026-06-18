const fs = require("fs");
const os = require("os");
const path = require("path");
const { ChallengeKind, ChallengeMode, detectChallengeSignal, defaultModeForSource } = require("./challenge_policy");
const { detectPageChallenge } = require("./challenge_detector");
const { OcrSolver } = require("./ocr_solver");

const SourceRisk = Object.freeze({
  LOW: "low",
  STANDARD: "standard",
  HIGH: "high",
  PROHIBITED: "prohibited"
});

const ChallengeAction = Object.freeze({
  PROCEED: "proceed",
  AUTO_OCR: "auto_ocr",
  ASSISTED: "assisted",
  COOLDOWN: "cooldown",
  BLOCK: "block"
});

const DEFAULT_SOURCE_POLICIES = {
  public: {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowOcr: true,
    allowSessionReuse: true,
    allowAssisted: true,
    allowRetry: true
  },
  "public-low-risk": {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowOcr: true,
    allowSessionReuse: true,
    allowAssisted: true,
    allowRetry: true
  },
  authorized: {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowOcr: true,
    allowSessionReuse: true,
    allowAssisted: true,
    allowRetry: true
  },
  internal: {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowOcr: true,
    allowSessionReuse: true,
    allowAssisted: true,
    allowRetry: true
  },
  "search-engine": {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowOcr: false,
    allowSessionReuse: false,
    allowAssisted: false,
    allowRetry: true,
    cooldownOnChallenge: true
  },
  government: {
    risk: SourceRisk.HIGH,
    mode: ChallengeMode.ASSISTED,
    allowOcr: false,
    allowSessionReuse: true,
    allowAssisted: true
  },
  "government-strong": {
    risk: SourceRisk.HIGH,
    mode: ChallengeMode.ASSISTED,
    allowOcr: false,
    allowSessionReuse: true,
    allowAssisted: true
  },
  judicial: {
    risk: SourceRisk.HIGH,
    mode: ChallengeMode.ASSISTED,
    allowOcr: false,
    allowSessionReuse: true,
    allowAssisted: true
  },
  prohibited: {
    risk: SourceRisk.PROHIBITED,
    mode: ChallengeMode.BLOCKED,
    allowOcr: false,
    allowSessionReuse: false,
    allowAssisted: false
  }
};

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function loadPolicyFile(file, audit) {
  if (!file) return {};
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    audit?.record("challenge_policy_file_failed", { file, error: String(error.message || error) });
    return {};
  }
}

function mergePolicy(base, override) {
  return { ...(base || {}), ...(override || {}) };
}

function isAutoEscalation(base, policy) {
  return base.mode !== ChallengeMode.AUTO && policy.mode === ChallengeMode.AUTO;
}

function riskWarningFor(base, policy, sourceType, sourceId) {
  if (!isAutoEscalation(base, policy)) return "";
  const target = sourceId || sourceType || "source";
  if (base.risk === SourceRisk.HIGH || base.risk === SourceRisk.PROHIBITED) {
    return `${target} is configured for auto handling although its default risk is ${base.risk}. The user is responsible for confirming authorization, compliance, and account-risk acceptance.`;
  }
  return `${target} is configured for auto handling instead of the safer default. Confirm authorization and compliance before use.`;
}

function overrideConfirmed(policy) {
  return Boolean(policy.riskAcknowledged || policy.userRiskAccepted || policy.confirmedByUser);
}

function defaultRiskConsentFile() {
  return path.join(os.homedir(), ".codex", "post-loan-portal-check", "challenge-risk-consent.json");
}

function readRiskConsent(file, audit) {
  if (envFlag("POST_LOAN_HIGH_RISK_AUTO_ACK", false)) return { accepted: true, source: "env" };
  try {
    if (!file || !fs.existsSync(file)) return { accepted: false, source: "" };
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      accepted: Boolean(payload.highRiskAutoAccepted),
      source: file,
      acceptedAt: payload.acceptedAt || "",
      acceptedBy: payload.acceptedBy || ""
    };
  } catch (error) {
    audit?.record("challenge_risk_consent_read_failed", { file, error: String(error.message || error) });
    return { accepted: false, source: "" };
  }
}

class ChallengeEngine {
  constructor({
    audit,
    policyFile = process.env.POST_LOAN_CHALLENGE_POLICY,
    allowLowRiskOcr = envFlag("POST_LOAN_ENABLE_LOW_RISK_OCR", true),
    riskConsentFile = process.env.POST_LOAN_RISK_CONSENT_FILE || defaultRiskConsentFile(),
    pythonExe = process.env.POST_LOAN_PYTHON_EXE || "python",
    ocrHelperPath,
    ocrSolver
  } = {}) {
    this.audit = audit;
    this.policyFile = policyFile;
    this.allowLowRiskOcr = allowLowRiskOcr;
    this.policyOverrides = loadPolicyFile(policyFile, audit);
    this.riskConsentFile = riskConsentFile;
    this.riskConsent = readRiskConsent(riskConsentFile, audit);
    this.ocrSolver = ocrSolver || new OcrSolver({
      pythonExe,
      helperPath: ocrHelperPath,
      enabled: allowLowRiskOcr,
      audit
    });
  }

  policyFor(sourceType = "standard", sourceId = "") {
    const base = DEFAULT_SOURCE_POLICIES[sourceType] || {
      risk: SourceRisk.LOW,
      mode: ChallengeMode.AUTO,
      allowOcr: true,
      allowSessionReuse: true,
      allowAssisted: true,
      allowRetry: true
    };
    const byType = this.policyOverrides[sourceType] || {};
    const byId = sourceId ? (this.policyOverrides[sourceId] || {}) : {};
    const policy = mergePolicy(mergePolicy(base, byType), byId);
    const warning = riskWarningFor(base, policy, sourceType, sourceId);
    const acknowledged = overrideConfirmed(policy) || (warning && this.riskConsent.accepted);
    return {
      ...policy,
      defaultMode: base.mode,
      defaultRisk: base.risk,
      userOverride: Boolean(Object.keys(byType).length || Object.keys(byId).length),
      riskAcknowledged: Boolean(acknowledged),
      riskAcknowledgementSource: overrideConfirmed(policy) ? "policy" : (this.riskConsent.accepted ? this.riskConsent.source : ""),
      riskWarning: warning
    };
  }

  detect(input) {
    return detectChallengeSignal(input);
  }

  decide({ sourceId = "", sourceType = "standard", challenge, mode } = {}) {
    const policy = this.policyFor(sourceType, sourceId);
    const effectiveMode = mode || policy.mode || defaultModeForSource(sourceType);
    const unconfirmedAutoEscalation = policy.riskWarning && !policy.riskAcknowledged;

    if (!challenge || challenge.kind === ChallengeKind.NONE) {
      return { action: ChallengeAction.PROCEED, policy, effectiveMode, reason: "" };
    }

    if (unconfirmedAutoEscalation) {
      const fallbackAction = policy.allowAssisted ? ChallengeAction.ASSISTED : ChallengeAction.BLOCK;
      return {
        action: fallbackAction,
        policy,
        effectiveMode: policy.defaultMode || effectiveMode,
        reason: "risk_acknowledgement_required"
      };
    }

    if (policy.risk === SourceRisk.PROHIBITED || effectiveMode === ChallengeMode.BLOCKED) {
      const action = policy.cooldownOnChallenge ? ChallengeAction.COOLDOWN : ChallengeAction.BLOCK;
      return { action, policy, effectiveMode, reason: challenge.reason || "blocked_by_policy" };
    }

    if (
      challenge.kind === ChallengeKind.CAPTCHA &&
      effectiveMode === ChallengeMode.AUTO &&
      policy.allowOcr &&
      this.allowLowRiskOcr &&
      this.ocrSolver.canSolve()
    ) {
      return { action: ChallengeAction.AUTO_OCR, policy, effectiveMode, reason: "low_risk_ocr_enabled" };
    }

    if (policy.allowAssisted && effectiveMode !== ChallengeMode.BLOCKED) {
      return { action: ChallengeAction.ASSISTED, policy, effectiveMode, reason: challenge.reason || "assisted_required" };
    }

    return { action: ChallengeAction.BLOCK, policy, effectiveMode, reason: challenge.reason || "blocked_by_policy" };
  }

  async inspectPage(page, { sourceId = "", sourceType = "standard", sourceName = "", mode } = {}) {
    const snapshot = await detectPageChallenge(page);
    const decision = this.decide({ sourceId, sourceType, challenge: snapshot.challenge, mode });
    this.audit?.record("challenge_engine_decision", {
      sourceId,
      sourceType,
      sourceName,
      url: snapshot.url,
      title: snapshot.title,
      challenge: snapshot.challenge,
      action: decision.action,
      reason: decision.reason,
      risk: decision.policy.risk,
      mode: decision.effectiveMode,
      ocrEnabled: this.allowLowRiskOcr,
      userOverride: decision.policy.userOverride,
      riskAcknowledged: decision.policy.riskAcknowledged,
      riskAcknowledgementSource: decision.policy.riskAcknowledgementSource,
      riskWarning: decision.policy.riskWarning
    });
    return { ...snapshot, decision };
  }

  solveImage(imagePath, sourceId = "unknown") {
    return this.ocrSolver.solveImage(imagePath, sourceId);
  }

  static defaultPolicyPath(skillRoot) {
    return path.join(skillRoot, "references", "challenge-policy.example.json");
  }

  static defaultRiskConsentFile() {
    return defaultRiskConsentFile();
  }
}

module.exports = {
  ChallengeEngine,
  ChallengeAction,
  SourceRisk,
  DEFAULT_SOURCE_POLICIES
};
