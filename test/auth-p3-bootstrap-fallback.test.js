// AUTH-P3: Bootstrap-Fallback fail-closed. Bis hierher galt "keine Identitaet =
// Bootstrap-/Owner-Tenant" unkonditional - das war nur wahr, solange das Basic-Auth-Gate
// jeden anonymen Request abfing (PLAN-AUTH-GATE Abschnitt 1). Diese Phase engt genau EINEN
// Fallback ein: operatorChannelTenant liefert den Bootstrap-Tenant NUR noch fuer den genuin
// lokalen In-Process-Aufrufer (isTrustedLocalCaller - echtes Loopback, kein
// X-Forwarded-For), jeder andere identitaetslose Request -> TENANT_REJECT.
//
// Testpraefix bewusst "AUTH-P3-N" (NICHT DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|
// PROMPT|UI|VOICE|WEB|WORLD-<Ziffer>): sonst landet die Datei still im test:gates-Lauf,
// wo Rot erlaubt ist und nichts meldet (Lehre catalog-id-prefix-misroutes-tests).
//
// Wie die Spawn-Tests das Basic-Auth-Gate nachweislich UMGEHEN (nicht messen sie sonst die
// falsche Sicherung): BASE_ENV.DASHBOARD_PASSWORD = "" (test/helpers.js) -> makeAuthGate
// (src/wiring/auth-gate.js) startet mit `if (!config.auth.dashboardPassword) return next();`
// - das Gate ist ABWESEND, nicht umgangen. Jeder 403-Test hier prueft zusaetzlich
// res.status !== 401 und www-authenticate === null: sollte je ein Passwort in die
// Umgebung leaken, meldet der Test es, statt still das Gate zu messen. Rate-Limit ist kein
// Stoerfaktor (RATE_LIMIT_PER_MIN="1000" in BASE_ENV).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  operatorChannelTenant,
  makeRequestTenant,
  TENANT_REJECT,
} from "../src/routes/_tenant.js";
import { startServer, seedState, seedCall, mcpPost, toolCall, readToolResult } from "./helpers.js";

// --- Unit-Test-Helfer (Muster request-tenant-unit.test.js, EINE Datei = eigene Kopie,
// Repo-Konvention - siehe reqWith/fakeRes in u.a. error-handler.test.js) ---

function withMultiTenant(value, fn) {
  const saved = config.tenancy.multiTenant;
  config.tenancy.multiTenant = value;
  try {
    return fn();
  } finally {
    config.tenancy.multiTenant = saved;
  }
}

function makeStore(map = {}) {
  const calls = [];
  return {
    calls,
    resolveTenant(id) {
      calls.push(id);
      return Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null;
    },
  };
}

function reqWith({ remoteAddress = "203.0.113.7", headers = {}, auth, tenant } = {}) {
  const req = { socket: { remoteAddress }, headers };
  if (auth !== undefined) req.auth = auth;
  if (tenant !== undefined) req.tenant = tenant;
  return req;
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

const LOCAL_ADDRS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const EXTERNAL_ADDR = "203.0.113.7";

// === operatorChannelTenant ======================================================

test("AUTH-P3-1: operatorChannelTenant, Loopback ohne XFF -> BOOTSTRAP_TENANT_ID", () => {
  for (const addr of LOCAL_ADDRS) {
    assert.equal(
      operatorChannelTenant(reqWith({ remoteAddress: addr, headers: {} })),
      BOOTSTRAP_TENANT_ID,
      addr,
    );
  }
});

test("AUTH-P3-2: operatorChannelTenant, Loopback MIT X-Forwarded-For -> TENANT_REJECT (Render-Proxy)", () => {
  for (const addr of LOCAL_ADDRS) {
    const req = reqWith({ remoteAddress: addr, headers: { "x-forwarded-for": "203.0.113.9" } });
    const out = operatorChannelTenant(req);
    assert.equal(out, TENANT_REJECT, addr);
    assert.notEqual(out, BOOTSTRAP_TENANT_ID, addr);
  }
});

test("AUTH-P3-3: operatorChannelTenant, externer Socket -> TENANT_REJECT (mit und ohne XFF)", () => {
  assert.equal(operatorChannelTenant(reqWith({ remoteAddress: EXTERNAL_ADDR, headers: {} })), TENANT_REJECT);
  assert.equal(
    operatorChannelTenant(
      reqWith({ remoteAddress: EXTERNAL_ADDR, headers: { "x-forwarded-for": EXTERNAL_ADDR } }),
    ),
    TENANT_REJECT,
  );
});

// === requestTenant / requireTenant ==============================================

test("AUTH-P3-4: requestTenant, Flag AUS, externer Aufrufer -> TENANT_REJECT, kein Lookup", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(false, () => {
    assert.equal(requestTenant(reqWith({ remoteAddress: EXTERNAL_ADDR })), TENANT_REJECT);
  });
  assert.deepEqual(store.calls, [], "Flag-aus-Pfad darf store.resolveTenant nie aufrufen");
});

