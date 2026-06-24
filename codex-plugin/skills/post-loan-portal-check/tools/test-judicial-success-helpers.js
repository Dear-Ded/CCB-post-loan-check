const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { isCaptchaFailure, isResultState } = require("../packages/core-skill/scripts/framework/enforcement_source");
const {
  ENFORCEMENT_ROUTES,
  JUDGMENT_ROUTES,
  OFFICIAL_EXECUTION_NAVIGATION_ROUTES
} = require("../packages/core-skill/scripts/framework/judicial_routes");
const { buildRequiredEvidence } = require("../packages/core-skill/scripts/framework/evidence_contract");

const captureSource = fs.readFileSync(path.join(__dirname, "..", "packages", "core-skill", "scripts", "capture_template_slots.js"), "utf8");

assert.ok(JUDGMENT_ROUTES.length >= 2, "judgment source should have multiple entry routes");
assert.ok(ENFORCEMENT_ROUTES.length >= 2, "enforcement source should have multiple entry routes");
assert.ok(JUDGMENT_ROUTES.some((route) => route.url("主体A").includes("wenshu.court.gov.cn")));
assert.ok(ENFORCEMENT_ROUTES.some((route) => route.url().includes("zxgk.court.gov.cn")));
assert.strictEqual(ENFORCEMENT_ROUTES[0].id, "zhzxgk_query", "enterprise enforcement route should remain first");
assert.strictEqual(ENFORCEMENT_ROUTES[1].id, "shixin_query", "working official dishonest-enforcement form should be tried before home fallbacks");
assert.ok(OFFICIAL_EXECUTION_NAVIGATION_ROUTES.some((route) => route.url().includes("cjdh.court.gov.cn")));
assert.ok(OFFICIAL_EXECUTION_NAVIGATION_ROUTES.every((route) => route.resultCapable === false), "official navigation pages must not be accepted as subject result evidence");

assert.strictEqual(isResultState("查询结果 未查询到相关信息"), true);
assert.strictEqual(isResultState("案号 执行法院 立案时间 执行标的"), true);
assert.strictEqual(isResultState("请先输入查询条件"), false);

assert.strictEqual(isCaptchaFailure("验证码错误，请重新输入"), true);
assert.strictEqual(isCaptchaFailure("校验码不正确"), true);
assert.strictEqual(isCaptchaFailure("查询结果 未查询到相关信息"), false);

const requiredEvidence = buildRequiredEvidence({
  skipSearch: true,
  screenshots: [
    { slot: 1, validation: { ok: true }, name: "河南省应急管理厅" },
    { slot: 2, validation: { ok: true }, name: "河南省生态环境厅" },
    { slot: 3, validation: { ok: true }, name: "河南省市场监督管理局" },
    { slot: 4, validation: { ok: true }, name: "中国裁判文书网", url: "https://wenshu.court.gov.cn/" },
    { slot: 5, validation: { ok: true }, name: "中国执行信息公开网", url: "https://zxgk.court.gov.cn/zhzxgk/" }
  ]
});
assert.strictEqual(requiredEvidence.ok, true);

const judgmentOfficial = captureSource.indexOf("captureJudgmentPortal(judgmentPage, shots, add, company, audit, judicialScheduler");
const enforcementOfficial = captureSource.indexOf("completeEnforcementQuery(context, enterpriseEnforcementPage, company, orgCode, audit");
assert.ok(judgmentOfficial > 0, "judgment portal must be attempted");
assert.ok(enforcementOfficial > 0, "enforcement portal must be attempted");
assert.ok(!captureSource.includes("capturePublicJudicialSearch"), "formal judicial flow must not capture public search signals");
assert.ok(!captureSource.includes("captureAuthorizedEvidence"), "formal judicial flow must not substitute authorized summary pages for official screenshots");
assert.ok(!captureSource.includes("judgment_authorized_provider_used"), "formal judgment evidence must remain official portal evidence only");
assert.ok(!captureSource.includes("enforcement_authorized_provider_used"), "formal enforcement evidence must remain official portal evidence only");
assert.ok(captureSource.includes("function defaultEnforcementPrepAttempts"), "enforcement preparation should use route-aware attempt coverage");
assert.ok(captureSource.includes("Math.max(3, modeAttempts)"), "enforcement preparation should cover zhzxgk, shixin, and home routes by default");
assert.ok(captureSource.includes("function isShixinRoute"), "shixin route variants should share official form navigation handling");
assert.ok(captureSource.includes("prepareEnforcementChallenge(page, subjectName, codeOrId, audit, options)"), "enforcement capture should preserve route attempts from investigation mode");
assert.ok(captureSource.includes("resetEnforcementCaptcha(page, subjectName, codeOrId, audit, options)"), "enforcement challenge reset should preserve route attempts from investigation mode");
assert.ok(captureSource.includes('preferPersistentProfile ? "persistent" : "ephemeral"'), "browser context should default to ephemeral unless a valid session is being reused");
assert.ok(captureSource.includes("preferPersistentProfile: Boolean(previousSession)"), "persistent browser profile should require a previous session");
assert.ok(captureSource.includes("no_valid_persistent_session"), "runs without a previous session should use an isolated run profile");
assert.ok(captureSource.includes("POST_LOAN_JUDGMENT_INPUT_WAIT_MS"), "judgment search input wait must be configurable");
assert.ok(captureSource.includes("POST_LOAN_JUDGMENT_HOME_INPUT_WAIT_MS"), "judgment home input wait must be configurable");
assert.ok(captureSource.includes("includeEnforcement: false"), "formal warmup should not pre-scan enforcement routes before the required query");
assert.ok(captureSource.includes("enforcement_managed_confirmation_required"), "managed confirmation should be recorded explicitly");
assert.ok(captureSource.includes("official_managed_confirmation_required"), "managed confirmation should have a stable machine-readable reason");
assert.ok(!captureSource.includes("案由|案件名称|文书/.test(initialText)"), "judgment home page navigation must not be accepted as a result page");
assert.ok(!captureSource.includes("案由|案件名称|文书/.test(compact)"), "judgment capture validation must not accept the home page only because it contains navigation labels");
assert.ok(!captureSource.includes("裁判日期|案由|案件名称"), "judgment placeholder text must not be accepted as a result page");

assert.ok(!captureSource.includes("solveEnforcementImageText"), "official enforcement source must not auto-submit image-text challenges");
assert.ok(captureSource.includes("enforcement_official_image_text_policy"), "official enforcement image-text policy should be audited");
assert.ok(captureSource.includes("official_judicial_source_requires_managed_official_confirmation"), "official enforcement source must explain why image-text automation is disabled");

console.log("judicial-success-helpers ok");
