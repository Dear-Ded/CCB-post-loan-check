const { ChallengeMode } = require("./challenge_policy");

class JudicialSourcePolicy {
  constructor({ mode = ChallengeMode.ASSISTED, audit } = {}) {
    this.mode = mode;
    this.audit = audit;
  }

  canAutoSolveCaptcha() {
    return this.mode === ChallengeMode.AUTO;
  }

  shouldUseAssistedMode() {
    return this.mode === ChallengeMode.ASSISTED;
  }

  shouldBlock() {
    return this.mode === ChallengeMode.BLOCKED;
  }

  recordDecision(sourceId, reason) {
    this.audit?.record("judicial_policy_decision", {
      sourceId,
      mode: this.mode,
      reason
    });
  }
}

module.exports = { JudicialSourcePolicy };