test("AUTH-P3-5: requestTenant, Flag AUS, Loopback ohne XFF -> BOOTSTRAP_TENANT_ID, kein Lookup", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(false, () => {
    assert.equal(
      requestTenant(reqWith({ remoteAddress: "127.0.0.1", headers: {} })),
      BOOTSTRAP_TENANT_ID,
    );
  });
  assert.deepEqual(store.calls, [], "In-Process-Pfad bleibt byte-identisch (kein Lookup)");
});

test("AUTH-P3-6: requestTenant, Flag AN, keinerlei Identitaet, externer Socket -> TENANT_REJECT", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    assert.equal(
      requestTenant(reqWith({ remoteAddress: EXTERNAL_ADDR, headers: {} })),
      TENANT_REJECT,
    );
  });
  assert.deepEqual(store.calls, []);
});

test("AUTH-P3-7: requestTenant, Flag AN, keinerlei Identitaet, Loopback ohne XFF (stdio/MCP) -> BOOTSTRAP_TENANT_ID", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    assert.equal(
      requestTenant(reqWith({ remoteAddress: "127.0.0.1", headers: {} })),
      BOOTSTRAP_TENANT_ID,
    );
  });
  assert.deepEqual(store.calls, []);
});

test("AUTH-P3-8: requireTenant, Flag AUS, externer Aufrufer -> 403, null", () => {
  const store = makeStore();
  const { requireTenant } = makeRequestTenant(store);
  const res = fakeRes();
  const out = withMultiTenant(false, () =>
    requireTenant(reqWith({ remoteAddress: EXTERNAL_ADDR }), res),
  );
  assert.equal(out, null);
  assert.equal(res.statusCode, 403);
  assert.ok(res.body && typeof res.body.error === "string", "403-Body traegt eine Fehlermeldung");
});

// === Invariante: BOOTSTRAP nur im EINEN von vier Faellen ========================

test("AUTH-P3-9: operatorChannelTenant liefert BOOTSTRAP_TENANT_ID NUR bei Loopback ohne XFF", () => {
  const cases = [
    { label: "loopback, kein XFF", remoteAddress: "127.0.0.1", headers: {}, expectBootstrap: true },
    {
      label: "loopback, mit XFF",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "203.0.113.9" },
      expectBootstrap: false,
    },
    { label: "extern, kein XFF", remoteAddress: EXTERNAL_ADDR, headers: {}, expectBootstrap: false },
    {
      label: "extern, mit XFF",
      remoteAddress: EXTERNAL_ADDR,
      headers: { "x-forwarded-for": EXTERNAL_ADDR },
      expectBootstrap: false,
    },
  ];
  for (const { label, remoteAddress, headers, expectBootstrap } of cases) {
    const out = operatorChannelTenant(reqWith({ remoteAddress, headers }));
    assert.equal(out, expectBootstrap ? BOOTSTRAP_TENANT_ID : TENANT_REJECT, label);
  }
});

// === Spawn-Tests: Gate beweisbar abwesend (DASHBOARD_PASSWORD="" in BASE_ENV) ====

// Pinnt das Gate als ABWESEND statt umgangen: kein 401, kein www-authenticate-Header.
function assertGateAbsent(res) {
  assert.notEqual(res.status, 401, "das ist NICHT das Basic-Auth-Gate, das hier misst");
  assert.equal(
    res.headers.get("www-authenticate"),
    null,
    "kein www-authenticate -> misst tatsaechlich AUTH-P3, nicht das Gate",
  );
}

test("AUTH-P3-10: GET /api/tenant-data/export, MULTI_TENANT=true, externer Aufrufer (XFF) -> 403", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({ calls: [seedCall()] }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/api/tenant-data/export`, {
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    assert.equal(res.status, 403);
    assertGateAbsent(res);
    const body = await res.json();
    assert.ok(body.error, "403-Body traegt eine Fehlermeldung");
    assert.ok(
      !srv.stdout.includes("[audit] data_export"),
      "kein data_export-Audit -> der Export wurde NICHT ausgeliefert",
    );
  } finally {
    await srv.stop();
  }
});

test("AUTH-P3-11: GET /api/tenant-data/export, MULTI_TENANT=false, externer Aufrufer (XFF) -> 403", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "false" },
    seed: seedState({ calls: [seedCall()] }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/api/tenant-data/export`, {
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    assert.equal(res.status, 403);
    assertGateAbsent(res);
  } finally {
    await srv.stop();
  }
});

