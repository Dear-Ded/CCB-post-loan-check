const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  loadRuntimePolicy,
  browserCompatibilityArgs
} = require("../packages/core-skill/scripts/framework/runtime_policy");

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

withEnv({
  POST_LOAN_RUNTIME_POLICY: null,
  POST_LOAN_BROWSER_COMPAT_TUNING: null,
  POST_LOAN_ENABLE_LOW_RISK_IMAGE_TEXT: null
}, () => {
  const missingFile = path.join(os.tmpdir(), `missing-runtime-policy-${Date.now()}.json`);
  const policy = loadRuntimePolicy({ file: missingFile });
  assert.strictEqual(policy.browserCompatibilityTuning.enabled, false);
  assert.strictEqual(policy.lowRiskImageTextRecognition.enabled, false);
  assert.deepStrictEqual(browserCompatibilityArgs(policy), []);
});

withEnv({
  POST_LOAN_BROWSER_COMPAT_TUNING: "1",
  POST_LOAN_ENABLE_LOW_RISK_IMAGE_TEXT: "true"
}, () => {
  const policy = loadRuntimePolicy({ file: path.join(os.tmpdir(), `missing-runtime-policy-${Date.now()}-env.json`) });
  assert.strictEqual(policy.browserCompatibilityTuning.enabled, true);
  assert.strictEqual(policy.lowRiskImageTextRecognition.enabled, true);
  assert(browserCompatibilityArgs(policy).includes("--lang=zh-CN"));
});

withEnv({
  POST_LOAN_BROWSER_COMPAT_TUNING: null,
  POST_LOAN_ENABLE_LOW_RISK_IMAGE_TEXT: null
}, () => {
  const policyFile = path.join(os.tmpdir(), `runtime-policy-${Date.now()}.json`);
  fs.writeFileSync(policyFile, JSON.stringify({
    browserCompatibilityTuning: {
      enabled: true,
      chromiumArgs: ["--lang=zh-CN", "--window-size=1365,900", "--custom-compatible-flag"]
    },
    lowRiskImageTextRecognition: {
      enabled: true,
      provider: "optional-local-component"
    },
    sessionStorage: {
      localOnly: true
    }
  }), "utf8");

  const policy = loadRuntimePolicy({ file: policyFile });
  const args = browserCompatibilityArgs(policy);
  assert.strictEqual(policy.browserCompatibilityTuning.enabled, true);
  assert.strictEqual(policy.lowRiskImageTextRecognition.enabled, true);
  assert.strictEqual(args.filter((item) => item === "--lang=zh-CN").length, 1);
  assert(args.includes("--custom-compatible-flag"));
  fs.rmSync(policyFile, { force: true });
});

withEnv({
  POST_LOAN_BROWSER_COMPAT_TUNING: "0",
  POST_LOAN_ENABLE_LOW_RISK_IMAGE_TEXT: "0"
}, () => {
  const policyFile = path.join(os.tmpdir(), `runtime-policy-env-override-${Date.now()}.json`);
  fs.writeFileSync(policyFile, JSON.stringify({
    browserCompatibilityTuning: { enabled: true },
    lowRiskImageTextRecognition: { enabled: true }
  }), "utf8");

  const policy = loadRuntimePolicy({ file: policyFile });
  assert.strictEqual(policy.browserCompatibilityTuning.enabled, true);
  assert.strictEqual(policy.lowRiskImageTextRecognition.enabled, false);
  fs.rmSync(policyFile, { force: true });
});

console.log("runtime-policy ok");
