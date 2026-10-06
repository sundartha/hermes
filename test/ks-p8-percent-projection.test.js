import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeReadRoutes } from "../src/routes/api-read.js";
import { recordUsageEvent, makeDefaultState } from "../src/store/state-ops.js";
import { USAGE_EVENT_KIND, BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const MS_PER_SECOND = 1000;
const PERIOD_END_SEC = Date.UTC(2026, 6, 15) / MS_PER_SECOND;
const IN_WINDOW = "2026-06-20T10:00:00.000Z";

const MONEY_KEY = /eur|cents$|price|amount|budget|cap$/i;
function moneyKeysIn(value, path = "$") {
  if (Array.isArray(value)) return value.flatMap((v, i) => moneyKeysIn(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => {
      const here = MONEY_KEY.test(k) ? [`${path}.${k}`] : [];
      return [...here, ...moneyKeysIn(v, `${path}.${k}`)];
    });
  }
  return [];
}

function seedQuotaState({ usedMinutes = 0 } = {}) {
  const s = makeDefaultState();
  if (usedMinutes > 0) {
    const e = recordUsageEvent(s, {
      tenantId: BOOTSTRAP_TENANT_ID,
      kind: USAGE_EVENT_KIND.VOICE_MINUTE,
      quantity: usedMinutes,
      costCents: 0,
    });
    e.occurredAt = IN_WINDOW;
  }
  return s;
}

function makeMockStore({ state, subscription = {} } = {}) {
  return {
    load: () => ({ ...state, calls: [], actionItems: [], notifications: [], numbers: [] }),
    tenantContext: () => ({ settings: {}, ownerName: "Jonas" }),
    exportTenantData: () => ({ calls: [], actionItems: [], notifications: [] }),
    usageOf: () => ({ inputTokens: 5, outputTokens: 7, calls: 3 }),
    tenantSubscription: () => ({
      planSlug: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      periodCreditRevoked: false,
      ...subscription,
    }),
    getCalendar: () => [],
  };
}

function makeConfig() {
  return withConfigNamespaces({
    multiTenant: false,
    claudeModel: "claude-haiku-4-5",
    voiceEngine: "budget",
  });
}

function makeTenant() {
  return {
    requestTenant: () => BOOTSTRAP_TENANT_ID,
    requireTenant: () => BOOTSTRAP_TENANT_ID,
    tenantOwnsCall: () => true,
  };
}

async function mount(store) {
  const app = express();
  app.use(express.json());
  app.use(makeReadRoutes({ store, config: makeConfig(), audit: () => {}, tenant: makeTenant() }));
  const server = await new Promise((res) => {
    const s = app.listen(0, () => res(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, stop: () => new Promise((r) => server.close(r)) };
}

test("K1: usage-Whitelist traegt genau calls/inputTokens/outputTokens/planUsagePercent", async () => {
  const store = makeMockStore({ state: seedQuotaState() });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.deepEqual(
      Object.keys(body.usage).sort(),
      ["calls", "inputTokens", "outputTokens", "planUsagePercent"],
    );
  } finally {
    await srv.stop();
  }
});

test("K2: kein Waehrungs-/Geldfeld in der gesamten /api/state-Antwort", async () => {
  const store = makeMockStore({
    state: seedQuotaState({ usedMinutes: 12 }),
    subscription: { planSlug: "starter", currentPeriodEnd: PERIOD_END_SEC },
  });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.deepEqual(moneyKeysIn(body), []);
  } finally {
    await srv.stop();
  }
});

test("K3: Starter 30 min, 12 verbraucht -> 40 Prozent", async () => {
  const store = makeMockStore({
    state: seedQuotaState({ usedMinutes: 12 }),
    subscription: { planSlug: "starter", currentPeriodEnd: PERIOD_END_SEC },
  });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.usage.planUsagePercent, 40);
  } finally {
    await srv.stop();
  }
});

test("K4: kein Plan hinterlegt -> planUsagePercent null (nie 0)", async () => {
  const store = makeMockStore({ state: seedQuotaState() });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.usage.planUsagePercent, null);
  } finally {
    await srv.stop();
  }
});

test("K5: erschoepft (30 von 30 Minuten) -> 100 Prozent", async () => {
  const store = makeMockStore({
    state: seedQuotaState({ usedMinutes: 30 }),
    subscription: { planSlug: "starter", currentPeriodEnd: PERIOD_END_SEC },
  });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.usage.planUsagePercent, 100);
  } finally {
    await srv.stop();
  }
});

test("K6: 29 von 30 Minuten -> 96 Prozent (floor, nie 100)", async () => {
  const store = makeMockStore({
    state: seedQuotaState({ usedMinutes: 29 }),
    subscription: { planSlug: "starter", currentPeriodEnd: PERIOD_END_SEC },
  });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.usage.planUsagePercent, 96);
  } finally {
    await srv.stop();
  }
});

test("K7: kein Perioden-Anker -> 100 Prozent (fail-closed, == Gate)", async () => {
  const store = makeMockStore({
    state: seedQuotaState(),
    subscription: { planSlug: "starter", currentPeriodEnd: null },
  });
  const srv = await mount(store);
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.usage.planUsagePercent, 100);
  } finally {
    await srv.stop();
  }
});

test("K8: reine Leseprojektion - usageEvents byte-identisch, kein save()", async () => {
  const state = seedQuotaState({ usedMinutes: 12 });
  const before = JSON.stringify(state.usageEvents);
  let saveCalls = 0;
  const store = {
    ...makeMockStore({
      state,
      subscription: { planSlug: "starter", currentPeriodEnd: PERIOD_END_SEC },
    }),
    save: () => {
      saveCalls++;
    },
  };
  const srv = await mount(store);
  try {
    await fetch(`${srv.base}/api/state`);
    await fetch(`${srv.base}/api/state`);
    assert.equal(JSON.stringify(state.usageEvents), before);
    assert.equal(saveCalls, 0);
  } finally {
    await srv.stop();
  }
});
