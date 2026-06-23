const fs = require("fs");
const os = require("os");
const path = require("path");

const InvestigationMode = Object.freeze({
  STANDARD: "standard",
  ENHANCED: "enhanced",
  DEEP: "deep",
  EXPERT: "expert"
});

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function defaultConsentFile() {
  return path.join(os.homedir(), ".codex", "post-loan-portal-check", "deep-investigation-consent.json");
}

function defaultSettingsFile() {
  return process.env.POST_LOAN_SETTINGS_FILE || path.join(os.homedir(), ".codex", "post-loan-portal-check", "settings.json");
}

function readSettings(file = defaultSettingsFile()) {
  try {
    if (!file || !fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function readConsent(file) {
  try {
    if (!file || !fs.existsSync(file)) return { accepted: false };
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      accepted: Boolean(payload.deepInvestigationAccepted),
      acceptedAt: payload.acceptedAt || "",
      acceptedBy: payload.acceptedBy || "",
      source: file
    };
  } catch {
    return { accepted: false };
  }
}

function writeConsent(file, payload = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record = {
    deepInvestigationAccepted: true,
    acceptedAt: new Date().toISOString(),
    acceptedBy: payload.acceptedBy || os.userInfo().username || "local-user",
    notice: "Deep/expert investigation mode enables broader source coverage, optional low-risk image text recognition, session reuse, retries, and deeper graph expansion. The deployer is responsible for authorization, source terms, and compliance.",
    ...payload
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
  return record;
}

function modeProfile(mode) {
  if (mode === InvestigationMode.EXPERT) {
    return {
      mode,
      graphDepth: 6,
      graphMaxNodes: 80,
      includeCredentialed: true,
      lowRiskOcr: true,
      sessionReuse: true,
      retryLevel: "expert",
      judicialBaseDelayMs: 900,
      judicialRetryDelayMs: 2500,
      judicialJitterMs: 1400,
      judicialCooldownMs: 3 * 60 * 1000,
      judicialWarmup: true,
      judgmentAttempts: 6,
      judgmentSettleBaseMs: 5500,
      enforcementReadyAttempts: 6,
      enforcementConfirmAttempts: 5,
      enforcementRecoveries: 5,
      enforcementResultWaitMs: 26000,
      sourceCoverage: "maximum-auditable",
      challengeRiskTemplate: "expert-aggressive"
    };
  }

  if (mode === InvestigationMode.DEEP) {
    return {
      mode,
      graphDepth: 5,
      graphMaxNodes: 50,
      includeCredentialed: true,
      lowRiskOcr: true,
      sessionReuse: true,
      retryLevel: "aggressive",
      judicialBaseDelayMs: 1200,
      judicialRetryDelayMs: 3500,
      judicialJitterMs: 1800,
      judicialCooldownMs: 5 * 60 * 1000,
      judicialWarmup: true,
      judgmentAttempts: 5,
      judgmentSettleBaseMs: 5000,
      enforcementReadyAttempts: 5,
      enforcementConfirmAttempts: 4,
      enforcementRecoveries: 4,
      enforcementResultWaitMs: 22000,
      sourceCoverage: "expanded",
      challengeRiskTemplate: "deep"
    };
  }

  if (mode === InvestigationMode.ENHANCED) {
    return {
      mode,
      graphDepth: 4,
      graphMaxNodes: 50,
      includeCredentialed: true,
      lowRiskOcr: false,
      sessionReuse: true,
      retryLevel: "strong",
      judicialBaseDelayMs: 2000,
      judicialRetryDelayMs: 5000,
      judicialJitterMs: 2500,
      judicialCooldownMs: 8 * 60 * 1000,
      judicialWarmup: true,
      judgmentAttempts: 4,
      judgmentSettleBaseMs: 4000,
      enforcementReadyAttempts: 4,
      enforcementConfirmAttempts: 3,
      enforcementRecoveries: 3,
      enforcementResultWaitMs: 16000,
      sourceCoverage: "expanded-auditable",
      challengeRiskTemplate: "enhanced"
    };
  }

  return {
    mode: InvestigationMode.STANDARD,
    graphDepth: 3,
    graphMaxNodes: 35,
    includeCredentialed: false,
    lowRiskOcr: true,
    sessionReuse: true,
    retryLevel: "strong",
    judicialBaseDelayMs: 2500,
    judicialRetryDelayMs: 6000,
    judicialJitterMs: 2500,
    judicialCooldownMs: 10 * 60 * 1000,
    judicialWarmup: false,
    judgmentAttempts: 3,
    judgmentSettleBaseMs: 3000,
    enforcementReadyAttempts: 3,
    enforcementConfirmAttempts: 3,
    enforcementRecoveries: 2,
    enforcementResultWaitMs: 12000,
    sourceCoverage: "all-public-auditable",
    challengeRiskTemplate: "standard"
  };
}

function resolveInvestigationMode({ requestedMode, consentFile = process.env.POST_LOAN_DEEP_CONSENT_FILE || defaultConsentFile(), audit } = {}) {
  const settings = readSettings();
  const requested = String(requestedMode || process.env.POST_LOAN_INVESTIGATION_MODE || settings.investigationMode || InvestigationMode.STANDARD)
    .trim()
    .toLowerCase();
  const consent = readConsent(consentFile);
  const envAccepted = envFlag("POST_LOAN_DEEP_ACK", false);
  const enhancedRequested = requested === InvestigationMode.ENHANCED;
  const deepRequested = requested === InvestigationMode.DEEP;
  const expertRequested = requested === InvestigationMode.EXPERT;
  const privilegedRequested = deepRequested || expertRequested;
  const privilegedEnabled = privilegedRequested && (consent.accepted || envAccepted);
  const mode = privilegedEnabled
    ? (expertRequested ? InvestigationMode.EXPERT : InvestigationMode.DEEP)
    : (enhancedRequested ? InvestigationMode.ENHANCED : InvestigationMode.STANDARD);
  const profile = modeProfile(mode);

  audit?.record("investigation_mode_resolved", {
    requested,
    mode,
    enhancedRequested,
    deepRequested,
    expertRequested,
    consentAccepted: consent.accepted,
    envAccepted,
    settingsMode: settings.investigationMode || "",
    consentFile,
    warning: privilegedRequested && !privilegedEnabled ? "privileged_mode_requires_one_time_consent" : ""
  });

  return {
    ...profile,
    requested,
    enhancedRequested,
    deepRequested,
    expertRequested,
    consentAccepted: consent.accepted || envAccepted,
    consentFile,
    settingsMode: settings.investigationMode || "",
    fastModeEnabled: Boolean(settings.fastModeEnabled),
    runtimePolicyFile: settings.runtimePolicyFile || "",
    challengePolicyFile: settings.challengePolicyFile || "",
    consentRequired: privilegedRequested && !privilegedEnabled
  };
}

module.exports = {
  InvestigationMode,
  defaultConsentFile,
  defaultSettingsFile,
  readSettings,
  readConsent,
  writeConsent,
  resolveInvestigationMode
};
