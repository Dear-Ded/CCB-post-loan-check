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
  assert(Array.isArray(payload.hardRules), "platform contract must keep hard rules");
  assert(payload.hardRules.some((rule) => /不得模拟任何查询结果/.test(rule)), "platform contract must forbid simulated content");
  assert(payload.hardRules.some((rule) => /不得胡编乱造任何内容/.test(rule)), "platform contract must forbid invented content");
  assert(payload.inputContract?.single?.mode, "platform contract must document mode input");
  assert(payload.inputContract?.single?.personChecks, "platform contract must document personChecks input");
  assert(payload.platforms?.workbuddy?.mobileSupport === "unsupported", "platform contract must mark WorkBuddy mobile unsupported");
  assert(payload.platforms?.workbuddy?.singleEntrypoint === "workbuddy/run_workbuddy.ps1", "platform contract must keep WorkBuddy Windows desktop entrypoint");
  assert(payload.platforms?.doubao?.linuxEntrypoint === "packages/doubao/run_doubao_app.sh", "platform contract must keep Doubao Linux entrypoint");
  assert((payload.platforms?.doubao?.supportedSurfaces || []).includes("mobileLinuxOfficeTask"), "platform contract must mark Doubao App mobile as Linux office-task runtime");
});

for (const file of [
  "packages/core-skill/workbuddy/package-manifest.json",
  "codex-plugin/skills/post-loan-portal-check/workbuddy/package-manifest.json"
]) {
  assertJsonField(file, (payload) => {
    assert(payload.desktopEntrypoint === "workbuddy/run_workbuddy.ps1", "WorkBuddy manifest must expose desktop Windows entrypoint");
    assert(!payload.mobileEntrypoint, "WorkBuddy manifest must not expose mobile entrypoint");
    assert(!payload.entrypoints?.mobileLinux, "WorkBuddy manifest must not expose mobile Linux entrypoint");
    assert(!(payload.requiredFiles || []).includes("workbuddy/run_workbuddy.sh"), "WorkBuddy package must not require mobile bash runner");
  });
}

for (const file of [
  "packages/core-skill/workbuddy/expert.json",
  "codex-plugin/skills/post-loan-portal-check/workbuddy/expert.json"
]) {
  assertJsonField(file, (payload) => {
    assert(payload.platforms?.desktop?.entrypoint === "workbuddy/run_workbuddy.ps1", "WorkBuddy expert must expose desktop runner");
    assert(!payload.platforms?.mobile, "WorkBuddy expert must not expose mobile runner");
    assert((payload.startupNotice || []).some((line) => /只有电脑版 Windows/.test(line)), "WorkBuddy expert must tell users desktop-only status");
  });
}

for (const file of [
  "packages/core-skill/references/workbuddy-adapter.md",
  "codex-plugin/skills/post-loan-portal-check/references/workbuddy-adapter.md"
]) {
  assertContains(file, "one supported platform entrypoint", "WorkBuddy adapter must be desktop-only");
  assertContains(file, "WorkBuddy mobile: unsupported", "WorkBuddy adapter must mark mobile unsupported");
}

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
