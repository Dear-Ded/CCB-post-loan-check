const { ChallengeKind } = require("./challenge_policy");

const DETECTION_RULES = [
  {
    kind: ChallengeKind.RATE_LIMIT,
    reason: "rate_limited",
    patterns: [
      /访问过于频繁/,
      /异常流量/,
      /unusual\s*traffic/i,
      /too many requests/i,
      /rate limit/i,
      /429/
    ]
  },
  {
    kind: ChallengeKind.CAPTCHA,
    reason: "captcha_or_human_verification",
    patterns: [
      /wappass\.baidu\.com/,
      /passport\.baidu\.com/,
      /captcha/i,
      /verify/i,
      /验证码/,
      /安全验证/,
      /人机验证/,
      /验证你不是机器人/,
      /请输入.*校验码/
    ]
  },
  {
    kind: ChallengeKind.LOGIN,
    reason: "login_required",
    patterns: [
      /请登录/,
      /用户登录/,
      /登录后/,
      /passport/i,
      /\/login\b/i,
      /signin/i
    ]
  },
  {
    kind: ChallengeKind.SECURITY_GATE,
    reason: "abnormal_or_security_gate",
    patterns: [
      /网络不给力/,
      /访问异常/,
      /系统检测到/,
      /服务异常/,
      /系统繁忙/,
      /502|503|504/,
      /cloudflare/i,
      /waf/i
    ]
  }
];

function compactSignal({ url = "", text = "", title = "" } = {}) {
  return `${url} ${title} ${text}`.replace(/\s+/g, "");
}

function detectChallengeSignal(input = {}) {
  const signal = compactSignal(input);
  for (const rule of DETECTION_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(signal))) {
      return {
        kind: rule.kind,
        reason: rule.reason,
        signalSample: signal.slice(0, 240)
      };
    }
  }
  return { kind: ChallengeKind.NONE, reason: "", signalSample: signal.slice(0, 240) };
}

async function detectPageChallenge(page, options = {}) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const text = await page.locator("body").innerText({ timeout: options.timeoutMs || 3000 }).catch(() => "");
  return {
    url,
    title,
    text,
    challenge: detectChallengeSignal({ url, title, text })
  };
}

module.exports = {
  DETECTION_RULES,
  compactSignal,
  detectChallengeSignal,
  detectPageChallenge
};
