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
// Der Resolver liest `config.multiTenant` aus dem importierten config-Singleton; wir
// mutieren ihn direkt und stellen ihn wieder her (etabliertes Repo-Muster, vgl.
// config-payment-guard.test.js). Laeuft offline, ohne .env (dotenv no-op ohne Datei).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  isLocalSocket,
  isTrustedLocalCaller,
  internalIdentity,
  makeRequestTenant,
  TENANT_REJECT,
} from "../src/request-tenant.js";

// --- Test-Helfer ---------------------------------------------------------------

// config.multiTenant fuer die Dauer von fn() setzen und danach exakt restaurieren
// (Test-Isolation; kein Spawn, keine Env). Spiegelt withConfig aus config-payment-guard.
function withMultiTenant(value, fn) {
  const saved = config.multiTenant;
  config.multiTenant = value;
  try {
    return fn();
  } finally {
    config.multiTenant = saved;
  }
}

// Mock-store: nur resolveTenant, das der Resolver per Factory injiziert bekommt.
// `map` bildet sub/internal-Identitaet -> tenantId ab; unbekannt -> null (Reject-Pfad).
// `calls` protokolliert jede Aufloesung (Argument), damit Tests beweisen koennen, dass
// der req.tenant-/Flag-aus-Pfad KEINEN zweiten Lookup ausloest (R7 / Flag-Kurzschluss).
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

test("requestTenant: Flag AUS -> explizite Bootstrap-Bindung (kein REJECT, kein Lookup)", () => {
  const store = makeStore({ "sub-b": "B" });
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(false, () => {
    // Selbst mit gesetztem auth/tenant kurzschliesst der Flag-Check zuerst (R5).
    assert.equal(requestTenant(reqWith({ auth: { sub: "sub-b" } })), BOOTSTRAP_TENANT_ID);
    assert.equal(requestTenant(reqWith({ tenant: { tenantId: "B" } })), BOOTSTRAP_TENANT_ID);
  });
  assert.deepEqual(store.calls, [], "Flag-aus-Pfad darf store.resolveTenant nie aufrufen");
});

test("requestTenant: Flag AN + bekannter sub -> abgeleiteter Tenant", () => {
  const store = makeStore({ "sub-b": "B" });
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    assert.equal(requestTenant(reqWith({ auth: { sub: "sub-b" } })), "B");
  });
  assert.deepEqual(store.calls, ["sub-b"], "resolveTenant wird mit dem sub-Claim aufgeloest");
});

test("requestTenant: Flag AN + sub vorhanden, resolveTenant=null -> TENANT_REJECT (NIE Owner)", () => {
  const store = makeStore({ "sub-b": "B" });
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    const out = requestTenant(reqWith({ auth: { sub: "sub-unbekannt" } }));
    assert.equal(out, TENANT_REJECT);
    assert.notEqual(out, BOOTSTRAP_TENANT_ID);
  });
});

test("requestTenant: Flag AN + auth ohne sub -> Bootstrap-Bindung (fehlende Identitaet)", () => {
  // Verifiziertes Token ohne sub-Claim: req.auth truthy, sub null -> internal wird
  // NICHT konsultiert (req.auth ? null) -> !sub && !internal -> explizite Bootstrap-
  // Bindung (singleTenantBootstrap, V4-Kontrakt). NICHT REJECT - der Single-Operator-
  // Kanal ohne Identitaet ist der vertraute Owner-Pfad.
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    assert.equal(
      requestTenant(reqWith({ auth: {}, remoteAddress: "203.0.113.7" })),
      BOOTSTRAP_TENANT_ID,
    );
  });
  assert.deepEqual(store.calls, [], "kein Lookup ohne Identitaet");
});

test("requestTenant: Flag AN + kein auth/tenant/internal -> Bootstrap-Bindung (localhost/stdio)", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    // localhost-Socket OHNE X-Internal-Identity -> internal null -> Bootstrap-Bindung.
    const req = reqWith({ remoteAddress: "127.0.0.1", headers: {} });
    assert.equal(requestTenant(req), BOOTSTRAP_TENANT_ID);
  });
  assert.deepEqual(store.calls, []);
});

test("requestTenant: Flag AN + localhost internalIdentity, bekannt -> Tenant", () => {
  const store = makeStore({ "alice@team.test": "B" });
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    const req = reqWith({
      remoteAddress: "127.0.0.1",
      headers: { "x-internal-identity": "alice@team.test" },
    });
    assert.equal(requestTenant(req), "B");
  });
  assert.deepEqual(
    store.calls,
    ["alice@team.test"],
    "resolveTenant wird mit der internal-Identitaet aufgeloest",
  );
});

test("requestTenant: Flag AN + localhost internalIdentity, unbekannt -> TENANT_REJECT", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    const req = reqWith({
      remoteAddress: "127.0.0.1",
      headers: { "x-internal-identity": "fremd@x.test" },
    });
    assert.equal(requestTenant(req), TENANT_REJECT);
  });
});

