// Paritaets-Test fuer die T4-Phase-1-Konsolidierung des Tenant-/Identitaets-Resolvers.
//
// Der Resolver wurde von src/request-tenant.js (A4) nach src/routes/_tenant.js
// umgezogen; src/request-tenant.js ist jetzt ein reiner Re-Export. Dieser Test
// sichert die KONSOLIDIERUNG ab, getrennt in zwei Beweise:
//
//  (A) Eine Quelle: jeder Export ueber die Re-Export-Naht (request-tenant.js) ist
//      REFERENZ-identisch zum kanonischen Modul (routes/_tenant.js). Damit kann es
//      keinen zweiten, divergierenden Resolver geben (T4 R1.1 "niemals zwei Resolver").
//  (B) Verhaltens-Paritaet: requestTenant deckt alle drei sicherheits-relevanten Pfade
//      ab (fehlend->Owner, unbekannt->Reject, bekannt->tenantId) plus Flag-aus und den
//      Web-Session-Zweig - ueber BEIDE Import-Wege identisch (T4 R1.2: ein subtiler
//      Verschiebe-Fehler im fail-closed-Pfad oeffnet ein Tenant-Leck).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import * as viaReexport from "../src/request-tenant.js";
import * as canonical from "../src/routes/_tenant.js";

// --- Test-Helfer ---------------------------------------------------------------

// Mock-store: nur resolveTenant (per Factory injiziert). `map` bildet Identitaet ->
// tenantId ab; unbekannt -> null (Reject-Pfad). `calls` protokolliert jede Aufloesung,
// damit der Web-Session-Pfad als lookup-frei (R7) bewiesen werden kann.
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

// Minimal-Request: localhost-Socket ohne Auth/Tenant (= fehlende Identitaet -> Owner).
function makeReq(overrides = {}) {
  return {
    auth: null,
    tenant: null,
    socket: { remoteAddress: "127.0.0.1" },
    headers: {},
    ...overrides,
  };
}

// === (A) Eine Quelle: Referenz-Identitaet beider Import-Wege ====================

test("Re-Export exportiert exakt dieselben Symbole wie das kanonische Modul", () => {
  const reKeys = Object.keys(viaReexport).sort();
  const canonKeys = Object.keys(canonical).sort();
  assert.deepEqual(reKeys, canonKeys, "Export-Schluessel muessen identisch sein");
  // Die erwarteten Symbole sind tatsaechlich vorhanden (kein leerer Schnitt).
  for (const expected of [
    "isLocalSocket",
    "internalIdentity",
    "tenantOwnsCall",
    "makeTenantResolver",
    "createTenantResolver",
    "makeRequestTenant",
    "OWNER_ID",
    "ANON_IDENTITY",
    "TENANT_REJECT",
  ]) {
    assert.ok(canonKeys.includes(expected), `Symbol fehlt im kanonischen Modul: ${expected}`);
  }
});

test("jeder Export ist referenz-identisch (reiner Re-Export, kein zweiter Resolver)", () => {
  for (const key of Object.keys(canonical)) {
    assert.strictEqual(
      viaReexport[key],
      canonical[key],
      `Export "${key}" divergiert zwischen request-tenant.js und routes/_tenant.js`,
    );
  }
});

test("createTenantResolver ist Alias von makeTenantResolver", () => {
  assert.strictEqual(canonical.createTenantResolver, canonical.makeTenantResolver);
});

test("Konstanten tragen ihre Bestands-Werte", () => {
  assert.equal(canonical.OWNER_ID, "owner");
  assert.equal(canonical.ANON_IDENTITY, "anon");
  assert.equal(canonical.TENANT_REJECT, "reject");
});

// === (B) Verhaltens-Paritaet ueber beide Import-Wege ============================

