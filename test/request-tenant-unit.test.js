// A4 Phase 2 - Deterministische Unit-Tests fuer den extrahierten Resolver
// `src/request-tenant.js` (Seam A der Strategie a4-remote-oauth-tenant-gap.md).
//
// WARUM eine EIGENE Datei (nicht `test/request-tenant.test.js`): jene Datei ist der
// V1-V4-Spawn-Regressionsgate fuer den /mcp-Audit-Pfad und MUSS laut Strategie
// (Sec. 5.2 / 6 Phase 2) byte-identisch bleiben. Die hier liegenden Tests sind reine
// Mock-Tabellentests OHNE Server-Spawn, -DB, -Netz und ergaenzen den Gate, statt ihn
// zu ueberschreiben. Sie decken insbesondere den Web-Session-Zweig (req.tenant) und
// die fail-closed-Faelle ab, die ueber echtes webAuthMiddleware nicht herstellbar sind.
//
// Seit E4 liest der Resolver KEINE Konfiguration mehr - die Mandantengrenze gilt
// unbedingt, ohne Env-Setup. Laeuft offline, ohne .env (dotenv no-op ohne Datei).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  isLocalSocket,
  isTrustedLocalCaller,
  internalIdentity,
  internalTenant,
  makeRequestTenant,
  TENANT_REJECT,
} from "../src/request-tenant.js";

// --- Test-Helfer ---------------------------------------------------------------

// Mock-store: nur resolveTenant, das der Resolver per Factory injiziert bekommt.
// `map` bildet sub/internal-Identitaet -> tenantId ab; unbekannt -> null (Reject-Pfad).
// `calls` protokolliert jede Aufloesung (Argument), damit Tests beweisen koennen, dass
// der req.tenant-Pfad KEINEN zweiten Lookup ausloest (R7).
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

// Minimaler Request-Fake mit waehlbarer Socket-Adresse + Headern.
function reqWith({ remoteAddress = "203.0.113.7", headers = {}, auth, tenant } = {}) {
  const req = { socket: { remoteAddress }, headers };
  if (auth !== undefined) req.auth = auth;
  if (tenant !== undefined) req.tenant = tenant;
  return req;
}

// Minimaler Express-res-Fake: erfasst Status + JSON-Body (vgl. error-handler.test.js).
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

// === isLocalSocket =============================================================

test("isLocalSocket: lokale Socket-Adressen -> true", () => {
  for (const addr of LOCAL_ADDRS) {
    assert.equal(isLocalSocket(reqWith({ remoteAddress: addr })), true, addr);
  }
});

test("isLocalSocket: externe Adresse -> false", () => {
  assert.equal(isLocalSocket(reqWith({ remoteAddress: "203.0.113.7" })), false);
  assert.equal(isLocalSocket(reqWith({ remoteAddress: "10.0.0.5" })), false);
});

// === internalIdentity ==========================================================

test("internalIdentity: localhost + Header-String -> Identitaet", () => {
  const req = reqWith({
    remoteAddress: "127.0.0.1",
    headers: { "x-internal-identity": "alice@team.test" },
  });
  assert.equal(internalIdentity(req), "alice@team.test");
});

test("internalIdentity: localhost ohne Header -> null", () => {
  const req = reqWith({ remoteAddress: "::1", headers: {} });
  assert.equal(internalIdentity(req), null);
});

test("internalIdentity: localhost + leerer Header -> null (leerer String ist falsy)", () => {
  const req = reqWith({ remoteAddress: "127.0.0.1", headers: { "x-internal-identity": "" } });
  assert.equal(internalIdentity(req), null);
});

test("internalIdentity: localhost + nicht-String-Header -> null (typeof-Guard)", () => {
  // Ein doppelt gesetzter Header ist in Express ein string[] -> typeof !== "string" -> null.
  const req = reqWith({
    remoteAddress: "127.0.0.1",
    headers: { "x-internal-identity": ["a", "b"] },
  });
  assert.equal(internalIdentity(req), null);
});

test("internalIdentity: extern + Header gesetzt -> null (von extern faelschbar, ignoriert)", () => {
  const req = reqWith({
    remoteAddress: "203.0.113.7",
    headers: { "x-internal-identity": "evil@attacker.test" },
  });
  assert.equal(internalIdentity(req), null);
});

