// F2 P5 - Self-Service Write der privaten Summary-Nummer (POST /api/self-service/
// private-number). Kompositions-Integrationstest nach dem Muster i9-self-service.test.js:
// reines pglite (offline, F.I.R.S.T.), KEIN Server-Spawn. Prueft die SICHERHEITS-
// Invarianten der dedizierten Schreibtuer:
//   - gueltig -> normalisierte E.164 am Tenant-RECORD (NICHT in settings, H4)
//   - ungueltig / gesperrtes Land -> 400, alter Wert bleibt (fail-closed, H2)
//   - leer/"" -> Feld geloescht (impliziter Opt-Out)
//   - Trennzeichen-Eingabe -> normalisiert gespeichert (M3)
//   - kein Cookie -> 401, suspendiert -> 403 (kein Write)
//   - Audit + Response tragen NIE die Nummer (nur Outcome-Key, H4)
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "self-service-web-secret-0123456789";
const SUB_B = "sub-b";
const TENANT_B = "t_sub-b";
const SUB_SUSPENDED = "sub-susp";
const TENANT_SUSPENDED = "t_sub-susp";

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

// Sammelt die Audit-Aufrufe (action, details), damit der Test beweisen kann, dass die
// Nummer NIE ins Audit gehoben wird (H4) - nur der Outcome-Key.
function makeAuditSpy() {
  const calls = [];
  const fn = (action, _req, details = "") => calls.push({ action, details });
  fn.calls = calls;
  return fn;
}

async function seedActiveTenant(store, accounts, { sub, tenantId }) {
  const s = store.load();
  ops.registerTenant(s, tenantId, { firstName: "Kunde", lastName: "B" });
  const t = s.tenants.find((x) => x.id === tenantId);
  t.status = "active";
  t.idpSubject = sub;
  await accounts.upsertOnFirstLogin({ sub, email: `${sub}@kunde.de` });
  await accounts.setStatus(tenantId, "active");
}

async function setup() {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  await seedActiveTenant(store, accounts, { sub: SUB_B, tenantId: TENANT_B });
  const { id: sessionId } = await sessions.create({
    sub: SUB_B,
    tenantId: TENANT_B,
    ttlSeconds: 3600,
  });

  await accounts.upsertOnFirstLogin({ sub: SUB_SUSPENDED, email: "susp@kunde.de" });
  const { id: suspSessionId } = await sessions.create({
    sub: SUB_SUSPENDED,
    tenantId: TENANT_SUSPENDED,
    ttlSeconds: 3600,
  });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: SECRET, sessions, accounts });
  const audit = makeAuditSpy();
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw,
      audit,
      config: withConfigNamespaces({ paymentEnabled: false }),
      billing: {},
      provision: async () => {},
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    audit,
    cookieB: cookieFor(sessionId),
    cookieSuspended: cookieFor(suspSessionId),
    recordOf: (tenantId) => store.load().tenants.find((x) => x.id === tenantId),
    close: () => new Promise((r) => server.close(r)),
  };
}

function request(method, url, { cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const setNumber = (s, body, cookie = s.cookieB) =>
  request("POST", `${s.base}/api/self-service/private-number`, { cookie, body });

test("(a) gueltige Nummer -> 200, normalisierte E.164 am Record, NICHT in settings (H4)", async () => {
  const s = await setup();
  try {
    const res = await setNumber(s, { privateNumber: "+49 (170) 123-4567" });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, hasPrivateNumber: true });
    assert.equal(
      s.recordOf(TENANT_B).privateNumber,
      "+491701234567",
      "normalisiert am Record (M3)",
    );
    // PII darf NICHT in settings landen (settings leakt ueber /api/state + MCP).
    const settings = s.store.load().settings[TENANT_B] || {};
    assert.equal("privateNumber" in settings, false, "privateNumber NIE in settings");
  } finally {
    await s.close();
  }
});

test("(b) ungueltiges Format -> 400, alter Wert bleibt (fail-closed, H2)", async () => {
  const s = await setup();
  try {
    await setNumber(s, { privateNumber: "+491701234567" }); // erst gueltig setzen
    const res = await setNumber(s, { privateNumber: "abc" });
    assert.equal(res.status, 400);
    assert.equal(s.recordOf(TENANT_B).privateNumber, "+491701234567", "alter Wert unveraendert");
  } finally {
    await s.close();
  }
});

test("(c) gesperrter Laendercode (+1) -> 400 (Toll-Fraud-Gate, H1)", async () => {
  const s = await setup();
  try {
    const res = await setNumber(s, { privateNumber: "+12025550123" });
    assert.equal(res.status, 400);
    assert.equal(
      s.recordOf(TENANT_B).privateNumber ?? null,
      null,
      "kein gesperrtes Land gespeichert",
    );
  } finally {
    await s.close();
  }
});

test("(d) leer '' -> loescht das Feld (impliziter Opt-Out)", async () => {
  const s = await setup();
  try {
    await setNumber(s, { privateNumber: "+491701234567" });
    const res = await setNumber(s, { privateNumber: "" });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, hasPrivateNumber: false });
    assert.equal("privateNumber" in s.recordOf(TENANT_B), false, "Feld entfernt");
  } finally {
    await s.close();
  }
});

test("(e) fehlender Body / null -> 200, kein Feld (kein Muell at rest)", async () => {
  const s = await setup();
  try {
    const res = await setNumber(s, {});
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).hasPrivateNumber, false);
    assert.equal("privateNumber" in s.recordOf(TENANT_B), false);
  } finally {
    await s.close();
  }
});

test("(f) kein Session-Cookie -> 401, kein Write", async () => {
  const s = await setup();
  try {
    const res = await request("POST", `${s.base}/api/self-service/private-number`, {
      body: { privateNumber: "+491701234567" },
    });
    assert.equal(res.status, 401);
    assert.equal(s.recordOf(TENANT_B).privateNumber ?? null, null, "kein Write ohne Session");
  } finally {
    await s.close();
  }
});

test("(g) suspendierter Tenant -> 403, kein Write", async () => {
  const s = await setup();
  try {
    const res = await setNumber(s, { privateNumber: "+491701234567" }, s.cookieSuspended);
    assert.equal(res.status, 403);
    assert.equal(
      s.recordOf(TENANT_SUSPENDED) ?? null,
      null,
      "suspendierter Tenant nicht im Mirror -> kein Write",
    );
  } finally {
    await s.close();
  }
});

test("(h) Audit traegt NIE die Nummer - nur den Outcome-Key (H4)", async () => {
  const s = await setup();
  try {
    await setNumber(s, { privateNumber: "+491701234567" });
    await setNumber(s, { privateNumber: "abc" });
    await setNumber(s, { privateNumber: "" });
    const numberRelated = s.audit.calls.filter((c) => c.action === "self_service_private_number");
    assert.deepEqual(
      numberRelated.map((c) => c.details),
      ["outcome=set", "outcome=rejected", "outcome=cleared"],
    );
    for (const c of s.audit.calls)
      assert.equal(
        c.details.includes("491701234567") || c.details.includes("4567"),
        false,
        "keine Ziffern der Nummer im Audit",
      );
  } finally {
    await s.close();
  }
});
