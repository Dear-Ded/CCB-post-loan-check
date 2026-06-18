const fs = require("fs");
const os = require("os");
const path = require("path");

class SourceStateStore {
  constructor({ file, audit } = {}) {
    this.file = file || path.join(os.homedir(), ".codex", "post-loan-portal-check", "source-state.json");
    this.audit = audit;
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return { sources: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return parsed && typeof parsed === "object" ? { sources: {}, ...parsed } : { sources: {} };
    } catch (error) {
      this.audit?.record("source_state_load_failed", { file: this.file, error: String(error.message || error) });
      return { sources: {} };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), "utf8");
  }

  get(sourceId) {
    return this.state.sources[sourceId] || null;
  }

  isCoolingDown(sourceId) {
    const item = this.get(sourceId);
    if (!item?.cooldownUntil) return false;
    if (Date.now() >= new Date(item.cooldownUntil).getTime()) {
      this.clearCooldown(sourceId);
      return false;
    }
    return true;
  }

  markSuccess(sourceId, payload = {}) {
    this.state.sources[sourceId] = {
      ...(this.state.sources[sourceId] || {}),
      status: "healthy",
      lastSuccessAt: new Date().toISOString(),
      lastReason: "",
      cooldownUntil: "",
      ...payload
    };
    this.save();
    this.audit?.record("source_state_success", { sourceId, ...payload });
  }

  markCooldown(sourceId, { reason = "", cooldownMs = 0, payload = {} } = {}) {
    const cooldownUntil = cooldownMs ? new Date(Date.now() + cooldownMs).toISOString() : "";
    this.state.sources[sourceId] = {
      ...(this.state.sources[sourceId] || {}),
      status: "cooldown",
      lastFailureAt: new Date().toISOString(),
      lastReason: reason,
      cooldownUntil,
      ...payload
    };
    this.save();
    this.audit?.record("source_state_cooldown", { sourceId, reason, cooldownMs, cooldownUntil, ...payload });
  }

  clearCooldown(sourceId) {
    const current = this.state.sources[sourceId];
    if (!current) return;
    this.state.sources[sourceId] = {
      ...current,
      status: current.lastSuccessAt ? "healthy" : "unknown",
      cooldownUntil: ""
    };
    this.save();
    this.audit?.record("source_state_cooldown_cleared", { sourceId });
  }
}

module.exports = { SourceStateStore };
