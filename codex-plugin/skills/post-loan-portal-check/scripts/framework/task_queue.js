class TaskQueue {
  constructor({ audit, concurrency = 1, defaultTimeoutMs = 120000, defaultRetries = 1 } = {}) {
    this.audit = audit;
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.defaultRetries = defaultRetries;
    this.tasks = [];
    this.results = [];
    this.domainState = new Map();
  }

  add(task) {
    if (!task || !task.id || typeof task.run !== "function") {
      throw new Error("TaskQueue.add requires { id, run }");
    }
    this.tasks.push(task);
    return task;
  }

  isCoolingDown(key) {
    const item = this.domainState.get(key);
    if (!item) return false;
    if (Date.now() >= item.until) {
      this.domainState.delete(key);
      return false;
    }
    return true;
  }

  coolDown(key, cooldownMs, reason) {
    if (!key || !cooldownMs) return;
    const until = Date.now() + cooldownMs;
    this.domainState.set(key, { until, reason });
    this.audit?.record("task_queue_domain_cooldown", { key, cooldownMs, reason });
  }

  async runAll() {
    const results = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < this.tasks.length) {
        const task = this.tasks[cursor];
        cursor += 1;
        results.push(await this.runTask(task));
      }
    };
    await Promise.all(Array.from({ length: this.concurrency }, () => worker()));
    this.results = results;
    return results;
  }

  async runTask(task) {
    const retries = Number.isFinite(task.retries) ? task.retries : this.defaultRetries;
    const timeoutMs = task.timeoutMs || this.defaultTimeoutMs;
    const cooldownKey = task.cooldownKey || task.sourceId;

    if (cooldownKey && this.isCoolingDown(cooldownKey)) {
      this.audit?.record("task_queue_task_skipped_cooldown", { id: task.id, sourceId: task.sourceId, cooldownKey });
      return { id: task.id, ok: false, skipped: true, reason: "cooldown" };
    }

    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const startedAt = Date.now();
      this.audit?.record("task_queue_task_started", { id: task.id, sourceId: task.sourceId, attempt });
      try {
        const value = await withTimeout(task.run({ attempt }), timeoutMs, task.id);
        this.audit?.record("task_queue_task_completed", {
          id: task.id,
          sourceId: task.sourceId,
          attempt,
          durationMs: Date.now() - startedAt
        });
        return { id: task.id, ok: true, value };
      } catch (error) {
        const message = String(error && error.message ? error.message : error);
        this.audit?.record("task_queue_task_failed", {
          id: task.id,
          sourceId: task.sourceId,
          attempt,
          durationMs: Date.now() - startedAt,
          error: message
        });
        if (attempt > retries) {
          if (task.cooldownMs && cooldownKey) this.coolDown(cooldownKey, task.cooldownMs, message);
          return { id: task.id, ok: false, error: message };
        }
      }
    }
    return { id: task.id, ok: false, error: "unknown_task_queue_failure" };
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { TaskQueue, withTimeout };
