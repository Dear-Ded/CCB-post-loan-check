const JUDGMENT_ROUTES = [
  {
    id: "wenshu_home",
    url: () => "https://wenshu.court.gov.cn/"
  },
  {
    id: "wenshu_search",
    url: (company) => `https://wenshu.court.gov.cn/website/wenshu/181217BMTKHNT2W0/index.html?s21=${encodeURIComponent(company)}`
  },
  {
    id: "wenshu_fulltext_search",
    url: (company) => `https://wenshu.court.gov.cn/website/wenshu/181107ANFZ0BXSK4/index.html?docId=&s21=${encodeURIComponent(company)}`
  }
];

const ENFORCEMENT_ROUTES = [
  {
    id: "zxgk_https_home",
    url: () => "https://zxgk.court.gov.cn/"
  },
  {
    id: "zxgk_http_home",
    url: () => "http://zxgk.court.gov.cn/"
  },
  {
    id: "zhzxgk_http_query",
    url: () => "http://zxgk.court.gov.cn/zhzxgk/"
  },
  {
    id: "zhixing_http_query",
    url: () => "http://zxgk.court.gov.cn/zhixing/"
  },
  {
    id: "shixin_http_query",
    url: () => "http://zxgk.court.gov.cn/shixin/"
  },
  {
    id: "zhzxgk_query",
    url: () => "https://zxgk.court.gov.cn/zhzxgk/"
  },
  {
    id: "zhixing_query",
    url: () => "https://zxgk.court.gov.cn/zhixing/"
  },
  {
    id: "shixin_query",
    url: () => "https://zxgk.court.gov.cn/shixin/"
  }
];

function isAuthorizedJudgmentShot(shot) {
  const label = String(shot?.name || "");
  return Boolean(shot?.authorizedProvider && /裁判|文书|司法|judgment|wenshu/i.test(label));
}

function isAuthorizedEnforcementShot(shot, name = "") {
  const label = String(shot?.name || "");
  const matched = /执行|被执行|enforcement|zhixing/i.test(label);
  return Boolean(shot?.authorizedProvider && matched && (!name || label.includes(name)));
}

module.exports = {
  ENFORCEMENT_ROUTES,
  JUDGMENT_ROUTES,
  isAuthorizedEnforcementShot,
  isAuthorizedJudgmentShot
};
