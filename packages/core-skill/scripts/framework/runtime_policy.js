const fs = require("fs");
const path = require("path");

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function loadRuntimePolicy({ skillRoot = path.resolve(__dirname, "..", ".."), file = process.env.POST_LOAN_RUNTIME_POLICY, audit, investigationMode } = {}) {
  const configuredFile = file || investigationMode?.runtimePolicyFile || "";
  const defaults = {
    browserCompatibilityTuning: {
      enabled: envFlag("POST_LOAN_BROWSER_COMPAT_TUNING", false),
      chromiumArgs: []
    },
    lowRiskImageTextRecognition: {
      enabled: envFlag("POST_LOAN_ENABLE_LOW_RISK_IMAGE_TEXT", false),
      provider: "none"
    },
    sessionStorage: {
      localOnly: true
    }
  };

  const policyFile = configuredFile || path.join(skillRoot, "references", "runtime-policy.example.json");
  try {
    if (!fs.existsSync(policyFile)) return defaults;
    const payload = JSON.parse(fs.readFileSync(policyFile, "utf8").replace(/^\uFEFF/, ""));
    return {
      browserCompatibilityTuning: {
        ...defaults.browserCompatibilityTuning,
        ...(payload.browserCompatibilityTuning || {})
      },
      lowRiskImageTextRecognition: {
        ...defaults.lowRiskImageTextRecognition,
        ...(payload.lowRiskImageTextRecognition || {}),
        enabled: envFlag(
          "POST_LOAN_ENABLE_LOW_RISK_IMAGE_TEXT",
          payload.lowRiskImageTextRecognition?.enabled ?? defaults.lowRiskImageTextRecognition.enabled
        )
      },
      sessionStorage: {
        ...defaults.sessionStorage,
        ...(payload.sessionStorage || {})
      }
    };
  } catch (error) {
    audit?.record("runtime_policy_load_failed", { file: policyFile, error: String(error.message || error) });
    return defaults;
  }
}

function browserCompatibilityArgs(policy) {
  const section = policy?.browserCompatibilityTuning || {};
  if (!section.enabled) return [];
  const defaults = [
    "--lang=zh-CN",
    "--window-size=1365,900",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows"
  ];
  const configured = Array.isArray(section.chromiumArgs) ? section.chromiumArgs.filter(Boolean) : [];
  return [...new Set([...defaults, ...configured])];
}

module.exports = {
  loadRuntimePolicy,
  browserCompatibilityArgs
};
