// BK4 - Minuten-Kontingent in der Self-Service-Lese-View (web-session-only). Muster
// w4-self-service-subscribe.test.js: reines pglite (offline, F.I.R.S.T.), KEIN Server-
// Spawn. Prueft: GET /state liefert das abgeleitete quota (included/used/remaining);
// ohne Abo -> quota null; PAYMENT_ENABLED aus -> kein quota-Feld; Cross-Tenant-Isolation.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import { webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "quota-web-secret-0123456789";
const SUB = "quota-sub";
const TENANT = "t_quota-sub";
const SECONDS_PER_DAY = 86400;
// Periode endet in 7 Tagen -> der abgeleitete Start liegt ~23 Tage in der Vergangenheit,
// "jetzt" gemeldete Events fallen damit sicher ins Fenster (zeit-robust).
const PERIOD_END_SEC = Math.floor(Date.now() / 1000) + 7 * SECONDS_PER_DAY;

const cookieFor = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

async function setup({ paymentEnabled = true } = {}) {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Kunde", lastName: "Q" });
  const t = s.tenants.find((x) => x.id === TENANT);
  t.idpSubject = SUB;
  ops.setTenantStripe(s, TENANT, { customerId: "cus_q", paymentMethodId: "pm_q" });
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "q@kunde.de" });
  await accounts.setStatus(TENANT, "active");
  const { id: sessionId } = await sessions.create({ sub: SUB, tenantId: TENANT, ttlSeconds: 3600 });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: SECRET, sessions, accounts });
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw,
      audit: () => {},
      config: withConfigNamespaces({ paymentEnabled, publicUrl: "https://test.local" }),
      billing: {},
      accounts,
      provision: async () => {},
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    cookie: cookieFor(sessionId),
    close: () => new Promise((r) => server.close(r)),
  };
}

function getState(s) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${s.base}/api/self-service/state`);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "GET",
        headers: { Cookie: s.cookie },
      },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// Seedet ein Voice-Event direkt in den Ledger-Mirror (occurredAt = jetzt -> im Fenster).
function seedVoice(store, tenantId, quantity) {
  ops.recordUsageEvent(store.load(), {
    tenantId,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity,
    costCents: 0,
  });
}

test("(a) state liefert das abgeleitete quota (included/used/remaining)", async () => {
  const s = await setup();
  try {
    ops.setTenantSubscription(s.store.load(), TENANT, {
      subscriptionId: "sub_q",
      planSlug: "starter",
      currentPeriodEnd: PERIOD_END_SEC,
    });
    seedVoice(s.store, TENANT, 4);
    seedVoice(s.store, TENANT, 6);
    const { status, body } = await getState(s);
    assert.equal(status, 200);
    assert.deepEqual(body.quota, {
      includedMinutes: 30,
      usedMinutes: 10,
      remainingMinutes: 20,
      exhausted: false,
    });
  } finally {
    await s.close();
  }
});

test("(b) ohne Abo -> subscription.planSlug null UND quota null (Leerzustand)", async () => {
  const s = await setup();
  try {
    const { body } = await getState(s);
    assert.equal(body.subscription.planSlug, null);
    assert.equal(body.quota, null);
  } finally {
    await s.close();
  }
});

test("(c) PAYMENT_ENABLED aus -> kein quota-Feld (byte-identisch)", async () => {
  const s = await setup({ paymentEnabled: false });
  try {
    const { body } = await getState(s);
    assert.equal("quota" in body, false, "kein quota-Feld bei Flag aus");
  } finally {
    await s.close();
  }
});

test("(d) Cross-Tenant: fremder Voice-Verbrauch aendert das eigene quota nicht", async () => {
  const s = await setup();
  try {
    ops.setTenantSubscription(s.store.load(), TENANT, {
      subscriptionId: "sub_q",
      planSlug: "starter",
      currentPeriodEnd: PERIOD_END_SEC,
    });
    seedVoice(s.store, "t_someone-else", 50);
    const { body } = await getState(s);
    assert.deepEqual(body.quota, {
      includedMinutes: 30,
      usedMinutes: 0,
      remainingMinutes: 30,
      exhausted: false,
    });
  } finally {
    await s.close();
  }
});

test("(e) state ehrt persistierten currentPeriodStart (Anzeige-Fenster == Gate)", async () => {
  const s = await setup();
  try {
    const START_SEC = PERIOD_END_SEC - 5 * SECONDS_PER_DAY; // enger als End-minus-Monat
    ops.setTenantSubscription(s.store.load(), TENANT, {
      subscriptionId: "sub_q",
      planSlug: "starter",
      currentPeriodStart: START_SEC,
      currentPeriodEnd: PERIOD_END_SEC,
    });
    // Event 10 Tage vor Ende = VOR dem persistierten Start (5 Tage) -> faellt raus.
    const e = ops.recordUsageEvent(s.store.load(), {
      tenantId: TENANT,
      kind: USAGE_EVENT_KIND.VOICE_MINUTE,
      quantity: 8,
      costCents: 0,
    });
    e.occurredAt = new Date((PERIOD_END_SEC - 10 * SECONDS_PER_DAY) * 1000).toISOString();
    const { body } = await getState(s);
    assert.deepEqual(body.quota, {
      includedMinutes: 30,
      usedMinutes: 0,
      remainingMinutes: 30,
      exhausted: false,
    });
  } finally {
    await s.close();
  }
});

test("(f) aktives Abo ohne aufloesbaren Anker -> exhausted true, Rest 0 (== Gate)", async () => {
  const s = await setup();
  try {
    // planSlug gesetzt, aber WEDER Start NOCH End -> frisches Abo, Webhook ausstehend.
    ops.setTenantSubscription(s.store.load(), TENANT, { subscriptionId: "sub_q", planSlug: "starter" });
    const { body } = await getState(s);
    assert.equal(body.quota.exhausted, true);
    assert.equal(body.quota.remainingMinutes, 0);
  } finally {
    await s.close();
  }
});