test("internalIdentity: Loopback-Socket + X-Forwarded-For -> null (Render-Proxy, kein Spoofing)", () => {
  // AM1: hinter Render hat AUCH externer Traffic einen Loopback-Socket, traegt aber
  // X-Forwarded-For (vom Proxy gesetzt). Ohne den XFF-Check koennte ein Angreifer per
  // X-Internal-Identity eine fremde Tenant-Identitaet vortaeuschen. Mit isTrustedLocalCaller
  // -> ignoriert (null), nur echtes In-Process-Loopback (ohne XFF) wird vertraut.
  const req = reqWith({
    remoteAddress: "127.0.0.1",
    headers: { "x-internal-identity": "victim@team.test", "x-forwarded-for": "203.0.113.9" },
  });
  assert.equal(internalIdentity(req), null);
});

// === internalTenant (AM6) ======================================================
// Geschwister zu internalIdentity, aber fuer die Tenant-Achse (X-Internal-Tenant): das
// /mcp-Gateway reicht den bereits aufgeloesten Tenant herein. Dieselbe Vertrauensgrenze.

test("internalTenant: localhost + Header-String -> Tenant", () => {
  const req = reqWith({ remoteAddress: "127.0.0.1", headers: { "x-internal-tenant": "B" } });
  assert.equal(internalTenant(req), "B");
});

test("internalTenant: localhost ohne Header -> null", () => {
  assert.equal(internalTenant(reqWith({ remoteAddress: "::1", headers: {} })), null);
});

test("internalTenant: localhost + leerer Header -> null (leerer String ist falsy)", () => {
  const req = reqWith({ remoteAddress: "127.0.0.1", headers: { "x-internal-tenant": "" } });
  assert.equal(internalTenant(req), null);
});

test("internalTenant: localhost + nicht-String-Header -> null (typeof-Guard)", () => {
  const req = reqWith({ remoteAddress: "127.0.0.1", headers: { "x-internal-tenant": ["B", "C"] } });
  assert.equal(internalTenant(req), null);
});

test("internalTenant: extern + Header gesetzt -> null (von extern faelschbar, ignoriert)", () => {
  const req = reqWith({ remoteAddress: "203.0.113.7", headers: { "x-internal-tenant": "B" } });
  assert.equal(internalTenant(req), null);
});

test("internalTenant: Loopback-Socket + X-Forwarded-For -> null (Render-Proxy, kein Spoofing)", () => {
  const req = reqWith({
    remoteAddress: "127.0.0.1",
    headers: { "x-internal-tenant": "B", "x-forwarded-for": "203.0.113.9" },
  });
  assert.equal(internalTenant(req), null);
});

// === Konsolidierungs-Invariante (S2-1) =========================================
// internalIdentity und internalTenant teilen sich EINE Trust-Gate-/typeof-Guard-Quelle
// (trustedLocalHeader) und duerfen sich NUR im gelesenen Header-Namen unterscheiden. Dieser
// Tabellentest riegelt die Konsolidierung ab: divergiert ein Pfad still (z.B. ein Reader
// verliert den Trust-Gate), schlaegt er hier fehl - die Sicherheits-Vertrauensgrenze bleibt
// in beiden Lesepfaden lockstep.
const TRUSTED_HEADER_READERS = [
  ["internalIdentity", internalIdentity, "x-internal-identity"],
  ["internalTenant", internalTenant, "x-internal-tenant"],
];

for (const [label, read, header] of TRUSTED_HEADER_READERS) {
  test(`${label}: localhost + Header -> Wert, identische Trust-Gate-Semantik`, () => {
    const local = (h) => reqWith({ remoteAddress: "127.0.0.1", headers: h });
    assert.equal(read(local({ [header]: "B" })), "B");
    // Trust-Gate: Loopback + X-Forwarded-For (Render-Proxy) -> ignoriert, NIE faelschbar.
    assert.equal(read(local({ [header]: "B", "x-forwarded-for": "1.2.3.4" })), null);
    // Extern -> ignoriert; leer/nicht-String -> null (typeof-Guard).
    assert.equal(read(reqWith({ remoteAddress: "203.0.113.7", headers: { [header]: "B" } })), null);
    assert.equal(read(local({ [header]: "" })), null);
    assert.equal(read(local({ [header]: ["B", "C"] })), null);
  });
}

// === isTrustedLocalCaller (AM1) ================================================
// Hinter Render erscheint externer Traffic als Loopback-Socket -> isLocalSocket allein
// taugt NICHT als Vertrauensgrenze. Vertrauenswuerdig = echtes Loopback UND nicht ueber
// den Proxy weitergereicht (kein X-Forwarded-For).

