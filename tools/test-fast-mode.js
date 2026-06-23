const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  resolveInvestigationMode
} = require("../packages/core-skill/scripts/framework/investigation_mode");
const {
  loadRuntimePolicy,
  browserCompatibilityArgs
} = require("../packages/core-skill/scripts/framework/runtime_policy");
const {
  ChallengeEngine,
  ChallengeAction
} = require("../packages/core-skill/scripts/framework/challenge_engine");
const { ChallengeKind } = require("../packages/core-skill/scripts/framework/challenge_policy");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ccb-fast-mode-"));
try {
  const settingsFile = path.join(work, "settings.json");
  const consentFile = path.join(work, "consent.json");
  const configDir = path.join(work, "config");

  const blocked = spawnSync(process.execPath, [
    path.join(__dirname, "enable-fast-mode.js"),
    "--settingsFile", settingsFile,
    "--consentFile", consentFile,
    "--configDir", configDir
  ], { encoding: "utf8" });
  assert.strictEqual(blocked.status, 2);
  assert(!fs.existsSync(settingsFile));

  const enabled = spawnSync(process.execPath, [
    path.join(__dirname, "enable-fast-mode.js"),
    "--accept",
    "--settingsFile", settingsFile,
    "--consentFile", consentFile,
    "--configDir", configDir
  ], { encoding: "utf8" });
  assert.strictEqual(enabled.status, 0, enabled.stderr || enabled.stdout);

  const payload = JSON.parse(enabled.stdout);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.fastModeEnabled, true);
  assert(fs.existsSync(payload.runtimePolicyFile));
  assert(fs.existsSync(payload.challengePolicyFile));

  const previousMode = process.env.POST_LOAN_INVESTIGATION_MODE;
  const previousSettings = process.env.POST_LOAN_SETTINGS_FILE;
  process.env.POST_LOAN_INVESTIGATION_MODE = "";
  process.env.POST_LOAN_SETTINGS_FILE = settingsFile;
  try {
    const mode = resolveInvestigationMode({ consentFile });
    assert.strictEqual(mode.mode, "expert");
    assert.strictEqual(mode.fastModeEnabled, true);
    assert.strictEqual(mode.runtimePolicyFile, payload.runtimePolicyFile);
    assert.strictEqual(mode.challengePolicyFile, payload.challengePolicyFile);

    const runtimePolicy = loadRuntimePolicy({ investigationMode: mode });
    assert.strictEqual(runtimePolicy.browserCompatibilityTuning.enabled, true);
    assert.strictEqual(runtimePolicy.lowRiskImageTextRecognition.enabled, true);
    assert(browserCompatibilityArgs(runtimePolicy).includes("--lang=zh-CN"));

    const provider = { canSolve: () => true, solveImage: () => ({ ok: true, text: "1234" }) };
    const engine = new ChallengeEngine({
      policyFile: mode.challengePolicyFile,
      allowLowRiskImageTextRecognition: true,
      imageTextRecognitionProvider: provider,
      investigationMode: mode
    });
    const lowRiskDecision = engine.decide({
      sourceType: "public-low-risk",
      sourceId: "low-risk-text",
      challenge: { kind: ChallengeKind.CAPTCHA_TEXT, reason: "text" }
    });
    assert.strictEqual(lowRiskDecision.action, ChallengeAction.AUTO_IMAGE_TEXT);

    const judicialDecision = engine.decide({
      sourceType: "judicial",
      sourceId: "wenshu",
      challenge: { kind: ChallengeKind.CAPTCHA_TEXT, reason: "text" }
    });
    assert.strictEqual(judicialDecision.action, ChallengeAction.ASSISTED);
  } finally {
    if (previousMode == null) delete process.env.POST_LOAN_INVESTIGATION_MODE;
    else process.env.POST_LOAN_INVESTIGATION_MODE = previousMode;
    if (previousSettings == null) delete process.env.POST_LOAN_SETTINGS_FILE;
    else process.env.POST_LOAN_SETTINGS_FILE = previousSettings;
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("fast-mode ok");
