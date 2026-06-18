const fs = require("fs");
const path = require("path");
const { BrowserProfileManager } = require("./profile_manager");
const { detectPageChallenge } = require("./challenge_detector");

class SessionManager {
  constructor({ root, audit } = {}) {
    this.profileManager = new BrowserProfileManager({ root });
    this.audit = audit;
  }

  profilePath(scope) {
    return this.profileManager.profilePath(scope);
  }

  statePath(scope) {
    return path.join(this.profilePath(scope), "post-loan-session-state.json");
  }

  readState(scope) {
    const file = this.statePath(scope);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      this.audit?.record("session_state_read_failed", { scope, file, error: String(error.message || error) });
      return null;
    }
  }

  writeState(scope, state = {}) {
    const file = this.statePath(scope);
    const payload = {
      scope,
      updatedAt: new Date().toISOString(),
      ...state
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
    this.audit?.record("session_state_saved", { scope, file, status: payload.status || "unknown" });
    return payload;
  }

  async preflightPage(page, sourceId, expected) {
    const snapshot = await detectPageChallenge(page);
    const status = snapshot.challenge.kind === "none" ? "valid" : "challenge-required";
    this.audit?.record("session_preflight_completed", {
      sourceId,
      status,
      url: snapshot.url,
      challenge: snapshot.challenge,
      expected
    });
    return { status, ...snapshot };
  }
}

module.exports = { SessionManager };
