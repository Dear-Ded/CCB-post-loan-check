function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

async function waitForPageSettled(page, {
  domContentTimeoutMs = 15000,
  networkIdleTimeoutMs = 5000,
  settleMs = 300
} = {}) {
  await page.waitForLoadState?.("domcontentloaded", { timeout: domContentTimeoutMs }).catch(() => {});
  await page.waitForLoadState?.("networkidle", { timeout: networkIdleTimeoutMs }).catch(() => {});
  if (page.waitForTimeout) await page.waitForTimeout(settleMs).catch(() => {});
  else await sleep(settleMs);
}

async function locatorVisible(locator, timeoutMs = 1000) {
  return Boolean(await locator?.isVisible?.({ timeout: timeoutMs }).catch(() => false));
}

async function fillInputReliably(page, selector, value, {
  audit,
  label = selector,
  verifyTimeoutMs = 1000,
  settleMs = 120
} = {}) {
  const locator = page.locator(selector).first();
  if (!await locatorVisible(locator, verifyTimeoutMs)) {
    audit?.record("page_input_missing", { selector, label });
    return false;
  }

  await locator.click({ clickCount: 3 }).catch(() => {});
  await locator.fill("").catch(() => {});
  await locator.fill(String(value)).catch(() => {});
  if (page.waitForTimeout) await page.waitForTimeout(settleMs).catch(() => {});
  else await sleep(settleMs);

  let current = await locator.inputValue?.({ timeout: verifyTimeoutMs }).catch(() => "");
  if (String(current) !== String(value)) {
    await page.evaluate?.(({ selector: currentSelector, value: currentValue }) => {
      const input = document.querySelector(currentSelector);
      if (!input) return;
      input.value = currentValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, { selector, value: String(value) }).catch(() => {});
    current = await locator.inputValue?.({ timeout: verifyTimeoutMs }).catch(() => "");
  }

  const ok = String(current) === String(value);
  audit?.record(ok ? "page_input_filled" : "page_input_fill_failed", { selector, label, valueLength: String(value).length });
  return ok;
}

async function clickAndWait(page, selector, {
  audit,
  label = selector,
  beforeMs = 150,
  afterMs = 600,
  timeoutMs = 2000
} = {}) {
  const locator = page.locator(selector).first();
  if (!await locatorVisible(locator, timeoutMs)) {
    audit?.record("page_click_target_missing", { selector, label });
    return false;
  }
  if (page.waitForTimeout) await page.waitForTimeout(beforeMs).catch(() => {});
  else await sleep(beforeMs);
  await locator.click({ timeout: timeoutMs });
  await waitForPageSettled(page, { settleMs: afterMs });
  audit?.record("page_click_completed", { selector, label });
  return true;
}

async function runRouteWithFallbacks(page, routes, task, {
  audit,
  sourceId = "source",
  attempts = routes.length,
  waitOptions = {},
  validate = (result) => Boolean(result?.ok)
} = {}) {
  if (!Array.isArray(routes) || !routes.length) throw new Error(`${sourceId} has no routes`);
  let lastError = null;
  const maxAttempts = Math.max(1, Number(attempts || routes.length));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const route = routes[(attempt - 1) % routes.length];
    try {
      const url = typeof route.url === "function" ? route.url() : route.url;
      audit?.record("page_route_attempt", { sourceId, routeId: route.id || "", attempt, url });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: route.timeoutMs || 45000 });
      await waitForPageSettled(page, waitOptions);
      const result = await task({ route, attempt, page });
      if (validate(result)) {
        audit?.record("page_route_success", { sourceId, routeId: route.id || "", attempt });
        return { ok: true, route, attempt, result };
      }
      lastError = new Error(result?.reason || `${sourceId} route did not validate`);
      audit?.record("page_route_not_validated", { sourceId, routeId: route.id || "", attempt, reason: lastError.message });
    } catch (error) {
      lastError = error;
      audit?.record("page_route_failed", {
        sourceId,
        routeId: route.id || "",
        attempt,
        error: String(error && error.message ? error.message : error)
      });
    }
  }
  return {
    ok: false,
    route: null,
    attempt: maxAttempts,
    error: String(lastError && lastError.message ? lastError.message : lastError || "route_not_validated")
  };
}

module.exports = {
  waitForPageSettled,
  fillInputReliably,
  clickAndWait,
  runRouteWithFallbacks
};
