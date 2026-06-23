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
  AUTO_IMAGE_TEXT: "auto_image_text",
  ASSISTED: "assisted",
  COOLDOWN: "cooldown",
  BLOCK: "block"
});

const DEFAULT_CHALLENGE_RISK_MODEL = {
  weights: {
    challengeKinds: {
      [ChallengeKind.NONE]: 0,
      [ChallengeKind.CAPTCHA_TEXT]: 1,
      [ChallengeKind.CAPTCHA_ARITHMETIC]: 1,
      [ChallengeKind.CAPTCHA]: 3,
      [ChallengeKind.CAPTCHA_SLIDER]: 5,
      [ChallengeKind.CAPTCHA_CLICK]: 5,
      [ChallengeKind.LOGIN]: 5,
      [ChallengeKind.RATE_LIMIT]: 6,
      [ChallengeKind.SECURITY_GATE]: 8,
      [ChallengeKind.RESULT_MISMATCH]: 7,
      [ChallengeKind.UNKNOWN]: 6
    },
    sourceTypes: {
      public: 0,
      "public-low-risk": -1,
      authorized: -2,
      internal: -2,
      "search-engine": 2,
      government: 3,
      "government-strong": 4,
      judicial: 4,
      prohibited: 99,
      standard: 1
    },
    context: {
      allowImageTextRecognition: -1,
      riskAcknowledged: -1,
      enterpriseDefaultAuto: -1,
      userOverride: 1,
      sourceIdOfficialStrong: 3
    }
  },
  thresholds: {
    autoImageTextMaxScore: 2,
    assistedMaxScore: 7
  },
  autoImageTextKinds: [
    ChallengeKind.CAPTCHA_TEXT,
    ChallengeKind.CAPTCHA_ARITHMETIC
  ]
};

