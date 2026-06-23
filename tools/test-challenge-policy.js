const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { ChallengeEngine, ChallengeAction, scoreChallengeRisk } = require("../packages/core-skill/scripts/framework/challenge_engine");
const { ChallengeKind, ChallengeMode } = require("../packages/core-skill/scripts/framework/challenge_policy");

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] == null) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function makeEngine(extra = {}) {
  return new ChallengeEngine({
    allowLowRiskImageTextRecognition: false,
    riskConsentFile: path.join(os.tmpdir(), `ccb-missing-consent-${Date.now()}-${Math.random()}.json`),
    ...extra
  });
}

withEnv({ POST_LOAN_DEPLOYMENT_PROFILE: "", POST_LOAN_HIGH_RISK_AUTO_ACK: "" }, () => {
  const engine = makeEngine();
  assert.strictEqual(engine.policyFor("public").mode, ChallengeMode.AUTO);
  assert.strictEqual(engine.policyFor("authorized").mode, ChallengeMode.AUTO);
  assert.strictEqual(engine.policyFor("internal").mode, ChallengeMode.AUTO);
  assert.strictEqual(engine.policyFor("judicial").mode, ChallengeMode.ASSISTED);
  assert.strictEqual(engine.policyFor("government-strong").mode, ChallengeMode.ASSISTED);
  assert.strictEqual(engine.policyFor("prohibited").mode, ChallengeMode.BLOCKED);

  const searchDecision = engine.decide({
    sourceType: "search-engine",
    sourceId: "bing",
    challenge: { kind: ChallengeKind.CAPTCHA, reason: "search_challenge" }
  });
  assert.strictEqual(searchDecision.action, ChallengeAction.BLOCK);
});

withEnv({ POST_LOAN_DEPLOYMENT_PROFILE: "enterprise-private" }, () => {
  const consentFile = path.join(os.tmpdir(), `ccb-risk-consent-${Date.now()}.json`);
  fs.writeFileSync(consentFile, JSON.stringify({ highRiskAutoAccepted: true, acceptedAt: new Date().toISOString() }), "utf8");
  const engine = makeEngine({ riskConsentFile: consentFile, allowLowRiskImageTextRecognition: true });
  const judicial = engine.policyFor("judicial", "zhixing");
  assert.strictEqual(judicial.mode, ChallengeMode.AUTO);
  assert.strictEqual(judicial.riskAcknowledged, true);
  assert.strictEqual(judicial.enterpriseDefaultAuto, true);
  fs.rmSync(consentFile, { force: true });
});

withEnv({ POST_LOAN_DEPLOYMENT_PROFILE: "" }, () => {
  const policyFile = path.join(os.tmpdir(), `ccb-policy-${Date.now()}.json`);
  fs.writeFileSync(policyFile, JSON.stringify({
    judicial: { mode: "auto", allowImageTextRecognition: true }
  }), "utf8");
  const engine = makeEngine({ policyFile });
  const decision = engine.decide({
    sourceType: "judicial",
    sourceId: "wenshu",
    challenge: { kind: ChallengeKind.CAPTCHA, reason: "captcha" }
  });
  assert.strictEqual(decision.action, ChallengeAction.ASSISTED);
  assert.strictEqual(decision.reason, "risk_acknowledgement_required");
  fs.rmSync(policyFile, { force: true });
});

