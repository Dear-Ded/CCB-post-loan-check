const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { OcrSolver } = require("../packages/core-skill/scripts/framework/ocr_solver");

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

function writeHelper(dir, name, source) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, "utf8");
  return file;
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ccb-ocr-solver-"));
try {
  const image = path.join(work, "image.txt");
  fs.writeFileSync(image, "not a real image; helper controls output", "utf8");

  const goodHelper = writeHelper(work, "good-provider.js", "console.log(process.env.POST_LOAN_IMAGE_TEXT_ROUND === '2' ? ' A 1 2 3 ' : 'A123');\n");
  const badHelper = writeHelper(work, "bad-provider.js", "console.error('provider unavailable'); process.exit(3);\n");
  const unusableHelper = writeHelper(work, "unusable-provider.js", "console.log('!');\n");

  const auditEvents = [];
  const audit = { record: (type, payload) => auditEvents.push({ type, payload }) };

  const disabled = new OcrSolver({
    pythonExe: process.execPath,
    helperPath: goodHelper,
    enabled: false
  });
  assert.strictEqual(disabled.canSolve(), false);
  assert.deepStrictEqual(disabled.solveImage(image), {
    ok: false,
    text: "",
    reason: "image_text_recognition_disabled"
  });

  withEnv({ POST_LOAN_IMAGE_TEXT_ROUNDS: "2" }, () => {
    const solver = new OcrSolver({
      pythonExe: process.execPath,
      providers: `bad=${badHelper};good=${goodHelper}`,
      enabled: true,
      audit
    });
    const result = solver.solveImage(image, "low-risk-test-source");
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.text, "A123");
    assert.strictEqual(result.provider, "good");
    assert.strictEqual(result.candidates.length, 2);
    assert(auditEvents.some((event) => event.type === "image_text_recognition_provider_failed"));
    assert(auditEvents.some((event) => event.type === "image_text_recognition_completed"));
  });

  const failed = new OcrSolver({
    pythonExe: process.execPath,
    providers: `unusable=${unusableHelper}`,
    enabled: true
  }).solveImage(image, "low-risk-test-source");
  assert.strictEqual(failed.ok, false);
  assert(failed.reason.includes("unusable"));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log("ocr-solver ok");
