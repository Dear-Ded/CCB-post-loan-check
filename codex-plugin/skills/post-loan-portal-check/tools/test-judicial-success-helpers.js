const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { isCaptchaFailure, isResultState } = require("../packages/core-skill/scripts/framework/enforcement_source");
const {
  ENFORCEMENT_ROUTES,
  JUDGMENT_ROUTES
} = require("../packages/core-skill/scripts/framework/judicial_routes");
const { buildRequiredEvidence } = require("../packages/core-skill/scripts/framework/evidence_contract");

const captureSource = fs.readFileSync(path.join(__dirname, "..", "packages", "core-skill", "scripts", "capture_template_slots.js"), "utf8");

assert.ok(JUDGMENT_ROUTES.length >= 2, "judgment source should have multiple entry routes");
assert.ok(ENFORCEMENT_ROUTES.length >= 2, "enforcement source should have multiple entry routes");
assert.ok(JUDGMENT_ROUTES.some((route) => route.url("濮阳测试有限公司").includes("wenshu.court.gov.cn")));
assert.ok(ENFORCEMENT_ROUTES.some((route) => route.url().includes("zxgk.court.gov.cn")));

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
assert.ok(!captureSource.includes("案由|案件名称|文书/.test(initialText)"), "judgment home page navigation must not be accepted as a result page");
assert.ok(!captureSource.includes("案由|案件名称|文书/.test(compact)"), "judgment capture validation must not accept the home page only because it contains navigation labels");
assert.ok(!captureSource.includes("裁判日期|案由|案件名称"), "judgment placeholder text must not be accepted as a result page");

assert.ok(!captureSource.includes("solveEnforcementImageText"), "official enforcement source must not auto-submit image-text challenges");
assert.ok(captureSource.includes("enforcement_official_image_text_policy"), "official enforcement image-text policy should be audited");
assert.ok(captureSource.includes("official_judicial_source_requires_managed_official_confirmation"), "official enforcement source must explain why image-text automation is disabled");

console.log("judicial-success-helpers ok");
