const { ChallengeKind } = require("./challenge_policy");

const DETECTION_RULES = [
  {
    kind: ChallengeKind.RATE_LIMIT,
    reason: "rate_limited",
    patterns: [
      /访问过于频繁/,
      /异常流量/,
      /请求过于频繁/,
      /unusual\s*traffic/i,
      /too many requests/i,
      /rate limit/i,
      /429/
    ]
  },
  {
    kind: ChallengeKind.LOGIN,
    reason: "login_required",
    patterns: [
      /请登录/,
      /用户登录/,
      /登录后/,
      /账号登录/,
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
      /请完成安全验证/,
      /最后一步.*继续/,
      /服务异常/,
      /系统繁忙/,
      /验证你不是机器人/,
      /人机验证/,
      /502|503|504/,
      /solve.*puzzle/i,
      /cloudflare/i,
      /waf/i
    ]
  },
  {
    kind: ChallengeKind.CAPTCHA_SLIDER,
    reason: "slider_challenge",
    patterns: [
      /滑块/,
      /拖动滑块/,
      /向右滑动/,
      /滑动验证/,
      /slider/i,
      /slide to verify/i
    ]
  },
  {
    kind: ChallengeKind.CAPTCHA_CLICK,
    reason: "click_challenge",
    patterns: [
      /点选/,
      /依次点击/,
      /点击.*文字/,
      /点击.*图中/,
      /click.*captcha/i
    ]
  },
  {
    kind: ChallengeKind.CAPTCHA_ARITHMETIC,
    reason: "arithmetic_image_text",
    patterns: [
      /算术/,
      /计算结果/,
      /请输入计算结果/,
      /请输入.*结果/,
      /\d+\s*[+\-*/x×]\s*\d+/
    ]
  },
  {
    kind: ChallengeKind.CAPTCHA_TEXT,
    reason: "simple_image_text",
    patterns: [
      /captcha/i,
      /verify\s*code/i,
      /验证码/,
      /校验码/,
      /图片文字/,
      /请输入.*验证码/,
      /请输入.*校验码/
    ]
  },
  {
    kind: ChallengeKind.CAPTCHA,
    reason: "captcha_or_human_verification",
    patterns: [
      /wappass\.baidu\.com/,
      /passport\.baidu\.com/,
      /安全验证/,
      /人机校验/,
      /human verification/i
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
