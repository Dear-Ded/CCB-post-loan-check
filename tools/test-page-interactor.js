const assert = require("assert");

const {
  fillInputReliably,
  clickAndWait,
  runRouteWithFallbacks
} = require("../packages/core-skill/scripts/framework/page_interactor");

function makeLocator(state, selector) {
  return {
    first: () => makeLocator(state, selector),
    isVisible: async () => Boolean(state.visible[selector]),
    click: async () => {
      state.clicked.push(selector);
    },
    fill: async (value) => {
      state.values[selector] = value;
    },
    inputValue: async () => state.values[selector] || ""
  };
}

function makePage({ visible = {}, values = {}, validateOnRoute = "route-2" } = {}) {
  const state = {
    visible,
    values,
    clicked: [],
    waits: [],
    routes: [],
    validateOnRoute
  };
  return {
    state,
    locator: (selector) => makeLocator(state, selector),
    waitForLoadState: async (stateName) => state.waits.push(stateName),
    waitForTimeout: async (ms) => state.waits.push(`timeout:${ms}`),
    evaluate: async ({ selector, value }) => {
      state.values[selector] = value;
    },
    goto: async (url) => {
      state.routes.push(url);
    }
  };
}

(async () => {
  const auditEvents = [];
  const audit = { record: (type, payload) => auditEvents.push({ type, payload }) };

  const page = makePage({ visible: { "#name": true, "#submit": true } });
  assert.strictEqual(await fillInputReliably(page, "#name", "濮阳测试有限公司", { audit, settleMs: 0 }), true);
  assert.strictEqual(page.state.values["#name"], "濮阳测试有限公司");
  assert(auditEvents.some((event) => event.type === "page_input_filled"));

  assert.strictEqual(await fillInputReliably(page, "#missing", "value", { audit, settleMs: 0 }), false);
  assert(auditEvents.some((event) => event.type === "page_input_missing"));

  assert.strictEqual(await clickAndWait(page, "#submit", { audit, beforeMs: 0, afterMs: 0 }), true);
  assert(page.state.clicked.includes("#submit"));
  assert(auditEvents.some((event) => event.type === "page_click_completed"));

  const routedPage = makePage();
  const routes = [
    { id: "route-1", url: "https://example.test/one" },
    { id: "route-2", url: "https://example.test/two" }
  ];
  const routed = await runRouteWithFallbacks(
    routedPage,
    routes,
    async ({ route }) => ({ ok: route.id === "route-2", reason: "not_ready" }),
    { audit, sourceId: "public-test-source", waitOptions: { settleMs: 0 } }
  );
  assert.strictEqual(routed.ok, true);
  assert.strictEqual(routed.route.id, "route-2");
  assert.deepStrictEqual(routedPage.state.routes, ["https://example.test/one", "https://example.test/two"]);
  assert(auditEvents.some((event) => event.type === "page_route_not_validated"));
  assert(auditEvents.some((event) => event.type === "page_route_success"));

  console.log("page-interactor ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
