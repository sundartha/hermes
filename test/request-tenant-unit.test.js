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

test("isLocalSocket: lokale Socket-Adressen -> true", () => {
  for (const addr of LOCAL_ADDRS) {
    assert.equal(isLocalSocket(reqWith({ remoteAddress: addr })), true, addr);
  }
});

test("isLocalSocket: externe Adresse -> false", () => {
  assert.equal(isLocalSocket(reqWith({ remoteAddress: "203.0.113.7" })), false);
  assert.equal(isLocalSocket(reqWith({ remoteAddress: "10.0.0.5" })), false);
});

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
  const req = reqWith({
    remoteAddress: "127.0.0.1",
    headers: { "x-internal-identity": "victim@team.test", "x-forwarded-for": "203.0.113.9" },
  });
  assert.equal(internalIdentity(req), null);
});

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

const TRUSTED_HEADER_READERS = [
  ["internalIdentity", internalIdentity, "x-internal-identity"],
  ["internalTenant", internalTenant, "x-internal-tenant"],
];

for (const [label, read, header] of TRUSTED_HEADER_READERS) {
  test(`${label}: localhost + Header -> Wert, identische Trust-Gate-Semantik`, () => {
    const local = (h) => reqWith({ remoteAddress: "127.0.0.1", headers: h });
    assert.equal(read(local({ [header]: "B" })), "B");
    assert.equal(read(local({ [header]: "B", "x-forwarded-for": "1.2.3.4" })), null);
    assert.equal(read(reqWith({ remoteAddress: "203.0.113.7", headers: { [header]: "B" } })), null);
    assert.equal(read(local({ [header]: "" })), null);
    assert.equal(read(local({ [header]: ["B", "C"] })), null);
  });
}

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

test("requestTenant: gesetzte Identitaet gewinnt - Web-Session und sub loesen auf (kein Kurzschluss mehr)", () => {
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
  const store = makeStore({ "sub-b": "B" });
  const { requestTenant } = makeRequestTenant(store);
  const out = requestTenant(reqWith({ auth: { email: "evil@attacker.test" } }));
  assert.equal(out, TENANT_REJECT);
  assert.notEqual(out, BOOTSTRAP_TENANT_ID, "subloses Token darf NIE auf Owner fallen");
});

test("requestTenant: subloses Token, externer Loopback+XFF -> TENANT_REJECT", () => {
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

test("P3 fail-closed: VORHANDENE-aber-unbekannte Identitaet -> NIE realer Tenant", () => {
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
  assert.notEqual(TENANT_REJECT, BOOTSTRAP_TENANT_ID);
});
