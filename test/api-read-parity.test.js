import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  makeReadRoutes,
  STATE_CALLS,
  STATE_ACTION_ITEMS,
  STATE_CALENDAR,
  STATE_NOTIFICATIONS,
} from "../src/routes/api-read.js";
import { BOOTSTRAP_TENANT_ID, NUMBER_STATUS } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const STREAM_TOKEN_LENGTH = 32;
const STREAM_TOKEN = "s".repeat(STREAM_TOKEN_LENGTH);
const FOREIGN = "tenant_foreign";
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
const MOCK_RESERVATION_CENTS = 60;
const MOCK_USAGE_CALLS = 3;
const SLICE_OVERFLOW = 20;

function makeCall(id, tenantId) {
  return { id, tenantId, streamToken: STREAM_TOKEN, _finished: true, summary: id };
}

function makeMockStore({ listSize = 1 } = {}) {
  const ownerCall = makeCall("call_owner", BOOTSTRAP_TENANT_ID);
  const foreignCall = makeCall("call_foreign", FOREIGN);
  const calls = [ownerCall, foreignCall];
  const bulk = (prefix) => Array.from({ length: listSize }, (_item, i) => ({ id: `${prefix}${i}` }));
  return {
    load: () => ({
      calls,
      actionItems: bulk("ai"),
      notifications: bulk("n"),
      numbers: [
        { tenantId: BOOTSTRAP_TENANT_ID, e164: "+4915200000001", status: NUMBER_STATUS.ACTIVE },
      ],
      usageEvents: [],
    }),
    tenantContext: () => ({ settings: { greeting: "hi" }, ownerName: "Jonas" }),
    tenantSubscription: () => ({
      planSlug: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      periodCreditRevoked: false,
    }),
    exportTenantData: (tenantId) => ({
      calls: calls.filter((call) => call.tenantId === tenantId),
      actionItems: bulk(`ai-${tenantId}-`),
      notifications: bulk(`n-${tenantId}-`),
    }),
    usageOf: () => ({ inputTokens: 5, outputTokens: 7, costCents: 200, costMicroCentsRem: 999, calls: 3 }),
    tenantBudgetSnapshot: () => ({ capCents: 1000, spentCents: 200, remainingCents: 800 }),
    reservationOf: () => MOCK_RESERVATION_CENTS,
    getCall: (id) => calls.find((call) => call.id === id),
    getCalendar: () => [
      { end: FUTURE, title: "future" },
      { end: PAST, title: "past" },
    ],
  };
}

function makeConfig(overrides = {}) {
  return withConfigNamespaces({
    claudeModel: "claude-haiku-4-5",
    voiceEngine: "budget",
    platformSpendCapCents: 800,
    ...overrides,
  });
}

function makeTenant() {
  const resolve = (req) => req.headers["x-test-tenant"] || BOOTSTRAP_TENANT_ID;
  return {
    requestTenant: resolve,
    requireTenant: (req, res) => {
      if (req.headers["x-test-reject"]) {
        res.status(HTTP_FORBIDDEN).json({ error: "tenant" });
        return null;
      }
      return resolve(req);
    },
    tenantOwnsCall: (call, tenant) => call.tenantId === tenant,
  };
}

async function mount(store, config) {
  const audits = [];
  const app = express();
  app.use(express.json());
  app.use(makeReadRoutes({ store, config, audit: (...args) => audits.push(args), tenant: makeTenant() }));
  const server = await new Promise((resolveListening) => {
    const httpServer = app.listen(0, () => resolveListening(httpServer));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, audits, stop: () => new Promise((resolveClose) => server.close(resolveClose)) };
}

function assertNoStreamToken(body, where) {
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes(STREAM_TOKEN), `${where}: leakt den streamToken-Wert`);
  assert.ok(!serialized.includes("streamToken"), `${where}: leakt das Feld streamToken`);
  assert.ok(!serialized.includes("_finished"), `${where}: leakt das interne Feld _finished`);
}

test("GET /api/state (Owner-Sicht): Bestandskontrakt + R3.1 + R3.2", async () => {
  const srv = await mount(makeMockStore(), makeConfig());
  try {
    const res = await fetch(`${srv.base}/api/state`);
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();

    assert.deepEqual(body.settings, { greeting: "hi" });
    assert.equal(body.calls.length, 1);
    assert.equal(body.calls[0].id, "call_owner");
    assertNoStreamToken(body, "/api/state");
    assert.equal(body.usage.planUsagePercent, null);
    assert.ok(!("tenantCapEur" in body.usage), "tenantCapEur entfaellt ersatzlos (KS-P8)");
    assert.ok(!("costEur" in body.usage), "costEur entfaellt ersatzlos (KS-P8)");
    assert.equal(body.usage.calls, MOCK_USAGE_CALLS);
    assert.ok(!("costCents" in body.usage), "costCents ist intern, kein API-Leak");
    assert.ok(!("costMicroCentsRem" in body.usage), "costMicroCentsRem ist intern, kein API-Leak");
    assert.equal(body.calendar.length, 1);
    assert.equal(body.calendar[0].title, "future");
    assert.equal(body.agent.number, "+4915200000001");
    assert.equal(body.agent.numberStatus, "active");
    assert.equal(body.agent.owner, "Jonas");
    assert.ok(!("ownerNumber" in body.agent), "ownerNumber-Feld ist entfernt (P4)");
    assert.equal(body.agent.model, "claude-haiku-4-5");
    assert.equal(body.agent.voiceEngine, "budget");
    assert.ok(!("allowedNumbers" in body.agent), "allowedNumbers-Feld ist entfernt (outbound-p3)");
  } finally {
    await srv.stop();
  }
});