withEnv({ POST_LOAN_DEPLOYMENT_PROFILE: "", POST_LOAN_HIGH_RISK_AUTO_ACK: "1" }, () => {
  const policyFile = path.join(os.tmpdir(), `ccb-policy-guardrail-${Date.now()}.json`);
  fs.writeFileSync(policyFile, JSON.stringify({
    judicial: { mode: "auto", allowImageTextRecognition: true, riskAcknowledged: true },
    "public-low-risk": { mode: "auto", allowImageTextRecognition: true }
  }), "utf8");
  const provider = { canSolve: () => true, solveImage: () => ({ ok: true, text: "1234" }) };
  const engine = makeEngine({
    policyFile,
    allowLowRiskImageTextRecognition: true,
    imageTextRecognitionProvider: provider
  });
  const judicialDecision = engine.decide({
    sourceType: "judicial",
    sourceId: "zxgk",
    challenge: { kind: ChallengeKind.CAPTCHA_TEXT, reason: "captcha" }
  });
  assert.strictEqual(judicialDecision.action, ChallengeAction.ASSISTED);
  assert.strictEqual(judicialDecision.reason, "source_guardrail_requires_managed_official_confirmation");

  const lowRiskDecision = engine.decide({
    sourceType: "public-low-risk",
    sourceId: "internal-low-risk-demo",
    challenge: { kind: ChallengeKind.CAPTCHA_TEXT, reason: "captcha" }
  });
  assert.strictEqual(lowRiskDecision.action, ChallengeAction.AUTO_IMAGE_TEXT);

  const arithmeticDecision = engine.decide({
    sourceType: "public-low-risk",
    sourceId: "internal-low-risk-demo",
    challenge: { kind: ChallengeKind.CAPTCHA_ARITHMETIC, reason: "captcha" }
  });
  assert.strictEqual(arithmeticDecision.action, ChallengeAction.AUTO_IMAGE_TEXT);

  const sliderDecision = engine.decide({
    sourceType: "public-low-risk",
    sourceId: "internal-low-risk-demo",
    challenge: { kind: ChallengeKind.CAPTCHA_SLIDER, reason: "slider" }
  });
  assert.strictEqual(sliderDecision.action, ChallengeAction.ASSISTED);

  const clickDecision = engine.decide({
    sourceType: "public-low-risk",
    sourceId: "internal-low-risk-demo",
    challenge: { kind: ChallengeKind.CAPTCHA_CLICK, reason: "click" }
  });
  assert.strictEqual(clickDecision.action, ChallengeAction.ASSISTED);

  const customScore = scoreChallengeRisk({
    sourceType: "public-low-risk",
    sourceId: "internal-low-risk-demo",
    challenge: { kind: ChallengeKind.CAPTCHA_TEXT },
    policy: { allowImageTextRecognition: true, riskAcknowledged: true },
    riskModel: {
      weights: {
        challengeKinds: { [ChallengeKind.CAPTCHA_TEXT]: 4 },
        sourceTypes: { "public-low-risk": 0 },
        context: { allowImageTextRecognition: 0, riskAcknowledged: 0 }
      },
      thresholds: { autoImageTextMaxScore: 3 },
      autoImageTextKinds: [ChallengeKind.CAPTCHA_TEXT]
    }
  });
  assert.strictEqual(customScore.score, 4);
  assert.strictEqual(customScore.thresholds.autoImageTextMaxScore, 3);
  fs.rmSync(policyFile, { force: true });
});

withEnv({ POST_LOAN_DEPLOYMENT_PROFILE: "", POST_LOAN_HIGH_RISK_AUTO_ACK: "" }, () => {
  const provider = { canSolve: () => true, solveImage: () => ({ ok: true, text: "1234" }) };
  const engine = makeEngine({
    allowLowRiskImageTextRecognition: true,
    imageTextRecognitionProvider: provider,
    investigationMode: { mode: "expert", challengeRiskTemplate: "expert-aggressive" }
  });
  const publicDecision = engine.decide({
    sourceType: "public",
    sourceId: "public-text-code",
    challenge: { kind: ChallengeKind.CAPTCHA_TEXT, reason: "captcha" }
  });
  assert.strictEqual(publicDecision.action, ChallengeAction.AUTO_IMAGE_TEXT);
  assert.strictEqual(publicDecision.riskScore.thresholds.autoImageTextMaxScore, 4);

  const sliderDecision = engine.decide({
    sourceType: "public",
    sourceId: "public-slider",
    challenge: { kind: ChallengeKind.CAPTCHA_SLIDER, reason: "slider" }
  });
  assert.strictEqual(sliderDecision.action, ChallengeAction.ASSISTED);
});

console.log("challenge-policy ok");

