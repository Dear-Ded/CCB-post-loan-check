const fs = require("fs");
const os = require("os");
const path = require("path");

function requireInvestigationMode() {
  const candidates = [
    "../packages/core-skill/scripts/framework/investigation_mode",
    "./framework/investigation_mode",
    "../scripts/framework/investigation_mode"
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error("Could not load investigation_mode module.");
}

const { defaultConsentFile, writeConsent, InvestigationMode } = requireInvestigationMode();

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

function settingsFile() {
  return path.join(os.homedir(), ".codex", "post-loan-portal-check", "settings.json");
}

function writeSettings(mode) {
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const settings = {
    investigationMode: mode,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), "utf8");
  return file;
}

const args = parseArgs(process.argv.slice(2));
const mode = String(args.mode || "").toLowerCase();
if (![InvestigationMode.STANDARD, InvestigationMode.ENHANCED, InvestigationMode.DEEP, InvestigationMode.EXPERT].includes(mode)) {
  console.error("Use --mode standard, --mode enhanced, --mode deep, or --mode expert.");
  process.exit(2);
}

if ((mode === "deep" || mode === "expert") && !args.accept) {
  console.error([
    "Deep/expert mode enables credentialed source slots, broader coverage, optional low-risk image text recognition, session reuse, retries, and deeper graph expansion.",
    "Expert mode applies the most aggressive auditable success-first profile while keeping source admission, evidence validation, and audit logs enabled.",
    "Use it only when you have authorization and understand source terms, access frequency, account, and compliance risks.",
    `Run again with --mode ${mode} --accept to enable this mode.`
  ].join("\n"));
  process.exit(2);
}

const settings = writeSettings(mode);
let consent = null;
if (mode === "deep" || mode === "expert") {
  const consentFile = args.consentFile || process.env.POST_LOAN_DEEP_CONSENT_FILE || defaultConsentFile();
  consent = writeConsent(consentFile, {
    acceptedBy: args.by || os.userInfo().username || "local-user",
    acceptedMode: mode
  });
}

if (mode === "enhanced") {
  console.log("Enhanced query mode is enabled.");
}

console.log(JSON.stringify({
  ok: true,
  mode,
  settings,
  consentFile: consent ? (args.consentFile || process.env.POST_LOAN_DEEP_CONSENT_FILE || defaultConsentFile()) : "",
  acceptedAt: consent ? consent.acceptedAt : ""
}, null, 2));
