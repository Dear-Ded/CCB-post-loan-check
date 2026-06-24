const assert = require("assert");
const { buildRequiredEvidence, assertRequiredEvidence } = require("../packages/core-skill/scripts/framework/evidence_contract");

function shot(slot, name, url) {
  return { slot, name, url, screenshot: `shot-${slot}.png`, validation: { ok: true } };
}

const complete = {
  company: "主体A",
  smokeQuick: false,
  skipSearch: false,
  judicialEnabled: true,
  includeHealthCommission: true,
  persons: [{ name: "自然人A" }],
  searchResult: { skipped: false, ok: true, engine: "bing", pages: 3 },
  screenshots: [
    shot(1, "河南省应急管理厅", "https://yjglt.henan.gov.cn/"),
    shot(2, "河南省生态环境厅", "https://sthjt.henan.gov.cn/"),
    shot(3, "河南省市场监督管理局", "https://scjg.henan.gov.cn/"),
    shot(4, "河南省卫生健康委员会", "https://wsjkw.henan.gov.cn/"),
    shot(5, "中国裁判文书网", "https://wenshu.court.gov.cn/"),
    shot(6, "中国执行信息公开网", "https://zxgk.court.gov.cn/zhzxgk/"),
    shot(7, "个人被执行信息-自然人A", "https://zxgk.court.gov.cn/zhzxgk/"),
    shot(8, "Bing搜索-page-1", "https://www.bing.com/search?q=x"),
    shot(9, "Bing搜索-page-2", "https://www.bing.com/search?q=x&first=11"),
    shot(10, "Bing搜索-page-3", "https://www.bing.com/search?q=x&first=21")
  ]
};

assert.strictEqual(buildRequiredEvidence(complete).ok, true);
assert.doesNotThrow(() => assertRequiredEvidence(complete));

const missingJudicial = {
  ...complete,
  screenshots: complete.screenshots.filter((item) => item.name !== "中国裁判文书网")
};
assert.strictEqual(buildRequiredEvidence(missingJudicial).ok, false);
assert.throws(() => assertRequiredEvidence(missingJudicial), /missing_judgment_result/);

const authorizedProviderJudicial = {
  ...missingJudicial,
  screenshots: [
    ...missingJudicial.screenshots.filter((item) => !item.name.includes("中国执行信息公开网") && !item.name.includes("个人被执行信息")),
    { ...shot(11, "授权司法数据-裁判文书", "authorized-provider://judgment"), authorizedProvider: true },
    { ...shot(12, "授权司法数据-执行信息", "authorized-provider://enforcement"), authorizedProvider: true },
    { ...shot(13, "授权司法数据-个人被执行信息-自然人A", "authorized-provider://person"), authorizedProvider: true }
  ]
};
assert.strictEqual(buildRequiredEvidence(authorizedProviderJudicial).ok, false);
assert.throws(() => assertRequiredEvidence(authorizedProviderJudicial), /missing_judgment_result/);

const publicJudicialSignals = {
  ...missingJudicial,
  screenshots: [
    ...missingJudicial.screenshots.filter((item) => !item.name.includes("中国执行信息公开网") && !item.name.includes("个人被执行信息")),
    { ...shot(14, "公开司法线索-裁判-Bing", "https://www.bing.com/search?q=x"), publicJudicialSignal: true, text: "裁判 文书 案号" },
    { ...shot(15, "公开司法线索-执行-Bing", "https://www.bing.com/search?q=x"), publicJudicialSignal: true, text: "被执行 失信 执行" }
  ]
};
assert.strictEqual(buildRequiredEvidence(publicJudicialSignals).ok, false);
assert.throws(() => assertRequiredEvidence(publicJudicialSignals), /missing_judgment_result/);

const missingHealth = {
  ...complete,
  screenshots: complete.screenshots.filter((item) => !item.name.includes("卫生健康委员会"))
};
assert.throws(() => assertRequiredEvidence(missingHealth), /missing_health_commission/);

const skipSearch = {
  ...complete,
  skipSearch: true,
  searchResult: { skipped: true },
  screenshots: complete.screenshots.filter((item) => !item.name.includes("page-"))
};
assert.strictEqual(buildRequiredEvidence(skipSearch).ok, true);

const missingSearchPage = {
  ...complete,
  screenshots: complete.screenshots.filter((item) => !item.name.includes("page-2"))
};
const missingSearchEvidence = buildRequiredEvidence(missingSearchPage);
assert.strictEqual(missingSearchEvidence.ok, false);
assert.deepStrictEqual(
  missingSearchEvidence.items.find((item) => item.id === "search_engine_pages").missingPages,
  [2]
);

console.log("evidence-contract ok");
