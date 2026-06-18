const ChallengeMode = Object.freeze({
  AUTO: "auto",
  ASSISTED: "assisted",
  BLOCKED: "blocked"
});

const ChallengeKind = Object.freeze({
  NONE: "none",
  CAPTCHA: "captcha",
  LOGIN: "login",
  RATE_LIMIT: "rate_limit",
  SECURITY_GATE: "security_gate",
  RESULT_MISMATCH: "result_mismatch",
  UNKNOWN: "unknown"
});

function detectChallengeSignal({ url = "", text = "" }) {
  return require("./challenge_detector").detectChallengeSignal({ url, text });
}

function defaultModeForSource(sourceType) {
  if (sourceType === "judicial" || sourceType === "government-strong") return ChallengeMode.ASSISTED;
  if (sourceType === "internal" || sourceType === "authorized" || sourceType === "public-low-risk") return ChallengeMode.AUTO;
  return ChallengeMode.ASSISTED;
}

class CircuitBreaker {
  constructor({ cooldownMs = 5 * 60 * 1000, threshold = 1 } = {}) {
    this.cooldownMs = cooldownMs;
    this.threshold = threshold;
    this.state = new Map();
  }

  isOpen(key) {
    const item = this.state.get(key);
    if (!item) return false;
    if (Date.now() >= item.until) {
      this.state.delete(key);
      return false;
    }
    return true;
  }

  trip(key, reason = "") {
    const current = this.state.get(key) || { count: 0, until: 0, reason: "" };
    const count = current.count + 1;
    const until = count >= this.threshold ? Date.now() + this.cooldownMs : 0;
    this.state.set(key, { count, until, reason });
  }

  reset(key) {
    this.state.delete(key);
  }

  snapshot() {
    return [...this.state.entries()].map(([key, value]) => ({ key, ...value }));
  }
}

module.exports = {
  ChallengeMode,
  ChallengeKind,
  CircuitBreaker,
  detectChallengeSignal,
  defaultModeForSource
};
