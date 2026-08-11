// 312k-P3 — Kuendigung/Ruecknahme aus dem Self-Service-Dashboard (§ 312k BGB).
// Kompositions-Integrationstest nach dem Muster w4-self-service-subscribe.test.js /
// admin-approval.test.js (auditStore-Nachweis): reines pglite (offline, F.I.R.S.T.),
// KEIN Server-Spawn. Deckt ab: Erfolgsfall setzt Zustand + schreibt den durablen
// Nachweis (auditStore.record, Postgres audit_log - NICHT util.audit); kein Abo -> 409
// no_subscription; zweiter Aufruf ist idempotent (kein zweiter Stripe-Call, kein
// zweiter Audit-Eintrag); Ruecknahme funktioniert (spiegelbildlich); suspendierter UND
// geschlossener Tenant kommen nicht durch webAuthMw (active-only, ANDERS als
// subscribe/setup-checkout, die webAuthPendingMw nutzen - hier gibt es fuer einen nicht
// aktiven Tenant nichts zu kuendigen).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { webAuth, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeAuditStore } from "../src/audit-store.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "312k-p3-web-secret-0123456789";
const SUB_C = "sub-c";
const TENANT_C = "t_sub-c"; // upsertOnFirstLogin: tenantId = `t_${sub}`
const OLD_PERIOD_END = 1893456000;
const NEW_PERIOD_END = 1896134400;
const SUBSCRIPTION_ID = "sub_c1";
const CONFIG = { paymentEnabled: true };

// Spies fuer BEIDE Richtungen: separate Arrays je Op (Idempotenz-Nachweis ueber die
// Aufrufanzahl), + der jeweils uebergebene idempotencyKey (Richtung-im-Key-Nachweis).
function fakeBilling(spy = { schedule: [], unschedule: [] }) {
  return {
    scheduleCancellation: async (params) => {
      spy.schedule.push(params);
      return { subscriptionId: params.subscriptionId, cancelAtPeriodEnd: true, currentPeriodEnd: NEW_PERIOD_END };
    },
    unscheduleCancellation: async (params) => {
      spy.unschedule.push(params);
      return { subscriptionId: params.subscriptionId, cancelAtPeriodEnd: false, currentPeriodEnd: NEW_PERIOD_END };
    },
  };
}

const cookieFor = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

async function setup({ withSubscription = true, status = "active" } = {}) {
  const { store, db, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  const auditStore = makeAuditStore(runner);

  const s = store.load();
  ops.registerTenant(s, TENANT_C, { firstName: "Kunde", lastName: "C" });
  const t = s.tenants.find((x) => x.id === TENANT_C);
  t.idpSubject = SUB_C;
  await accounts.upsertOnFirstLogin({ sub: SUB_C, email: "c@kunde.de" });
  await accounts.setStatus(TENANT_C, status);
  const { id: sessionId } = await sessions.create({ sub: SUB_C, tenantId: TENANT_C, ttlSeconds: 3600 });

  if (withSubscription) {
    store.setTenantSubscription(TENANT_C, {
      subscriptionId: SUBSCRIPTION_ID,
      planSlug: "starter",
      currentPeriodEnd: OLD_PERIOD_END,
    });
  }

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const billingSpy = { schedule: [], unschedule: [] };
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw: webAuthMw, // in dieser Datei ungenutzt (nur cancel/resume geprueft)
      audit: () => {},
      config: withConfigNamespaces(CONFIG),
      billing: fakeBilling(billingSpy),
      accounts,
      provision: async () => {},
      auditStore,
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    db,
    billingSpy,
    cookie: cookieFor(sessionId),
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
const cancel = (s, cookie = s.cookie) =>
  request("POST", `${s.base}/api/self-service/billing/cancel`, { cookie });
const resume = (s, cookie = s.cookie) =>
  request("POST", `${s.base}/api/self-service/billing/resume`, { cookie });

async function auditRows(s, action) {
  const { rows } = await s.db.query(
    `SELECT action, tenant_id, detail FROM audit_log WHERE tenant_id=$1 AND action=$2`,
    [TENANT_C, action],
  );
  return rows;
}

test("(a) kein Abo -> 409 no_subscription, kein Stripe-Call, kein Audit-Eintrag", async () => {
  const s = await setup({ withSubscription: false });
  try {
    const res = await cancel(s);
    assert.equal(res.status, 409);
    assert.equal(JSON.parse(res.body).error, "no_subscription");
    assert.equal(s.billingSpy.schedule.length, 0, "kein Stripe-Call ohne Abo");
    assert.deepEqual(await auditRows(s, "self_service_cancel_scheduled"), []);
  } finally {
    await s.close();
  }
});

test("(b) Erfolg: Vormerkung persistiert + durabler Nachweis (auditStore, NICHT util.audit)", async () => {
  const s = await setup();
  try {
    const res = await cancel(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.cancelAtPeriodEnd, true);
    assert.equal(body.currentPeriodEnd, NEW_PERIOD_END);

    const sub = s.store.tenantSubscription(TENANT_C);
    assert.equal(sub.cancelAtPeriodEnd, true, "Store-Zustand gesetzt (derselbe Setter wie der Webhook)");
    assert.equal(sub.currentPeriodEnd, NEW_PERIOD_END, "Termin aus der Stripe-Antwort uebernommen");

    assert.equal(s.billingSpy.schedule.length, 1);
    assert.equal(s.billingSpy.schedule[0].subscriptionId, SUBSCRIPTION_ID);
    assert.equal(
      s.billingSpy.schedule[0].idempotencyKey,
      `cancel_sched_${SUBSCRIPTION_ID}`,
      "Idempotenz-Schluessel traegt die Richtung (312k-P2-Vorgabe)",
    );

    const rows = await auditRows(s, "self_service_cancel_scheduled");
    assert.equal(rows.length, 1, "GENAU EIN durabler Nachweis fuer die Kuendigung");
    assert.equal(rows[0].tenant_id, TENANT_C);
    assert.match(rows[0].detail, new RegExp(`current_period_end=${NEW_PERIOD_END}`));
  } finally {
    await s.close();
  }
});

test("(c) Doppelklick: zweiter Aufruf ist idempotent - kein zweiter Stripe-Call, kein zweiter Nachweis, derselbe Antwortkoerper", async () => {
  const s = await setup();
  try {
    const first = await cancel(s);
    const second = await cancel(s);
    assert.equal(second.status, 200);
    assert.deepEqual(JSON.parse(second.body), JSON.parse(first.body), "derselbe Endzustand, derselbe Antwortkoerper");
    assert.equal(s.billingSpy.schedule.length, 1, "kein zweiter Stripe-Call");
    assert.equal((await auditRows(s, "self_service_cancel_scheduled")).length, 1, "kein zweiter durabler Nachweis");
  } finally {
    await s.close();
  }
});

test("(d) Ruecknahme: Zustand zurueckgesetzt + eigener durabler Nachweis, umgekehrter Idempotenz-Schluessel", async () => {
  const s = await setup();
  try {
    await cancel(s);
    const res = await resume(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.cancelAtPeriodEnd, false);

    assert.equal(s.store.tenantSubscription(TENANT_C).cancelAtPeriodEnd, false);
    assert.equal(s.billingSpy.unschedule.length, 1);
    assert.equal(s.billingSpy.unschedule[0].idempotencyKey, `cancel_unsched_${SUBSCRIPTION_ID}`);

    const rows = await auditRows(s, "self_service_cancel_resumed");
    assert.equal(rows.length, 1);
  } finally {
    await s.close();
  }
});

test("(e) Ruecknahme ohne vorherige Kuendigung -> idempotenter Erfolg, kein Stripe-Call, kein Nachweis", async () => {
  const s = await setup();
  try {
    const res = await resume(s);
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).cancelAtPeriodEnd, false);
    assert.equal(s.billingSpy.unschedule.length, 0, "nichts zurueckzunehmen -> kein Stripe-Call");
    assert.deepEqual(await auditRows(s, "self_service_cancel_resumed"), []);
  } finally {
    await s.close();
  }
});

