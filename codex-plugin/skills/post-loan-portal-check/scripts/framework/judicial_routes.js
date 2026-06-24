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
    id: "zhzxgk_query",
    kind: "enterprise_enforcement",
    url: () => "https://zxgk.court.gov.cn/zhzxgk/"
  },
  {
    id: "shixin_query",
    kind: "dishonest_enforcement",
    url: () => "https://zxgk.court.gov.cn/shixin/"
  },
  {
    id: "zxgk_https_home",
    kind: "home",
    url: () => "https://zxgk.court.gov.cn/"
  },
  {
    id: "zhixing_query",
    kind: "personal_enforcement",
    url: () => "https://zxgk.court.gov.cn/zhixing/"
  },
  {
    id: "zhzxgk_http_query",
    kind: "enterprise_enforcement",
    url: () => "http://zxgk.court.gov.cn/zhzxgk/"
  },
  {
    id: "shixin_http_query",
    kind: "dishonest_enforcement",
    url: () => "http://zxgk.court.gov.cn/shixin/"
  },
  {
    id: "zhixing_http_query",
    kind: "personal_enforcement",
    url: () => "http://zxgk.court.gov.cn/zhixing/"
  },
  {
    id: "zxgk_http_home",
    kind: "home",
    url: () => "http://zxgk.court.gov.cn/"
  }
];

const OFFICIAL_EXECUTION_NAVIGATION_ROUTES = [
  {
    id: "court_service_navigation_execution",
    kind: "official_navigation",
    resultCapable: false,
    url: () => "https://cjdh.court.gov.cn/performInformation.html"
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
  OFFICIAL_EXECUTION_NAVIGATION_ROUTES,
  isAuthorizedEnforcementShot,
  isAuthorizedJudgmentShot
};
