// Paritaets-/Kontrakt-Test fuer die T4-Phase-3-Extraktion der Read-/Export-Routen.
//
// Die drei GET-Routen (/api/state, /api/calls/:id, /api/tenant-data/export) wurden
// 1:1 aus server.js nach src/routes/api-read.js (makeReadRoutes) verschoben. Dieser
// Test pinnt den KONTRAKT der extrahierten Factory ISOLIERT (injizierter Mock-Store +
// Fake-config + Fake-tenant-Resolver, kein Server-Spawn): jede Invariante, die die
// Inline-Routen garantierten, bleibt erhalten. Schwerpunkt auf den beiden Pre-Mortem-
// Risiken der Phase (t4-server-decomposition.md, Phase 3):
//   R3.1  streamToken (WS-Zugangsgeheimnis) + interne Flags leaken in KEINER der drei
//         Antworten (publicCall-Invariante, dieselbe wie media-token.test.js).
//   R3.2  Owner-PII-Naht: das ownerNumber-Feld ist seit P4 ganz entfernt (war seit P2b
//         immer "") - keine Antwort traegt es mehr (verhindert Re-Einfuehrung).
// Der Voll-Server-Pfad (realer Mount + reale Stores) ist ueber api.test.js/read-scope-
// tenant.test.js/media-token.test.js abgedeckt; dieser Test sichert die Naht selbst -
// die Factory bekommt store/config/audit/tenant injiziert, also pruefbar ohne Boot.
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

const STREAM_TOKEN = "s".repeat(32); // WS-Zugangsgeheimnis, darf nie eine Antwort verlassen
const FOREIGN = "tenant_foreign";
const FUTURE = "2999-01-01T00:00:00.000Z"; // kommender Termin -> bleibt
const PAST = "2000-01-01T00:00:00.000Z"; // vergangener Termin -> weggefiltert

// Ein Call traegt streamToken + _finished: genau die internen Felder, die publicCall
// strippen MUSS. ownerCall gehoert dem Owner, foreignCall einem fremden Tenant.
function makeCall(id, tenantId) {
  return { id, tenantId, streamToken: STREAM_TOKEN, _finished: true, summary: id };
}

// Mock-Store mit genau den Methoden, die die drei Routen ueber views/store nutzen.
// counts skaliert die Listen (Slice-Kappung); calendar liefert je 1 zukuenftigen +
// 1 vergangenen Termin (upcomingCalendar-Filter).
function makeMockStore({ listSize = 1 } = {}) {
  const ownerCall = makeCall("call_owner", BOOTSTRAP_TENANT_ID);
  const foreignCall = makeCall("call_foreign", FOREIGN);
  const calls = [ownerCall, foreignCall];
  const bulk = (prefix) => Array.from({ length: listSize }, (_, i) => ({ id: `${prefix}${i}` }));
  return {
    // Flag-aus-Pfad: ungefilterte Bestandslisten direkt aus load().
    load: () => ({
      calls,
      actionItems: bulk("ai"),
      notifications: bulk("n"),
      numbers: [
        { tenantId: BOOTSTRAP_TENANT_ID, e164: "+4915200000001", status: NUMBER_STATUS.ACTIVE },
      ],
    }),
    tenantContext: () => ({ settings: { greeting: "hi" }, ownerName: "Jonas" }),
    // Flag-an-Pfad: tenant-gescopte Listen. calls nach tenantId gefiltert.
    exportTenantData: (t) => ({
      calls: calls.filter((c) => c.tenantId === t),
      actionItems: bulk(`ai-${t}-`),
      notifications: bulk(`n-${t}-`),
    }),
    // P1: usageOf liefert den REALEN Bucket-Shape (costCents autoritativ). usageView
    // (api-read.js) leitet costEur davon ab UND whitelistet - costCents/costMicroCentsRem
    // duerfen die API NICHT verlassen (s. Test unten).
    usageOf: () => ({ inputTokens: 5, outputTokens: 7, costCents: 200, costMicroCentsRem: 999, calls: 3 }),
    getCall: (id) => calls.find((c) => c.id === id),
    getCalendar: () => [
      { end: FUTURE, title: "future" },
      { end: PAST, title: "past" },
    ],
  };
}

// Fake-config: alle Felder, die /api/state liest. multiTenant pro Test setzbar.
function makeConfig(overrides = {}) {
  return withConfigNamespaces({
    multiTenant: false,
    claudeModel: "claude-haiku-4-5",
    voiceEngine: "budget",
    platformSpendCapCents: 800,
    ...overrides,
  });
}

// Fake-tenant-Resolver: requestTenant aus Header X-Test-Tenant (Default Owner);
// requireTenant spiegelt requestTenant, REJECT (Header X-Test-Reject) -> 403 + null
// (exakt wie der reale requireTenant: Antwort gesendet, null zurueck). tenantOwnsCall
// = das reale Praedikat (call.tenantId === tenant), eine Quelle wie in server.js.
function makeTenant() {
  const resolve = (req) => req.headers["x-test-tenant"] || BOOTSTRAP_TENANT_ID;
  return {
    requestTenant: resolve,
    requireTenant: (req, res) => {
      if (req.headers["x-test-reject"]) {
        res.status(403).json({ error: "tenant" });
        return null;
      }
      return resolve(req);
    },
    tenantOwnsCall: (call, tenant) => call.tenantId === tenant,
  };
}