test("isTrustedLocalCaller: Loopback ohne X-Forwarded-For -> true (In-Process-Aufruf)", () => {
  for (const addr of LOCAL_ADDRS) {
    assert.equal(isTrustedLocalCaller(reqWith({ remoteAddress: addr, headers: {} })), true, addr);
  }
});

test("isTrustedLocalCaller: Loopback MIT X-Forwarded-For -> false (Render-Proxy von extern)", () => {
  for (const addr of LOCAL_ADDRS) {
    const req = reqWith({ remoteAddress: addr, headers: { "x-forwarded-for": "203.0.113.9" } });
    assert.equal(isTrustedLocalCaller(req), false, addr);
  }
});

test("isTrustedLocalCaller: externe Socket-Adresse -> false (mit und ohne XFF)", () => {
  assert.equal(isTrustedLocalCaller(reqWith({ remoteAddress: "203.0.113.7", headers: {} })), false);
  assert.equal(
    isTrustedLocalCaller(
      reqWith({ remoteAddress: "203.0.113.7", headers: { "x-forwarded-for": "203.0.113.7" } }),
    ),
    false,
  );
});

// === makeRequestTenant -> requestTenant ========================================

test("requestTenant: gesetzte Identitaet gewinnt - Web-Session und sub loesen auf (kein Kurzschluss mehr)", () => {
  // E4: der Flag-Kurzschluss ist entfernt - Web-Session UND sub loesen unbedingt auf,
  // ohne jedes Env-Setup. Der Web-Session-Pfad tut das weiterhin OHNE zweiten Lookup (R7).
  const store = makeStore({ "sub-b": "B" });
  const { requestTenant } = makeRequestTenant(store);
  const local = { remoteAddress: "127.0.0.1", headers: {} };
  assert.equal(requestTenant(reqWith({ ...local, tenant: { tenantId: "B" } })), "B");
  assert.equal(requestTenant(reqWith({ ...local, auth: { sub: "sub-b" } })), "B");
  assert.deepEqual(store.calls, ["sub-b"], "der Web-Session-Pfad loest ohne Lookup auf (R7)");
});

test("requestTenant: bekannter sub -> abgeleiteter Tenant", () => {
  const store = makeStore({ "sub-b": "B" });
  const { requestTenant } = makeRequestTenant(store);
  assert.equal(requestTenant(reqWith({ auth: { sub: "sub-b" } })), "B");
  assert.deepEqual(store.calls, ["sub-b"], "resolveTenant wird mit dem sub-Claim aufgeloest");
});

test("requestTenant: sub vorhanden, resolveTenant=null -> TENANT_REJECT (NIE Owner)", () => {
  const store = makeStore({ "sub-b": "B" });
  const { requestTenant } = makeRequestTenant(store);
  const out = requestTenant(reqWith({ auth: { sub: "sub-unbekannt" } }));
  assert.equal(out, TENANT_REJECT);
  assert.notEqual(out, BOOTSTRAP_TENANT_ID);
});

test("requestTenant: verifiziertes Token OHNE sub -> TENANT_REJECT (NIE Owner)", () => {
  // FAIL-CLOSED-REGRESSION (AM6-Blocker R2): jose erzwingt den sub-Claim nicht, ein
  // verifiziertes REMOTE-OAuth-Token kann req.auth tragen, aber req.auth.sub===undefined.
  // Das Owner-/Bootstrap-Gate haengt an der ABWESENHEIT von req.auth (!req.auth), NICHT
  // an einem falsy sub: ein vorhandenes Token ist eine vorhandene Identitaet und darf NIE
  // zum Owner kollabieren (sonst laese ein subloser Angreifer Owner-Transkripte und
  // koennte place_call als Owner ausloesen). resolveTenant(null) liefert null -> REJECT.
  const store = makeStore({ "sub-b": "B" });
  const { requestTenant } = makeRequestTenant(store);
  const out = requestTenant(reqWith({ auth: { email: "evil@attacker.test" } }));
  assert.equal(out, TENANT_REJECT);
  assert.notEqual(out, BOOTSTRAP_TENANT_ID, "subloses Token darf NIE auf Owner fallen");
});

test("requestTenant: subloses Token, externer Loopback+XFF -> TENANT_REJECT", () => {
  // Wie oben, aber explizit der Render-Proxy-Pfad (Loopback-Socket + X-Forwarded-For):
  // selbst wenn ein Angreifer X-Internal-Identity mitsendet, wird der Header verworfen
  // (isTrustedLocalCaller=false) UND das sublose Token faellt auf REJECT, nie Owner.
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  const req = reqWith({
    remoteAddress: "127.0.0.1",
    headers: { "x-forwarded-for": "203.0.113.9", "x-internal-identity": "evil@x.test" },
    auth: { email: "evil@attacker.test" },
  });
  const out = requestTenant(req);
  assert.equal(out, TENANT_REJECT);
  assert.notEqual(out, BOOTSTRAP_TENANT_ID);
});