const DEFAULT_SOURCE_POLICIES = {
  public: {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowImageTextRecognition: false,
    allowSessionReuse: true,
    allowAssisted: true,
    allowRetry: true
  },
  "public-low-risk": {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowImageTextRecognition: false,
    allowSessionReuse: true,
    allowAssisted: true,
    allowRetry: true
  },
  authorized: {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowImageTextRecognition: false,
    allowSessionReuse: true,
    allowAssisted: true,
    allowRetry: true
  },
  internal: {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowImageTextRecognition: false,
    allowSessionReuse: true,
    allowAssisted: true,
    allowRetry: true
  },
  "search-engine": {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowImageTextRecognition: false,
    allowSessionReuse: false,
    allowAssisted: false,
    allowRetry: true,
    cooldownOnChallenge: true
  },
  government: {
    risk: SourceRisk.HIGH,
    mode: ChallengeMode.ASSISTED,
    allowImageTextRecognition: false,
    allowSessionReuse: true,
    allowAssisted: true
  },
  "government-strong": {
    risk: SourceRisk.HIGH,
    mode: ChallengeMode.ASSISTED,
    allowImageTextRecognition: false,
    allowSessionReuse: true,
    allowAssisted: true
  },
  judicial: {
    risk: SourceRisk.HIGH,
    mode: ChallengeMode.ASSISTED,
    allowImageTextRecognition: false,
    allowSessionReuse: true,
    allowAssisted: true
  },
  prohibited: {
    risk: SourceRisk.PROHIBITED,
    mode: ChallengeMode.BLOCKED,
    allowImageTextRecognition: false,
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

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return base;
  const next = { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      next[key] = deepMerge(next[key] || {}, value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function normalizePolicy(policy) {
  const next = { ...(policy || {}) };
  const legacyImageTextKey = ["allow", "Ocr"].join("");
  if (next.allowImageTextRecognition == null && next[legacyImageTextKey] != null) {
    next.allowImageTextRecognition = next[legacyImageTextKey];
  }
  delete next[legacyImageTextKey];
  return next;
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

function imageTextAdmissibilityFor(sourceType, sourceId = "") {
  const key = `${sourceType}:${sourceId}`.toLowerCase();
  if (
    sourceType === "judicial" ||
    sourceType === "government-strong" ||
    /judicial|court|wenshu|zhixing|zxgk|execution|enforcement/.test(key)
  ) {
    return {
      allowed: false,
      reason: "source_guardrail_requires_managed_official_confirmation"
    };
  }
  return { allowed: true, reason: "" };
}

function sourceLooksOfficialStrong(sourceType, sourceId = "") {
  const key = `${sourceType}:${sourceId}`.toLowerCase();
  return (
    sourceType === "judicial" ||
    sourceType === "government-strong" ||
    /judicial|court|wenshu|zhixing|zxgk|execution|enforcement/.test(key)
  );
}

function isAutoImageTextKind(kind, riskModel = DEFAULT_CHALLENGE_RISK_MODEL) {
  const kinds = riskModel.autoImageTextKinds || DEFAULT_CHALLENGE_RISK_MODEL.autoImageTextKinds;
  return kinds.includes(kind);
}

function scoreChallengeRisk({ sourceType = "standard", sourceId = "", challenge, policy, riskModel = DEFAULT_CHALLENGE_RISK_MODEL } = {}) {
  const kind = challenge?.kind || ChallengeKind.NONE;
  const weights = riskModel.weights || {};
  const challengeKinds = weights.challengeKinds || {};
  const sourceTypes = weights.sourceTypes || {};
  const context = weights.context || {};
  const contributions = [];

  function add(name, value) {
    const numeric = Number(value || 0);
    if (numeric !== 0) contributions.push({ name, value: numeric });
    return numeric;
  }

  let score = 0;
  score += add(`challengeKind:${kind}`, challengeKinds[kind] ?? challengeKinds[ChallengeKind.UNKNOWN] ?? 0);
  score += add(`sourceType:${sourceType}`, sourceTypes[sourceType] ?? sourceTypes.standard ?? 0);
  if (policy?.allowImageTextRecognition) score += add("allowImageTextRecognition", context.allowImageTextRecognition);
  if (policy?.riskAcknowledged) score += add("riskAcknowledged", context.riskAcknowledged);
  if (policy?.enterpriseDefaultAuto) score += add("enterpriseDefaultAuto", context.enterpriseDefaultAuto);
  if (policy?.userOverride) score += add("userOverride", context.userOverride);
  if (sourceLooksOfficialStrong(sourceType, sourceId)) score += add("sourceIdOfficialStrong", context.sourceIdOfficialStrong);

  return {
    score,
    contributions,
    thresholds: {
      ...DEFAULT_CHALLENGE_RISK_MODEL.thresholds,
      ...(riskModel.thresholds || {})
    },
    autoImageTextKind: isAutoImageTextKind(kind, riskModel)
  };
}

function riskModelForInvestigationMode(baseModel = DEFAULT_CHALLENGE_RISK_MODEL, investigationMode) {
  const template = investigationMode?.challengeRiskTemplate || investigationMode?.mode || "";
  if (template !== "expert-aggressive") return baseModel;
  return deepMerge(baseModel, {
    thresholds: {
      autoImageTextMaxScore: 4,
      assistedMaxScore: 8
    },
    weights: {
      challengeKinds: {
        [ChallengeKind.CAPTCHA_TEXT]: 0,
        [ChallengeKind.CAPTCHA_ARITHMETIC]: 0
      },
      context: {
        allowImageTextRecognition: -2,
        riskAcknowledged: -1,
        enterpriseDefaultAuto: -1
      }
    }
  });
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

function enterprisePrivateProfile() {
  return String(process.env.POST_LOAN_DEPLOYMENT_PROFILE || "").toLowerCase() === "enterprise-private";
}

class ChallengeEngine {
  constructor({
    audit,
    policyFile = process.env.POST_LOAN_CHALLENGE_POLICY,
    allowLowRiskImageTextRecognition = envFlag("POST_LOAN_ENABLE_LOW_RISK_IMAGE_TEXT", false),
    riskConsentFile = process.env.POST_LOAN_RISK_CONSENT_FILE || defaultRiskConsentFile(),
    deploymentProfile = process.env.POST_LOAN_DEPLOYMENT_PROFILE || "",
    pythonExe = process.env.POST_LOAN_PYTHON_EXE || "python",
    imageTextHelperPath,
    imageTextRecognitionProvider,
    investigationMode
  } = {}) {
    this.audit = audit;
    this.policyFile = policyFile;
    this.allowLowRiskImageTextRecognition = allowLowRiskImageTextRecognition;
    this.policyOverrides = loadPolicyFile(policyFile, audit);
    this.investigationMode = investigationMode || {};
    this.riskModel = riskModelForInvestigationMode(
      deepMerge(DEFAULT_CHALLENGE_RISK_MODEL, this.policyOverrides.challengeRiskModel || {}),
      investigationMode
    );
    this.riskConsentFile = riskConsentFile;
    this.riskConsent = readRiskConsent(riskConsentFile, audit);
    this.deploymentProfile = deploymentProfile;
    this.imageTextRecognitionProvider = imageTextRecognitionProvider || new OcrSolver({
      pythonExe,
      helperPath: imageTextHelperPath,
      enabled: allowLowRiskImageTextRecognition,
      audit
    });
  }

  policyFor(sourceType = "standard", sourceId = "") {
    const base = DEFAULT_SOURCE_POLICIES[sourceType] || {
      risk: SourceRisk.LOW,
      mode: ChallengeMode.AUTO,
      allowImageTextRecognition: false,
      allowSessionReuse: true,
      allowAssisted: true,
      allowRetry: true
    };
    const byType = normalizePolicy(this.policyOverrides[sourceType] || {});
    const byId = sourceId ? normalizePolicy(this.policyOverrides[sourceId] || {}) : {};
    const enterpriseAutoDefaults = enterprisePrivateProfile() && this.riskConsent.accepted && (base.risk === SourceRisk.HIGH || base.risk === SourceRisk.STANDARD);
    const enterpriseOverride = enterpriseAutoDefaults ? {
      mode: ChallengeMode.AUTO,
      allowImageTextRecognition: this.allowLowRiskImageTextRecognition,
      allowSessionReuse: true,
      allowAssisted: true,
      enterpriseDefaultAuto: true
    } : {};
    const expertLowRiskOverride = this.investigationMode?.mode === "expert" && base.risk === SourceRisk.LOW ? {
      allowImageTextRecognition: this.allowLowRiskImageTextRecognition,
      expertDefaultLowRiskImageText: true
    } : {};
    const policy = mergePolicy(mergePolicy(mergePolicy(mergePolicy(base, enterpriseOverride), expertLowRiskOverride), byType), byId);
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
    const riskScore = scoreChallengeRisk({
      sourceType,
      sourceId,
      challenge,
      policy,
      riskModel: this.riskModel
    });

    if (!challenge || challenge.kind === ChallengeKind.NONE) {
      return { action: ChallengeAction.PROCEED, policy, effectiveMode, reason: "", riskScore };
    }

    if (unconfirmedAutoEscalation) {
      const fallbackAction = policy.allowAssisted ? ChallengeAction.ASSISTED : ChallengeAction.BLOCK;
      return {
        action: fallbackAction,
        policy,
        effectiveMode: policy.defaultMode || effectiveMode,
        reason: "risk_acknowledgement_required",
        riskScore
      };
    }

    if (policy.risk === SourceRisk.PROHIBITED || effectiveMode === ChallengeMode.BLOCKED) {
      const action = policy.cooldownOnChallenge ? ChallengeAction.COOLDOWN : ChallengeAction.BLOCK;
      return { action, policy, effectiveMode, reason: challenge.reason || "blocked_by_policy", riskScore };
    }

    if (
      riskScore.autoImageTextKind &&
      effectiveMode === ChallengeMode.AUTO &&
      policy.allowImageTextRecognition &&
      this.allowLowRiskImageTextRecognition &&
      this.imageTextRecognitionProvider.canSolve()
    ) {
      const admissibility = imageTextAdmissibilityFor(sourceType, sourceId);
      if (!admissibility.allowed) {
        return {
          action: policy.allowAssisted ? ChallengeAction.ASSISTED : ChallengeAction.BLOCK,
          policy,
          effectiveMode,
          reason: admissibility.reason,
          riskScore
        };
      }
      if (riskScore.score > riskScore.thresholds.autoImageTextMaxScore) {
        return {
          action: policy.allowAssisted ? ChallengeAction.ASSISTED : ChallengeAction.BLOCK,
          policy,
          effectiveMode,
          reason: "challenge_risk_score_requires_managed_confirmation",
          riskScore
        };
      }
      return { action: ChallengeAction.AUTO_IMAGE_TEXT, policy, effectiveMode, reason: "low_risk_image_text_enabled", riskScore };
    }

    if (policy.allowAssisted && effectiveMode !== ChallengeMode.BLOCKED) {
      return { action: ChallengeAction.ASSISTED, policy, effectiveMode, reason: challenge.reason || "assisted_required", riskScore };
    }

    return { action: ChallengeAction.BLOCK, policy, effectiveMode, reason: challenge.reason || "blocked_by_policy", riskScore };
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
      imageTextRecognitionEnabled: this.allowLowRiskImageTextRecognition,
      userOverride: decision.policy.userOverride,
      riskAcknowledged: decision.policy.riskAcknowledged,
      riskAcknowledgementSource: decision.policy.riskAcknowledgementSource,
      riskWarning: decision.policy.riskWarning,
      deploymentProfile: this.deploymentProfile,
      enterpriseDefaultAuto: Boolean(decision.policy.enterpriseDefaultAuto),
      riskScore: decision.riskScore
    });
    return { ...snapshot, decision };
  }

  solveImage(imagePath, sourceId = "unknown") {
    return this.imageTextRecognitionProvider.solveImage(imagePath, sourceId);
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
  imageTextAdmissibilityFor,
  scoreChallengeRisk,
  isAutoImageTextKind,
  SourceRisk,
  DEFAULT_SOURCE_POLICIES,
  DEFAULT_CHALLENGE_RISK_MODEL
};