// Beide Factory-Einstiege liefern denselben Resolver-Vertrag; der Parameter-Lauf
// deckt alle Pfade ab. makeRequestTenant (A4-Kompat) liefert nur {requestTenant,
// requireTenant}, makeTenantResolver (T4) das volle Objekt - beide muessen identisch
// aufloesen.
const RESOLVER_FACTORIES = [
  ["routes/_tenant.js::makeTenantResolver", (store) => canonical.makeTenantResolver({ store })],
  ["routes/_tenant.js::createTenantResolver", (store) => canonical.createTenantResolver({ store })],
  [
    "request-tenant.js::makeRequestTenant (Re-Export)",
    (store) => viaReexport.makeRequestTenant(store),
  ],
];

for (const [label, build] of RESOLVER_FACTORIES) {
  test(`[${label}] bekannter sub -> tenantId, unabhaengig von jeder Env`, () => {
    const store = makeStore({ "user-1": "tenant-a" });
    const { requestTenant } = build(store);
    assert.equal(requestTenant(makeReq({ auth: { sub: "user-1" } })), "tenant-a");
    assert.deepEqual(store.calls, ["user-1"], "genau ein Lookup");
  });

  test(`[${label}] fehlende Identitaet (localhost/stdio) -> Owner (Bootstrap-Bindung)`, () => {
    const store = makeStore();
    const { requestTenant } = build(store);
    assert.equal(requestTenant(makeReq()), BOOTSTRAP_TENANT_ID);
    assert.equal(store.calls.length, 0, "fehlende Identitaet darf keinen Lookup ausloesen");
  });

  test(`[${label}] vorhandene-aber-unbekannte Identitaet -> REJECT (NIE Owner)`, () => {
    const store = makeStore();
    const { requestTenant } = build(store);
    const result = requestTenant(makeReq({ auth: { sub: "ghost" } }));
    assert.equal(result, canonical.TENANT_REJECT);
    assert.notEqual(result, BOOTSTRAP_TENANT_ID, "fail-closed: unbekannt darf nie Owner werden");
  });

  test(`[${label}] Web-Session (req.tenant) gewinnt vor req.auth, ohne Lookup`, () => {
    const store = makeStore({ "user-1": "tenant-a" });
    const { requestTenant } = build(store);
    const req = makeReq({ tenant: { tenantId: "tenant-web" }, auth: { sub: "user-1" } });
    assert.equal(requestTenant(req), "tenant-web");
    assert.equal(store.calls.length, 0, "req.tenant wird direkt genutzt, kein zweiter Lookup (R7)");
  });

  test(`[${label}] Web-Session mit leerer tenantId -> REJECT (fail-closed)`, () => {
    const store = makeStore();
    const { requestTenant } = build(store);
    assert.equal(requestTenant(makeReq({ tenant: { tenantId: "" } })), canonical.TENANT_REJECT);
  });

  test(`[${label}] requireTenant: REJECT -> 403 + null, gueltig -> tenant`, () => {
    const store = makeStore({ "user-1": "tenant-a" });
    const { requireTenant } = build(store);
    // REJECT-Pfad: 403 gesendet, Rueckgabe null.
    let status;
    let body;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    };
    const rejected = requireTenant(makeReq({ auth: { sub: "ghost" } }), res);
    assert.equal(rejected, null);
    assert.equal(status, 403);
    assert.ok(body && typeof body.error === "string", "403 traegt eine error-Nachricht");

    // Gueltiger Pfad: tenant zurueck, kein res-Zugriff.
    const ok = requireTenant(makeReq({ auth: { sub: "user-1" } }), null);
    assert.equal(ok, "tenant-a");
  });
}

// tenantOwnsCall ist eine reine Ownership-Regel und ueber beide Wege identisch.
test("tenantOwnsCall vergleicht call.tenantId mit dem Request-Tenant", () => {
  assert.equal(canonical.tenantOwnsCall({ tenantId: "t1" }, "t1"), true);
  assert.equal(canonical.tenantOwnsCall({ tenantId: "t1" }, "t2"), false);
  assert.strictEqual(viaReexport.tenantOwnsCall, canonical.tenantOwnsCall);
});
