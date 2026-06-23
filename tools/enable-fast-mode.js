const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  defaultConsentFile,
  defaultSettingsFile,
  writeConsent,
  InvestigationMode
} = require("../packages/core-skill/scripts/framework/investigation_mode");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function defaultConfigDir() {
  return path.join(os.homedir(), ".codex", "post-loan-portal-check");
}

function writeJson(file, payload) {
  ensureDir(file);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

function buildRuntimePolicy() {
  return {
    schemaVersion: "runtime-policy/v1",
    browserCompatibilityTuning: {
      enabled: true,
      description: "One-click fast mode: browser automation testing and compatibility tuning for controlled local use.",
      chromiumArgs: [
        "--lang=zh-CN",
        "--window-size=1365,900",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows"
      ]
    },
    lowRiskImageTextRecognition: {
      enabled: true,
      description: "One-click fast mode enables authorized low-risk image text recognition. Strong official-source guardrails remain active.",
      provider: "optional-local-component"
    },
    sessionStorage: {
      localOnly: true,
      description: "User session data stays on the local machine and is not uploaded to any server."
    }
  };
}

function buildChallengePolicy() {
  return {
    public: {
      mode: "auto",
      allowImageTextRecognition: true,
      allowSessionReuse: true,
      allowRetry: true,
      riskAcknowledged: true
    },
    "public-low-risk": {
      mode: "auto",
      allowImageTextRecognition: true,
      allowSessionReuse: true,
      allowRetry: true,
      riskAcknowledged: true
    },
    authorized: {
      mode: "auto",
      allowImageTextRecognition: true,
      allowSessionReuse: true,
      allowRetry: true,
      riskAcknowledged: true
    },
    internal: {
      mode: "auto",
      allowImageTextRecognition: true,
      allowSessionReuse: true,
      allowRetry: true,
      riskAcknowledged: true
    },
    "search-engine": {
      mode: "auto",
      allowImageTextRecognition: false,
      allowSessionReuse: false,
      allowRetry: true,
      cooldownOnChallenge: true,
      riskAcknowledged: true
    },
    judicial: {
      mode: "assisted",
      allowImageTextRecognition: false,
      allowSessionReuse: true,
      allowAssisted: true,
      allowRetry: true
    },
    "government-strong": {
      mode: "assisted",
      allowImageTextRecognition: false,
      allowSessionReuse: true,
      allowAssisted: true,
      allowRetry: true
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.accept) {
    console.error([
      "One-click fast mode enables expert retries, browser compatibility tuning, session reuse, broad source coverage, and authorized low-risk image text recognition.",
      "It still preserves real-evidence validation, audit logs, and managed confirmation for strong official-source challenges.",
      "Run again with --accept to enable it."
    ].join("\n"));
    process.exit(2);
  }

  const configDir = args.configDir || defaultConfigDir();
  const runtimePolicyFile = path.join(configDir, "fast-mode-runtime-policy.json");
  const challengePolicyFile = path.join(configDir, "fast-mode-challenge-policy.json");
  const settingsFile = args.settingsFile || defaultSettingsFile();
  const consentFile = args.consentFile || defaultConsentFile();

  writeJson(runtimePolicyFile, buildRuntimePolicy());
  writeJson(challengePolicyFile, buildChallengePolicy());
  const consent = writeConsent(consentFile, {
    acceptedBy: args.by || os.userInfo().username || "local-user",
    acceptedMode: InvestigationMode.EXPERT,
    fastModeAccepted: true
  });
  writeJson(settingsFile, {
    investigationMode: InvestigationMode.EXPERT,
    fastModeEnabled: true,
    runtimePolicyFile,
    challengePolicyFile,
    updatedAt: new Date().toISOString()
  });

  console.log(JSON.stringify({
    ok: true,
    mode: InvestigationMode.EXPERT,
    fastModeEnabled: true,
    settingsFile,
    runtimePolicyFile,
    challengePolicyFile,
    consentFile,
    acceptedAt: consent.acceptedAt
  }, null, 2));
}

main();
