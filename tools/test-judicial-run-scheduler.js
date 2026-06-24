const assert = require("assert");
const { JudicialRunScheduler } = require("../packages/core-skill/scripts/framework/judicial_run_scheduler");

async function main() {
  const events = [];
  const scheduler = new JudicialRunScheduler({
    audit: { record: (type, payload) => events.push({ type, ...payload }) },
    stateStore: {
      isCoolingDown: () => false,
      markSuccess: () => {},
      markCooldown: () => {}
    },
    baseDelayMs: 0,
    retryDelayMs: 0,
    jitterMs: 0,
    cooldownMs: 1
  });

  let attempts = 0;
  await assert.rejects(
    scheduler.runWithRetries("judicial_wenshu", 5, async () => {
      attempts += 1;
      throw new Error("China Judgments Online wenshu_search requires an authorized session");
    }, { nonRetryableErrorPattern: /requires an authorized session/i }),
    /requires an authorized session/
  );

  assert.strictEqual(attempts, 1);
  assert.strictEqual(events.filter((event) => event.type === "judicial_attempt_failed").length, 1);

  console.log("judicial-run-scheduler ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