test("requestTenant: req.auth hat Vorrang vor localhost-internalIdentity-Header", () => {
  // req.auth gesetzt -> internal = (req.auth ? null : ...) -> Header wird ignoriert,
  // aufgeloest wird der sub, nicht die internal-Identitaet.
  const store = makeStore({ "sub-b": "B", "evil@attacker.test": "X" });
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    const req = reqWith({
      remoteAddress: "127.0.0.1",
      headers: { "x-internal-identity": "evil@attacker.test" },
      auth: { sub: "sub-b" },
    });
    assert.equal(requestTenant(req), "B");
  });
  assert.deepEqual(store.calls, ["sub-b"], "nur der sub-Claim wird aufgeloest, nicht der Header");
});

test("requestTenant: Web-Session (req.tenant) gueltig -> direkter Tenant, kein zweiter Lookup", () => {
  const store = makeStore({ "sub-c": "C" });
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    assert.equal(requestTenant(reqWith({ tenant: { tenantId: "B" } })), "B");
  });
  assert.deepEqual(
    store.calls,
    [],
    "req.tenant.tenantId wird direkt zurueckgegeben (R7: kein resolveTenant)",
  );
});

test("requestTenant: Web-Session mit leerer tenantId -> TENANT_REJECT (fail-closed, ||)", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    assert.equal(requestTenant(reqWith({ tenant: { tenantId: "" } })), TENANT_REJECT);
  });
});

test("requestTenant: Web-Session ohne tenantId-Feld -> TENANT_REJECT (fail-closed)", () => {
  const store = makeStore();
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    assert.equal(requestTenant(reqWith({ tenant: {} })), TENANT_REJECT);
  });
});

test("requestTenant: req.tenant hat Vorrang vor req.auth (staerkere Session-Identitaet)", () => {
  const store = makeStore({ "sub-c": "C" });
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    const req = reqWith({ tenant: { tenantId: "B" }, auth: { sub: "sub-c" } });
    assert.equal(requestTenant(req), "B", "req.tenant gewinnt gegen req.auth");
  });
  assert.deepEqual(store.calls, [], "der req.auth-Pfad wird gar nicht erst betreten");
});

// === makeRequestTenant -> requireTenant (I6 fail-closed Gate) ==================

test("requireTenant: TENANT_REJECT -> 403 + Rueckgabe null", () => {
  const store = makeStore();
  const { requireTenant } = makeRequestTenant(store);
  const res = fakeRes();
  const out = withMultiTenant(true, () =>
    requireTenant(reqWith({ tenant: { tenantId: "" } }), res),
  );
  assert.equal(out, null);
  assert.equal(res.statusCode, 403);
  assert.ok(res.body && typeof res.body.error === "string", "403-Body traegt eine Fehlermeldung");
});

test("requireTenant: gueltiger Tenant -> Tenant-String, kein 403", () => {
  const store = makeStore({ "sub-b": "B" });
  const { requireTenant } = makeRequestTenant(store);
  const res = fakeRes();
  const out = withMultiTenant(true, () => requireTenant(reqWith({ auth: { sub: "sub-b" } }), res));
  assert.equal(out, "B");
  assert.equal(res.statusCode, null, "kein Status-Write auf dem Erfolgs-Pfad");
});

test("requireTenant: Flag AUS -> BOOTSTRAP_TENANT_ID, Gate inert (kein 403)", () => {
  const store = makeStore();
  const { requireTenant } = makeRequestTenant(store);
  const res = fakeRes();
  const out = withMultiTenant(false, () =>
    requireTenant(reqWith({ tenant: { tenantId: "B" } }), res),
  );
  assert.equal(out, BOOTSTRAP_TENANT_ID);
  assert.equal(res.statusCode, null);
});

// === Vertrags-Invariante =======================================================

test("P3 fail-closed: Flag AN + VORHANDENE-aber-unbekannte Identitaet -> NIE realer Tenant", () => {
  // P3-Riegel: eine vorhandene, aber unaufloesbare Identitaet (sub ODER localhost-
  // internal-Header) faellt NIE auf einen anderen realen Tenant - immer TENANT_REJECT.
  // (Die FEHLENDE Identitaet ist davon getrennt -> explizite Bootstrap-Bindung, V4.)
  const store = makeStore({ "sub-real": "REAL" });
  const { requestTenant } = makeRequestTenant(store);
  withMultiTenant(true, () => {
    for (const req of [
      reqWith({ auth: { sub: "ghost" }, remoteAddress: "203.0.113.7" }),
      reqWith({ remoteAddress: "127.0.0.1", headers: { "x-internal-identity": "ghost@x.test" } }),
    ]) {
      const out = requestTenant(req);
      assert.equal(out, TENANT_REJECT, "unbekannte Identitaet -> REJECT");
      assert.notEqual(out, "REAL", "darf NIE auf einen realen Tenant fallen");
    }
  });
});

test("Vertrags-Invariante: TENANT_REJECT ist nie gleich BOOTSTRAP_TENANT_ID", () => {
  // Locking-Test gegen ein versehentliches Zusammenfallen der beiden Marker - sonst
  // koennte eine unbekannte Identitaet still zu Owner kollabieren (Cross-Tenant-Leak).
  assert.notEqual(TENANT_REJECT, BOOTSTRAP_TENANT_ID);
});
