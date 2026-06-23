const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertContains(file, pattern, message) {
  const text = read(file);
  const ok = pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
  assert(ok, `${file}: ${message}`);
}

function assertJsonField(file, validate) {
  const payload = JSON.parse(read(file));
  validate(payload);
}

assertContains("packages/doubao/run_doubao_app.sh", "--person", "must accept personal enforcement subject input");
assertContains("packages/doubao/run_doubao_app.sh", /PERSON_VALUES=\(\)/, "must store personal enforcement subjects");
assertContains("packages/doubao/run_doubao_app.sh", /args\+=\("--person" "\$person"\)/, "must forward personal enforcement subjects");
assertContains("packages/doubao/run_doubao_app.sh", "--smoke-quick", "must accept internal smoke flag used by acceptance tooling");
assertContains("packages/doubao/run_doubao_app.sh", "--mode", "must accept investigation mode");
assertContains("packages/doubao/run_doubao_app.sh", "write_failure_summary", "must create structured failure summaries on Linux/Doubao failures");
assertContains("packages/doubao/run_doubao_app.sh", "finalReportGenerated", "must explicitly mark failed non-final runs");

for (const file of [
  "packages/core-skill/workbuddy/run_workbuddy.sh",
  "codex-plugin/skills/post-loan-portal-check/workbuddy/run_workbuddy.sh"
]) {
  assertContains(file, "--person", "must accept personal enforcement subject input");
  assertContains(file, /PERSON_VALUES=\(\)/, "must store personal enforcement subjects");
  assertContains(file, /args\+=\("--person" "\$person"\)/, "must forward personal enforcement subjects to the shared runner");
  assertContains(file, "--mode", "must forward investigation mode");
}

for (const file of [
  "packages/doubao/run_doubao_local.ps1",
  "packages/doubao/run_doubao_mobile.ps1",
  "packages/core-skill/workbuddy/run_workbuddy.ps1",
  "codex-plugin/skills/post-loan-portal-check/workbuddy/run_workbuddy.ps1"
]) {
  assertContains(file, "[string[]]$Person", "must expose Person parameter");
  assertContains(file, "Mode", "must expose investigation mode");
  assertContains(file, "Person execution checks are only supported for single-company runs", "must reject person checks in batch mode");
  assertContains(file, "Write-WrapperFailureSummary", "must create structured wrapper failure summaries");
  assertContains(file, "finalReportGenerated", "must explicitly mark failed non-final wrapper runs");
}

assertJsonField("packages/core-skill/references/platform-contract.json", (payload) => {
  assert(payload.inputContract?.single?.mode, "platform contract must document mode input");
  assert(payload.inputContract?.single?.personChecks, "platform contract must document personChecks input");
  assert(payload.platforms?.doubao?.linuxEntrypoint === "packages/doubao/run_doubao_app.sh", "platform contract must keep Doubao Linux entrypoint");
});

assertJsonField("packages/doubao/task-mode.json", (payload) => {
  assert(Array.isArray(payload.hardRules), "Doubao task contract must keep hard rules");
  assert(payload.hardRules.some((rule) => /不得模拟/.test(rule)), "Doubao task contract must forbid simulation");
  assert(payload.inputContract?.single?.mode, "Doubao task contract must document mode input");
  assert(payload.inputContract?.single?.personChecks, "Doubao task contract must document personChecks input");
});

assertJsonField("packages/doubao/mobile-handoff.json", (payload) => {
  const fields = payload.inputContract?.optionalFields || [];
  assert(fields.includes("mode"), "Doubao mobile handoff must document mode");
  assert(fields.includes("personChecks"), "Doubao mobile handoff must document personChecks");
});

assertContains("tools/run-acceptance.ps1", "function Test-SmokeOutput", "acceptance tooling must separate smoke checks from formal output checks");
assertContains("tools/run-acceptance.ps1", "Smoke run must not create formal Word reports", "smoke checks must not accept formal Word output");
assertContains("tools/run-acceptance.ps1", "Invoke-AndValidateRun", "acceptance tooling must validate smoke and formal runs through one gate");

console.log("platform contracts ok");