test("requestTenant: kein auth/tenant/internal -> Bootstrap-Bindung (localhost/stdio)", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  // localhost-Socket OHNE X-Internal-Identity -> internal null -> Bootstrap-Bindung.
  const req = reqWith({ remoteAddress: "127.0.0.1", headers: {} });
  assert.equal(requestTenant(req), BOOTSTRAP_TENANT_ID);
  assert.deepEqual(store.calls, []);
});

test("requestTenant: localhost internalIdentity, bekannt -> Tenant", () => {
  const store = makeStore({ "alice@team.test": "B" });
  const { requestTenant } = makeRequestTenant(store);
  const req = reqWith({
    remoteAddress: "127.0.0.1",
    headers: { "x-internal-identity": "alice@team.test" },
  });
  assert.equal(requestTenant(req), "B");
  assert.deepEqual(
    store.calls,
    ["alice@team.test"],
    "resolveTenant wird mit der internal-Identitaet aufgeloest",
  );
});

test("requestTenant: localhost internalIdentity, unbekannt -> TENANT_REJECT", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  const req = reqWith({
    remoteAddress: "127.0.0.1",
    headers: { "x-internal-identity": "fremd@x.test" },
  });
  assert.equal(requestTenant(req), TENANT_REJECT);
});

test("requestTenant: req.auth hat Vorrang vor localhost-internalIdentity-Header", () => {
  // req.auth gesetzt -> internal = (req.auth ? null : ...) -> Header wird ignoriert,
  // aufgeloest wird der sub, nicht die internal-Identitaet.
  const store = makeStore({ "sub-b": "B", "evil@attacker.test": "X" });
  const { requestTenant } = makeRequestTenant(store);
  const req = reqWith({
    remoteAddress: "127.0.0.1",
    headers: { "x-internal-identity": "evil@attacker.test" },
    auth: { sub: "sub-b" },
  });
  assert.equal(requestTenant(req), "B");
  assert.deepEqual(store.calls, ["sub-b"], "nur der sub-Claim wird aufgeloest, nicht der Header");
});

// --- AM6: X-Internal-Tenant Kurzschluss (gateway-aufgeloester Tenant) ---

test("requestTenant: localhost x-internal-tenant -> direkter Tenant, KEIN resolveTenant", () => {
  const store = makeStore({ "sub-b": "B" });
  const { requestTenant } = makeRequestTenant(store);
  const req = reqWith({ remoteAddress: "127.0.0.1", headers: { "x-internal-tenant": "B" } });
  assert.equal(requestTenant(req), "B");
  assert.deepEqual(store.calls, [], "der durchgereichte Tenant kurzschliesst (kein zweiter Lookup)");
});

test("requestTenant: x-internal-tenant=reject -> TENANT_REJECT (fail-closed, NIE Owner)", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  const req = reqWith({
    remoteAddress: "127.0.0.1",
    headers: { "x-internal-tenant": TENANT_REJECT },
  });
  const out = requestTenant(req);
  assert.equal(out, TENANT_REJECT);
  assert.notEqual(out, BOOTSTRAP_TENANT_ID);
});

test("requestTenant: extern + x-internal-tenant -> ignoriert, kein Lookup, TENANT_REJECT", () => {
  // Externer Socket (faelschbar) -> internalTenant null -> Kurzschluss greift NICHT.
  // AUTH-P3: ohne auth/internal-Identitaet ist der externe Aufrufer NICHT der
  // Betreiber-Kanal -> operatorChannelTenant liefert TENANT_REJECT statt Bootstrap. Die
  // eigentliche, unveraendert gepinnte Aussage bleibt store.calls===[] - ein externer
  // X-Internal-Tenant loest NIE einen Lookup aus.
  const store = makeStore({ B: "B" });
  const { requestTenant } = makeRequestTenant(store);
  const req = reqWith({ remoteAddress: "203.0.113.7", headers: { "x-internal-tenant": "B" } });
  const out = requestTenant(req);
  assert.equal(out, TENANT_REJECT);
  assert.notEqual(out, BOOTSTRAP_TENANT_ID);
  assert.deepEqual(store.calls, [], "externer X-Internal-Tenant wird ignoriert (kein Lookup)");
});

