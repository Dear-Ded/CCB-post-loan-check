function abortError(sourceId = "judicial_source") {
  return new Error(`${sourceId} aborted by capture budget`);
}

function throwIfAborted(signal, sourceId) {
  if (signal?.aborted) throw abortError(sourceId);
}

function sleep(ms, signal, sourceId) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(sourceId));
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(abortError(sourceId));
      }, { once: true });
    }
  });
}

function jitter(baseMs, spreadMs) {
  const spread = Math.max(0, Number(spreadMs || 0));
  return Math.max(0, Math.floor(Number(baseMs || 0) + Math.random() * spread));
}

class JudicialRunScheduler {
  constructor({
    audit,
    stateStore,
    baseDelayMs = Number(process.env.POST_LOAN_JUDICIAL_BASE_DELAY_MS || 2500),
    retryDelayMs = Number(process.env.POST_LOAN_JUDICIAL_RETRY_DELAY_MS || 6000),
    jitterMs = Number(process.env.POST_LOAN_JUDICIAL_JITTER_MS || 2500),
    cooldownMs = Number(process.env.POST_LOAN_JUDICIAL_COOLDOWN_MS || 10 * 60 * 1000)
  } = {}) {
    this.audit = audit;
    this.stateStore = stateStore;
    this.baseDelayMs = baseDelayMs;
    this.retryDelayMs = retryDelayMs;
    this.jitterMs = jitterMs;
    this.cooldownMs = cooldownMs;
  }

  isCoolingDown(sourceId) {
    return Boolean(this.stateStore?.isCoolingDown(sourceId));
  }

  async beforeAttempt(sourceId, attempt = 1, options = {}) {
    throwIfAborted(options.signal, sourceId);
    if (this.isCoolingDown(sourceId) && !options.ignoreCooldown) {
      const state = this.stateStore?.get(sourceId);
      this.audit?.record("judicial_source_cooling_down", {
        sourceId,
        attempt,
        cooldownUntil: state?.cooldownUntil || "",
        reason: state?.lastReason || ""
      });
      throw new Error(`${sourceId} is cooling down until ${state?.cooldownUntil || "later"}`);
    }
    if (this.isCoolingDown(sourceId) && options.ignoreCooldown) {
      const state = this.stateStore?.get(sourceId);
      this.audit?.record("judicial_source_cooldown_overridden_for_required_capture", {
        sourceId,
        attempt,
        cooldownUntil: state?.cooldownUntil || "",
        reason: state?.lastReason || ""
      });
    }
    const delayMs = jitter(attempt <= 1 ? this.baseDelayMs : this.retryDelayMs * attempt, this.jitterMs);
    this.audit?.record("judicial_attempt_wait", { sourceId, attempt, delayMs });
    await sleep(delayMs, options.signal, sourceId);
  }

  markSuccess(sourceId, payload = {}) {
    this.stateStore?.markSuccess(sourceId, payload);
    this.audit?.record("judicial_source_success", { sourceId, ...payload });
  }

  markFailure(sourceId, reason, payload = {}) {
    this.stateStore?.markCooldown(sourceId, {
      reason,
      cooldownMs: this.cooldownMs,
      payload
    });
    this.audit?.record("judicial_source_failure", {
      sourceId,
      reason,
      cooldownMs: this.cooldownMs,
      ...payload
    });
  }

  async runWithRetries(sourceId, attempts, task, options = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        throwIfAborted(options.signal, sourceId);
        await this.beforeAttempt(sourceId, attempt, options);
        throwIfAborted(options.signal, sourceId);
        const result = await task(attempt);
        throwIfAborted(options.signal, sourceId);
        this.markSuccess(sourceId, { attempt });
        return result;
      } catch (error) {
        lastError = error;
        const message = String(error && error.message ? error.message : error);
        this.audit?.record("judicial_attempt_failed", { sourceId, attempt, error: message });
        if (/aborted by capture budget/.test(message)) break;
        if (/cooling down/.test(message)) break;
      }
    }
    const reason = String(lastError && lastError.message ? lastError.message : lastError || "unknown");
    this.markFailure(sourceId, reason);
    throw lastError || new Error(`${sourceId} failed`);
  }
}

module.exports = { JudicialRunScheduler };