test("GET /api/state (fremder Tenant): R3.2 Owner-PII geblockt + scoped + fail-closed-Nummer", async () => {
  const srv = await mount(makeMockStore(), makeConfig());
  try {
    const res = await fetch(`${srv.base}/api/state`, { headers: { "x-test-tenant": FOREIGN } });
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();

    assert.ok(!("ownerNumber" in body.agent), "ownerNumber-Feld ist entfernt (P4)");
    assert.equal(body.calls.length, 1);
    assert.equal(body.calls[0].id, "call_foreign");
    assert.equal(body.agent.number, "");
    assert.equal(body.agent.numberStatus, "none");
    assertNoStreamToken(body, "/api/state(scoped)");
  } finally {
    await srv.stop();
  }
});

test("GET /api/state (Owner-Tenant): Owner-PII sichtbar + aktive Owner-Nummer", async () => {
  const srv = await mount(makeMockStore(), makeConfig());
  try {
    const res = await fetch(`${srv.base}/api/state`, {
      headers: { "x-test-tenant": BOOTSTRAP_TENANT_ID },
    });
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();

    assert.ok(!("ownerNumber" in body.agent), "ownerNumber-Feld ist entfernt (P4)");
    assert.equal(body.agent.number, "+4915200000001");
    assert.equal(body.calls.length, 1);
    assert.equal(body.calls[0].id, "call_owner");
  } finally {
    await srv.stop();
  }
});

test("GET /api/state: Slices kappen auf STATE_*-Grenzen", async () => {
  const srv = await mount(makeMockStore({ listSize: STATE_ACTION_ITEMS + SLICE_OVERFLOW }), makeConfig());
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.actionItems.length, STATE_ACTION_ITEMS);
    assert.equal(body.notifications.length, STATE_NOTIFICATIONS);
    assert.ok(body.calls.length <= STATE_CALLS);
    assert.ok(body.calendar.length <= STATE_CALENDAR);
  } finally {
    await srv.stop();
  }
});

test("GET /api/calls/:id: vorhandener Call durch publicCall (R3.1)", async () => {
  const srv = await mount(makeMockStore(), makeConfig());
  try {
    const res = await fetch(`${srv.base}/api/calls/call_owner`);
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();
    assert.equal(body.id, "call_owner");
    assert.equal(body.summary, "call_owner");
    assertNoStreamToken(body, "/api/calls/:id");
  } finally {
    await srv.stop();
  }
});

test("GET /api/calls/:id: fehlender Call -> 404", async () => {
  const srv = await mount(makeMockStore(), makeConfig());
  try {
    const res = await fetch(`${srv.base}/api/calls/does_not_exist`);
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.deepEqual(await res.json(), { error: "not found" });
  } finally {
    await srv.stop();
  }
});

test("GET /api/calls/:id: fremder Call -> 404 (kein Existenz-Leck, NICHT 403)", async () => {
  const srv = await mount(makeMockStore(), makeConfig());
  try {
    const res = await fetch(`${srv.base}/api/calls/call_foreign`, {
      headers: { "x-test-tenant": BOOTSTRAP_TENANT_ID },
    });
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.deepEqual(await res.json(), { error: "not found" });
  } finally {
    await srv.stop();
  }
});

test("GET /api/calls/:id: fremder Call ohne Tenant-Header -> 404", async () => {
  const srv = await mount(makeMockStore(), makeConfig());
  try {
    const res = await fetch(`${srv.base}/api/calls/call_foreign`);
    assert.equal(res.status, HTTP_NOT_FOUND);
    assert.deepEqual(await res.json(), { error: "not found" });
  } finally {
    await srv.stop();
  }
});

test("GET /api/tenant-data/export: Owner-Export, Calls gestrippt (R3.1) + audit", async () => {
  const srv = await mount(makeMockStore(), makeConfig());
  try {
    const res = await fetch(`${srv.base}/api/tenant-data/export`);
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();
    assert.ok(body.calls.some((call) => call.id === "call_owner"));
    assertNoStreamToken(body, "/api/tenant-data/export");
    assert.ok(Array.isArray(body.actionItems));
    assert.ok(Array.isArray(body.notifications));
    assert.equal(srv.audits.length, 1);
    assert.equal(srv.audits[0][0], "data_export");
  } finally {
    await srv.stop();
  }
});

test("GET /api/tenant-data/export: requireTenant REJECT -> 403, kein Export, kein audit", async () => {
  const srv = await mount(makeMockStore(), makeConfig());
  try {
    const res = await fetch(`${srv.base}/api/tenant-data/export`, {
      headers: { "x-test-reject": "1" },
    });
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.equal(srv.audits.length, 0);
  } finally {
    await srv.stop();
  }
});
