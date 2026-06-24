const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const repoUrl = "https://github.com/Dear-Ded/CCB-post-loan-check";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/^\uFEFF/, "");
}

function parseJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertContains(relativePath, expected) {
  assert(read(relativePath).includes(expected), `${relativePath} must contain ${expected}`);
}

function assertNoTerms(relativePath, terms) {
  const text = read(relativePath);
  for (const term of terms) {
    assert(!text.includes(term), `${relativePath} contains blocked public wording: ${term}`);
  }
}

assertContains("LOAD_THIS_PROJECT.md", repoUrl);
assertContains("README.md", repoUrl);
assertContains("PLATFORM_DISCOVERY.md", repoUrl);
assertContains("index.html", repoUrl);
assertContains("LOAD_THIS_PROJECT.md", "npm run mode:fast");
assertContains("README.md", "npm run mode:fast");
assertContains("packages/core-skill/SKILL.md", "npm run mode:fast");
assertContains("LOAD_THIS_PROJECT.md", "npm run diagnose:official");
assertContains("README.md", "npm run diagnose:official");
assertContains("packages/core-skill/SKILL.md", "npm run diagnose:official");

for (const file of [
  "LOAD_THIS_PROJECT.md",
  "README.md",
  "PLATFORM_DISCOVERY.md",
  "packages/doubao/SKILL.md",
  "packages/doubao/mobile-task.md",
  "packages/doubao/office-task.md",
  "packages/doubao/task-mode.json",
  "packages/core-skill/references/platform-contract.json",
  "codex-plugin/skills/post-loan-portal-check/references/platform-contract.json"
]) {
  assertContains(file, "不得模拟");
}

const platformContract = parseJson("packages/core-skill/references/platform-contract.json");
const packageJson = parseJson("package.json");
assert(packageJson.scripts["mode:fast"] === "node tools/enable-fast-mode.js --accept", "package must expose one-click fast mode");
assert(packageJson.scripts["diagnose:official"] === "node tools/diagnose-official-sources.js --json", "package must expose official source diagnostics");
assert(platformContract.discoveryContract.repositoryUrl === repoUrl, "platform contract must point to the public repository");
assert(platformContract.discoveryContract.primaryLoadFile === "LOAD_THIS_PROJECT.md", "platform contract must name the load file");
assert(platformContract.platforms.workbuddy.mobileSupport === "unsupported", "WorkBuddy mobile must remain unsupported");
assert(platformContract.platforms.workbuddy.singleEntrypoint === "workbuddy/run_workbuddy.ps1", "WorkBuddy must load the Windows desktop entrypoint");
assert(platformContract.platforms.doubao.linuxEntrypoint === "packages/doubao/run_doubao_app.sh", "Doubao App must load the Linux entrypoint");

for (const file of [
  "packages/core-skill/scripts/framework/runtime_policy.js",
  "codex-plugin/skills/post-loan-portal-check/scripts/framework/runtime_policy.js"
]) {
  assertContains(file, 'envFlag("POST_LOAN_BROWSER_COMPAT_TUNING", false)');
  assertContains(file, 'envFlag("POST_LOAN_ENABLE_LOW_RISK_IMAGE_TEXT", false)');
}

for (const file of [
  "packages/core-skill/references/runtime-policy.example.json",
  "codex-plugin/skills/post-loan-portal-check/references/runtime-policy.example.json"
]) {
  const runtimePolicy = parseJson(file);
  assert(runtimePolicy.browserCompatibilityTuning.enabled === false, `${file} must keep compatibility tuning disabled by default`);
  assert(runtimePolicy.lowRiskImageTextRecognition.enabled === false, `${file} must keep low-risk image text recognition disabled by default`);
}

const blockedPublicTerms = [
  "绕" + "过",
  "反" + "爬",
  "自动" + "验证码",
  "Automation" + "Controlled",
  "By" + "pass"
];

for (const file of [
  "LOAD_THIS_PROJECT.md",
  "README.md",
  "PLATFORM_DISCOVERY.md",
  "ADAPTERS.md",
  "packages/core-skill/SKILL.md",
  "packages/doubao/SKILL.md",
  "packages/doubao/README.md",
  "packages/doubao/mobile-task.md",
  "packages/doubao/office-task.md",
  "packages/core-skill/references/platform-contract.json",
  "codex-plugin/skills/post-loan-portal-check/README.md",
  "codex-plugin/skills/post-loan-portal-check/SKILL.md",
  "codex-plugin/skills/post-loan-portal-check/references/platform-contract.json"
]) {
  assertNoTerms(file, blockedPublicTerms);
}

console.log("loadability ok");
