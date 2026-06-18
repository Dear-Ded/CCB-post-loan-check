const fs = require("fs");
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
  "public-low-risk": {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowOcr: true,
    allowSessionReuse: true,
    allowAssisted: true
  },
  authorized: {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowOcr: true,
    allowSessionReuse: true,
    allowAssisted: true
  },
  internal: {
    risk: SourceRisk.LOW,
    mode: ChallengeMode.AUTO,
    allowOcr: true,
    allowSessionReuse: true,
    allowAssisted: true
  },
  "search-engine": {
    risk: SourceRisk.STANDARD,
    mode: ChallengeMode.BLOCKED,
    allowOcr: false,
    allowSessionReuse: false,
    allowAssisted: false,
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

class ChallengeEngine {
  constructor({
    audit,
    policyFile = process.env.POST_LOAN_CHALLENGE_POLICY,
    allowLowRiskOcr = envFlag("POST_LOAN_ENABLE_LOW_RISK_OCR", false),
    pythonExe = process.env.POST_LOAN_PYTHON_EXE || "python",
    ocrHelperPath,
    ocrSolver
  } = {}) {
    this.audit = audit;
    this.policyFile = policyFile;
    this.allowLowRiskOcr = allowLowRiskOcr;
    this.policyOverrides = loadPolicyFile(policyFile, audit);
    this.ocrSolver = ocrSolver || new OcrSolver({
      pythonExe,
      helperPath: ocrHelperPath,
      enabled: allowLowRiskOcr,
      audit
    });
  }

  policyFor(sourceType = "standard", sourceId = "") {
    const base = DEFAULT_SOURCE_POLICIES[sourceType] || {
      risk: SourceRisk.STANDARD,
      mode: defaultModeForSource(sourceType),
      allowOcr: false,
      allowSessionReuse: true,
      allowAssisted: true
    };
    const byType = this.policyOverrides[sourceType] || {};
    const byId = sourceId ? (this.policyOverrides[sourceId] || {}) : {};
    return mergePolicy(mergePolicy(base, byType), byId);
  }

  detect(input) {
    return detectChallengeSignal(input);
  }

  decide({ sourceId = "", sourceType = "standard", challenge, mode } = {}) {
    const policy = this.policyFor(sourceType, sourceId);
    const effectiveMode = mode || policy.mode || defaultModeForSource(sourceType);

    if (!challenge || challenge.kind === ChallengeKind.NONE) {
      return { action: ChallengeAction.PROCEED, policy, effectiveMode, reason: "" };
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
      ocrEnabled: this.allowLowRiskOcr
    });
    return { ...snapshot, decision };
  }

  solveImage(imagePath, sourceId = "unknown") {
    return this.ocrSolver.solveImage(imagePath, sourceId);
  }

  static defaultPolicyPath(skillRoot) {
    return path.join(skillRoot, "references", "challenge-policy.example.json");
  }
}

module.exports = {
  ChallengeEngine,
  ChallengeAction,
  SourceRisk,
  DEFAULT_SOURCE_POLICIES
};