test("requestTenant: Web-Session (req.tenant) gueltig -> direkter Tenant, kein zweiter Lookup", () => {
  const store = makeStore({ "sub-c": "C" });
  const { requestTenant } = makeRequestTenant(store);
  assert.equal(requestTenant(reqWith({ tenant: { tenantId: "B" } })), "B");
  assert.deepEqual(
    store.calls,
    [],
    "req.tenant.tenantId wird direkt zurueckgegeben (R7: kein resolveTenant)",
  );
});

test("requestTenant: Web-Session mit leerer tenantId -> TENANT_REJECT (fail-closed, ||)", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  assert.equal(requestTenant(reqWith({ tenant: { tenantId: "" } })), TENANT_REJECT);
});

test("requestTenant: Web-Session ohne tenantId-Feld -> TENANT_REJECT (fail-closed)", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  assert.equal(requestTenant(reqWith({ tenant: {} })), TENANT_REJECT);
});

test("requestTenant: req.tenant hat Vorrang vor req.auth (staerkere Session-Identitaet)", () => {
  const store = makeStore({ "sub-c": "C" });
  const { requestTenant } = makeRequestTenant(store);
  const req = reqWith({ tenant: { tenantId: "B" }, auth: { sub: "sub-c" } });
  assert.equal(requestTenant(req), "B", "req.tenant gewinnt gegen req.auth");
  assert.deepEqual(store.calls, [], "der req.auth-Pfad wird gar nicht erst betreten");
});

// === makeRequestTenant -> requireTenant (I6 fail-closed Gate) ==================

test("requireTenant: TENANT_REJECT -> 403 + Rueckgabe null", () => {
  const store = makeStore();
  const { requireTenant } = makeRequestTenant(store);
  const res = fakeRes();
  const out = requireTenant(reqWith({ tenant: { tenantId: "" } }), res);
  assert.equal(out, null);
  assert.equal(res.statusCode, 403);
  assert.ok(res.body && typeof res.body.error === "string", "403-Body traegt eine Fehlermeldung");
});

test("requireTenant: gueltiger Tenant -> Tenant-String, kein 403", () => {
  const store = makeStore({ "sub-b": "B" });
  const { requireTenant } = makeRequestTenant(store);
  const res = fakeRes();
  const out = requireTenant(reqWith({ auth: { sub: "sub-b" } }), res);
  assert.equal(out, "B");
  assert.equal(res.statusCode, null, "kein Status-Write auf dem Erfolgs-Pfad");
});

test("requireTenant: Web-Session-Tenant -> dessen tenantId, kein 403", () => {
  const store = makeStore();
  const { requireTenant } = makeRequestTenant(store);
  const res = fakeRes();
  const out = requireTenant(
    reqWith({ remoteAddress: "127.0.0.1", headers: {}, tenant: { tenantId: "B" } }),
    res,
  );
  assert.equal(out, "B");
  assert.equal(res.statusCode, null);
});

// === Vertrags-Invariante =======================================================

test("P3 fail-closed: VORHANDENE-aber-unbekannte Identitaet -> NIE realer Tenant", () => {
  // P3-Riegel: eine vorhandene, aber unaufloesbare Identitaet (sub ODER localhost-
  // internal-Header) faellt NIE auf einen anderen realen Tenant - immer TENANT_REJECT.
  // (Die FEHLENDE Identitaet ist davon getrennt -> explizite Bootstrap-Bindung, V4.)
  const store = makeStore({ "sub-real": "REAL" });
  const { requestTenant } = makeRequestTenant(store);
  for (const req of [
    reqWith({ auth: { sub: "ghost" }, remoteAddress: "203.0.113.7" }),
    reqWith({ remoteAddress: "127.0.0.1", headers: { "x-internal-identity": "ghost@x.test" } }),
  ]) {
    const out = requestTenant(req);
    assert.equal(out, TENANT_REJECT, "unbekannte Identitaet -> REJECT");
    assert.notEqual(out, "REAL", "darf NIE auf einen realen Tenant fallen");
  }
});

test("Vertrags-Invariante: TENANT_REJECT ist nie gleich BOOTSTRAP_TENANT_ID", () => {
  // Locking-Test gegen ein versehentliches Zusammenfallen der beiden Marker - sonst
  // koennte eine unbekannte Identitaet still zu Owner kollabieren (Cross-Tenant-Leak).
  assert.notEqual(TENANT_REJECT, BOOTSTRAP_TENANT_ID);
});