// Bare-App mit gemounteter Factory; echter Listener auf Port 0 -> fetch. audits
// sammelt jeden audit()-Aufruf (Beweis fuer data_export / kein Leak im Reject-Pfad).
async function mount(store, config) {
  const audits = [];
  const app = express();
  app.use(express.json());
  app.use(makeReadRoutes({ store, config, audit: (...a) => audits.push(a), tenant: makeTenant() }));
  const server = await new Promise((res) => {
    const s = app.listen(0, () => res(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, audits, stop: () => new Promise((r) => server.close(r)) };
}

// Antwort darf weder den Token-Wert noch das Feld streamToken/_finished tragen (R3.1).
function assertNoStreamToken(body, where) {
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes(STREAM_TOKEN), `${where}: leakt den streamToken-Wert`);
  assert.ok(!serialized.includes("streamToken"), `${where}: leakt das Feld streamToken`);
  assert.ok(!serialized.includes("_finished"), `${where}: leakt das interne Feld _finished`);
}

test("GET /api/state (Flag aus, Owner-Sicht): Bestandskontrakt + R3.1 + R3.2", async () => {
  const srv = await mount(makeMockStore(), makeConfig({ multiTenant: false }));
  try {
    const res = await fetch(`${srv.base}/api/state`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.deepEqual(body.settings, { greeting: "hi" });
    // Flag aus -> ungefilterte Bestandsliste (beide Calls), durch publicCall.
    assert.equal(body.calls.length, 2);
    assertNoStreamToken(body, "/api/state"); // R3.1
    assert.equal(body.usage.maxBudgetEur, 8);
    // P1: costEur wird an DIESER Kante aus costCents abgeleitet (200 Cents -> 2.00 EUR);
    // die internen Felder costCents/costMicroCentsRem verlassen die API NICHT (Whitelist).
    assert.equal(body.usage.costEur, 2);
    assert.equal(body.usage.calls, 3);
    assert.ok(!("costCents" in body.usage), "costCents ist intern, kein API-Leak");
    assert.ok(!("costMicroCentsRem" in body.usage), "costMicroCentsRem ist intern, kein API-Leak");
    // upcomingCalendar filtert den vergangenen Termin weg -> nur der zukuenftige.
    assert.equal(body.calendar.length, 1);
    assert.equal(body.calendar[0].title, "future");
    // agent-Block: number = aktive Store-Nummer des Tenants (auch der Owner ist Tenant
    // Null, keine config-Nummer mehr). P4: ownerNumber-Feld ganz entfernt (war seit P2b
    // immer "", toter Ballast) -> der Schluessel existiert nicht mehr.
    assert.equal(body.agent.number, "+4915200000001");
    assert.equal(body.agent.numberStatus, "active"); // AM5: aktive Owner-Nummer -> "active"
    assert.equal(body.agent.owner, "Jonas");
    assert.ok(!("ownerNumber" in body.agent), "ownerNumber-Feld ist entfernt (P4)");
    assert.equal(body.agent.model, "claude-haiku-4-5");
    assert.equal(body.agent.voiceEngine, "budget");
    // outbound-p3: allowedNumbers ist aus der Agent-Status-Flaeche entfernt (statische
    // Allowlist abgeschafft) - das Feld existiert nicht mehr (Symmetrie zu ownerNumber).
    assert.ok(!("allowedNumbers" in body.agent), "allowedNumbers-Feld ist entfernt (outbound-p3)");
  } finally {
    await srv.stop();
  }
});

test("GET /api/state (Flag an, fremder Tenant): R3.2 Owner-PII geblockt + scoped + fail-closed-Nummer", async () => {
  const srv = await mount(makeMockStore(), makeConfig({ multiTenant: true }));
  try {
    const res = await fetch(`${srv.base}/api/state`, { headers: { "x-test-tenant": FOREIGN } });
    assert.equal(res.status, 200);
    const body = await res.json();

    // R3.2: ownerNumber-Feld ist entfernt (P4) - keine Sicht traegt es mehr.
    assert.ok(!("ownerNumber" in body.agent), "ownerNumber-Feld ist entfernt (P4)");
    // Listen-Scope ueber exportTenantData(FOREIGN) -> nur der fremde Call.
    assert.equal(body.calls.length, 1);
    assert.equal(body.calls[0].id, "call_foreign");
    // activeNumberFor fail-closed: FOREIGN hat keine aktive Nummer -> "", NIE die
    // Owner-Nummer als Fremd-Tenant-Fallback (kein PII-/Toll-Fraud-Leck).
    assert.equal(body.agent.number, "");
    assert.equal(body.agent.numberStatus, "none"); // AM5: keine eigene Nummer -> "none"
    assertNoStreamToken(body, "/api/state(scoped)"); // R3.1 auch im scoped-Pfad
  } finally {
    await srv.stop();
  }
});

test("GET /api/state (Flag an, Owner-Tenant): Owner-PII sichtbar + aktive Owner-Nummer", async () => {
  const srv = await mount(makeMockStore(), makeConfig({ multiTenant: true }));
  try {
    const res = await fetch(`${srv.base}/api/state`, {
      headers: { "x-test-tenant": BOOTSTRAP_TENANT_ID },
    });
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.ok(!("ownerNumber" in body.agent), "ownerNumber-Feld ist entfernt (P4)");
    assert.equal(body.agent.number, "+4915200000001"); // aktive Owner-Nummer
    assert.equal(body.calls.length, 1);
    assert.equal(body.calls[0].id, "call_owner");
  } finally {
    await srv.stop();
  }
});

test("GET /api/state: Slices kappen auf STATE_*-Grenzen", async () => {
  // Mehr Eintraege als jede Slice-Grenze -> die benannten Konstanten greifen.
  const srv = await mount(
    makeMockStore({ listSize: STATE_ACTION_ITEMS + 20 }),
    makeConfig({ multiTenant: false }),
  );
  try {
    const body = await (await fetch(`${srv.base}/api/state`)).json();
    assert.equal(body.actionItems.length, STATE_ACTION_ITEMS); // 50
    assert.equal(body.notifications.length, STATE_NOTIFICATIONS); // 10
    assert.ok(body.calls.length <= STATE_CALLS); // 30 (hier 2)
    assert.ok(body.calendar.length <= STATE_CALENDAR); // 10 (hier 1)
  } finally {
    await srv.stop();
  }
});

test("GET /api/calls/:id: vorhandener Call durch publicCall (R3.1)", async () => {
  const srv = await mount(makeMockStore(), makeConfig({ multiTenant: false }));
  try {
    const res = await fetch(`${srv.base}/api/calls/call_owner`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, "call_owner");
    assert.equal(body.summary, "call_owner");
    assertNoStreamToken(body, "/api/calls/:id"); // R3.1
  } finally {
    await srv.stop();
  }
});

test("GET /api/calls/:id: fehlender Call -> 404", async () => {
  const srv = await mount(makeMockStore(), makeConfig({ multiTenant: false }));
  try {
    const res = await fetch(`${srv.base}/api/calls/does_not_exist`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not found" });
  } finally {
    await srv.stop();
  }
});

test("GET /api/calls/:id (Flag an): fremder Call -> 404 (kein Existenz-Leck, NICHT 403)", async () => {
  const srv = await mount(makeMockStore(), makeConfig({ multiTenant: true }));
  try {
    // Owner fragt den fremden Call ab -> tenantOwnsCall false -> 404.
    const res = await fetch(`${srv.base}/api/calls/call_foreign`, {
      headers: { "x-test-tenant": BOOTSTRAP_TENANT_ID },
    });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not found" });
  } finally {
    await srv.stop();
  }
});

test("GET /api/calls/:id (Flag aus): fremder Call -> 200 (Legacy byte-identisch, Guard gegatet)", async () => {
  const srv = await mount(makeMockStore(), makeConfig({ multiTenant: false }));
  try {
    // Flag aus -> der tenantOwnsCall-Guard wird per config.multiTenant uebersprungen,
    // damit Legacy-Calls ohne tenantId byte-identisch 200 bleiben.
    const res = await fetch(`${srv.base}/api/calls/call_foreign`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, "call_foreign");
    assertNoStreamToken(body, "/api/calls/:id(legacy)");
  } finally {
    await srv.stop();
  }
});

test("GET /api/tenant-data/export: Owner-Export, Calls gestrippt (R3.1) + audit", async () => {
  const srv = await mount(makeMockStore(), makeConfig({ multiTenant: false }));
  try {
    const res = await fetch(`${srv.base}/api/tenant-data/export`);
    assert.equal(res.status, 200);
    const body = await res.json();
    // Owner-Export: der Owner-Call ist dabei, durch publicCall gestrippt.
    assert.ok(body.calls.some((c) => c.id === "call_owner"));
    assertNoStreamToken(body, "/api/tenant-data/export"); // R3.1
    assert.ok(Array.isArray(body.actionItems));
    assert.ok(Array.isArray(body.notifications));
    // Genau ein data_export-audit mit den drei Counts.
    assert.equal(srv.audits.length, 1);
    assert.equal(srv.audits[0][0], "data_export");
  } finally {
    await srv.stop();
  }
});

test("GET /api/tenant-data/export: requireTenant REJECT -> 403, kein Export, kein audit", async () => {
  const srv = await mount(makeMockStore(), makeConfig({ multiTenant: true }));
  try {
    const res = await fetch(`${srv.base}/api/tenant-data/export`, {
      headers: { "x-test-reject": "1" },
    });
    assert.equal(res.status, 403);
    // Fail-closed: kein Export-Body und KEIN audit (der Handler bricht vor beidem ab).
    assert.equal(srv.audits.length, 0);
  } finally {
    await srv.stop();
  }
});
