const assert = require("assert");

const { detectChallengeSignal } = require("../packages/core-skill/scripts/framework/challenge_detector");
const { ChallengeKind } = require("../packages/core-skill/scripts/framework/challenge_policy");

function expectKind(input, kind) {
  const detected = detectChallengeSignal(input);
  assert.strictEqual(detected.kind, kind, `${input.text || input.url} should be ${kind}, got ${detected.kind}`);
}

expectKind({ text: "请输入验证码" }, ChallengeKind.CAPTCHA_TEXT);
expectKind({ text: "请输入计算结果 3 + 5" }, ChallengeKind.CAPTCHA_ARITHMETIC);
expectKind({ text: "请拖动滑块完成验证" }, ChallengeKind.CAPTCHA_SLIDER);
expectKind({ text: "请依次点击图中文字" }, ChallengeKind.CAPTCHA_CLICK);
expectKind({ text: "系统检测到访问异常，请完成安全验证" }, ChallengeKind.SECURITY_GATE);
expectKind({ text: "访问过于频繁，请稍后再试" }, ChallengeKind.RATE_LIMIT);
expectKind({ url: "https://example.com/login", text: "账号登录" }, ChallengeKind.LOGIN);
expectKind({ text: "企业信用信息查询结果" }, ChallengeKind.NONE);

console.log("challenge-detector ok");
