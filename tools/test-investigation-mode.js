const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveInvestigationMode, InvestigationMode } = require("../packages/core-skill/scripts/framework/investigation_mode");

function withTempSettings(mode, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccb-investigation-mode-"));
  const settingsFile = path.join(dir, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ investigationMode: mode }), "utf8");
  const previous = process.env.POST_LOAN_INVESTIGATION_MODE;
  const previousAck = process.env.POST_LOAN_DEEP_ACK;
  process.env.POST_LOAN_INVESTIGATION_MODE = "";
  process.env.POST_LOAN_DEEP_ACK = "";
  try {
    return fn(settingsFile);
  } finally {
    if (previous == null) delete process.env.POST_LOAN_INVESTIGATION_MODE;
    else process.env.POST_LOAN_INVESTIGATION_MODE = previous;
    if (previousAck == null) delete process.env.POST_LOAN_DEEP_ACK;
    else process.env.POST_LOAN_DEEP_ACK = previousAck;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withTempSettings("standard", () => {
  const mode = resolveInvestigationMode({ requestedMode: "standard" });
  assert.strictEqual(mode.mode, InvestigationMode.STANDARD);
  assert.strictEqual(mode.includeCredentialed, false);
  assert.strictEqual(mode.lowRiskOcr, true);
  assert.strictEqual(mode.graphDepth, 3);
});

withTempSettings("enhanced", () => {
  const mode = resolveInvestigationMode({ requestedMode: "enhanced" });
  assert.strictEqual(mode.mode, InvestigationMode.ENHANCED);
  assert.strictEqual(mode.includeCredentialed, true);
  assert.strictEqual(mode.lowRiskOcr, false);
  assert.strictEqual(mode.graphDepth, 4);
});

withTempSettings("deep", () => {
  const mode = resolveInvestigationMode({ requestedMode: "deep", consentFile: path.join(os.tmpdir(), `ccb-deep-consent-${Date.now()}.json`) });
  assert.strictEqual(mode.mode, InvestigationMode.STANDARD);
  assert.strictEqual(mode.consentRequired, true);
});

withTempSettings("expert", () => {
  const consentFile = path.join(os.tmpdir(), `ccb-expert-consent-${Date.now()}.json`);
  const blocked = resolveInvestigationMode({ requestedMode: "expert", consentFile });
  assert.strictEqual(blocked.mode, InvestigationMode.STANDARD);
  assert.strictEqual(blocked.consentRequired, true);

  fs.writeFileSync(consentFile, JSON.stringify({ deepInvestigationAccepted: true, acceptedAt: new Date().toISOString() }), "utf8");
  const accepted = resolveInvestigationMode({ requestedMode: "expert", consentFile });
  assert.strictEqual(accepted.mode, InvestigationMode.EXPERT);
  assert.strictEqual(accepted.lowRiskOcr, true);
  assert.strictEqual(accepted.retryLevel, "expert");
  assert.strictEqual(accepted.challengeRiskTemplate, "expert-aggressive");
  assert.strictEqual(accepted.graphDepth, 6);
  fs.rmSync(consentFile, { force: true });
});

console.log("investigation-mode ok");