test("(f) Ruecknahme ohne Abo -> 409 no_subscription", async () => {
  const s = await setup({ withSubscription: false });
  try {
    const res = await resume(s);
    assert.equal(res.status, 409);
    assert.equal(JSON.parse(res.body).error, "no_subscription");
  } finally {
    await s.close();
  }
});

test("(g) suspendierter Tenant kommt nicht durch webAuthMw (403) - anders als subscribe/setup-checkout", async () => {
  const s = await setup({ status: "suspended" });
  try {
    assert.equal((await cancel(s)).status, 403);
    assert.equal((await resume(s)).status, 403);
    assert.equal(s.billingSpy.schedule.length, 0);
  } finally {
    await s.close();
  }
});

test("(h) geschlossener Tenant (closed) kommt nicht durch webAuthMw (403)", async () => {
  const s = await setup({ status: "closed" });
  try {
    assert.equal((await cancel(s)).status, 403);
    assert.equal((await resume(s)).status, 403);
  } finally {
    await s.close();
  }
});

test("(i) ohne Session-Cookie -> 401, kein Abo-Zustand veraendert", async () => {
  const s = await setup();
  try {
    assert.equal((await request("POST", `${s.base}/api/self-service/billing/cancel`)).status, 401);
    assert.equal(s.store.tenantSubscription(TENANT_C).cancelAtPeriodEnd, false);
  } finally {
    await s.close();
  }
});

test("(j) PAYMENT_ENABLED aus -> 404 (Muster subscribe/setup-checkout)", async () => {
  const { store, db, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  const auditStore = makeAuditStore(runner);
  const s2 = store.load();
  ops.registerTenant(s2, TENANT_C, { firstName: "Kunde", lastName: "C" });
  s2.tenants.find((x) => x.id === TENANT_C).idpSubject = SUB_C;
  await accounts.upsertOnFirstLogin({ sub: SUB_C, email: "c@kunde.de" });
  await accounts.setStatus(TENANT_C, "active");
  const { id: sessionId } = await sessions.create({ sub: SUB_C, tenantId: TENANT_C, ttlSeconds: 3600 });
  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw: webAuthMw,
      audit: () => {},
      config: withConfigNamespaces({ paymentEnabled: false }),
      billing: fakeBilling(),
      accounts,
      provision: async () => {},
      auditStore,
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });
  try {
    const res = await request(
      "POST",
      `http://127.0.0.1:${server.address().port}/api/self-service/billing/cancel`,
      { cookie: cookieFor(sessionId) },
    );
    assert.equal(res.status, 404);
  } finally {
    await new Promise((r) => server.close(r));
    void db;
  }
});