test("AUTH-P3-12: POST /api/settings, MULTI_TENANT=true, externer Aufrufer (XFF) -> 403, kein Schreibzugriff", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({}),
  });
  try {
    const res = await fetch(`${srv.localUrl}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9" },
      body: JSON.stringify({ agentName: "Gekapert" }),
    });
    assert.equal(res.status, 403);
    assertGateAbsent(res);
    // Kein akzeptierter Schreibzugriff -> store.save() lief nie -> die Datei traegt noch
    // die urspruengliche, UNMIGRIERTE Flach-Form (Migration auf die owner-keyed Map
    // passiert nur in-memory bei load(); persistiert erst beim naechsten save()).
    const store = srv.readStore();
    assert.equal(store.settings.agentName, "Hermes", "der Owner-Settings-Bucket bleibt unangetastet");
  } finally {
    await srv.stop();
  }
});

test("AUTH-P3-13: POST /api/calls, MULTI_TENANT=false, externer Aufrufer (XFF) -> 403 (tenant_reject), kein Anruf", async () => {
  const srv = await startServer({
    env: {
      MULTI_TENANT: "false",
      TWILIO_ACCOUNT_SID: "x", // nicht-AC -> Twilio-Client wirft sync -> ein durchgelassener Call waere 500
      ALLOWED_COUNTRY_CODES: "+49",
    },
    seed: seedState({}),
  });
  try {
    const res = await fetch(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9" },
      body: JSON.stringify({ to: "+4915712345678", objective: "Test" }),
    });
    assert.equal(res.status, 403, "tenant_reject, NICHT 500 (das Gate schliesst vor dem Originate)");
    assertGateAbsent(res);
    assert.equal(srv.readStore().calls.length, 0, "der anonyme Anruf entsteht gar nicht mehr");
  } finally {
    await srv.stop();
  }
});

test("AUTH-P3-14: In-Process-Pfad lebt - Loopback ohne XFF sieht weiter Owner-Daten (200)", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({ calls: [seedCall()] }),
  });
  try {
    const stateRes = await fetch(`${srv.localUrl}/api/state`);
    assert.equal(stateRes.status, 200);
    const state = await stateRes.json();
    assert.equal(state.agent.owner, "Jonas Beispiel");
    assert.equal(state.calls.length, 1);

    const exportRes = await fetch(`${srv.localUrl}/api/tenant-data/export`);
    assert.equal(exportRes.status, 200);
    const exported = await exportRes.json();
    assert.equal(exported.tenantId, BOOTSTRAP_TENANT_ID);
  } finally {
    await srv.stop();
  }
});

test("AUTH-P3-15: MCP-Tools sterben nicht - list_calls ueber Loopback ohne XFF (MCP_AUTH=off)", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({ calls: [seedCall()] }),
  });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("list_calls"));
    const result = await readToolResult(res);
    assert.notEqual(result?.isError, true, `MCP-Tool lieferte einen Fehler: ${JSON.stringify(result)}`);
  } finally {
    await srv.stop();
  }
});

test("AUTH-P3-16: GET /api/state MIT XFF -> bewusst weiterhin 200, aber ohne Owner-Daten (403 kommt erst mit P5/internalOnly)", async () => {
  const srv = await startServer({
    env: { MULTI_TENANT: "true" },
    seed: seedState({ calls: [seedCall()] }),
  });
  try {
    const res = await fetch(`${srv.localUrl}/api/state`, {
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    // BEFUND (Plan-Abschnitt 0): GET /api/state ruft requestTenant (nicht requireTenant) -
    // AUTH-P3 entzieht dem externen Aufrufer nur den Owner-Tenant, liefert aber KEIN 403.
    // Das 403 fuer diese Route ist Aufgabe von P5 (internalOnly). Dieser Test pinnt den
    // Restzustand bewusst, damit die Luecke nicht unbemerkt verschwindet.
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.agent.owner, "", "kein Owner-Tenant fuer den externen Aufrufer");
    assert.equal(body.calls.length, 0, "keine Owner-Calls fuer den externen Aufrufer");
  } finally {
    await srv.stop();
  }
});
