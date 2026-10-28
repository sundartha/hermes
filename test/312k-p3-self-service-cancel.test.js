import { test } from "node:test";
import assert from "node:assert/strict";
import {
  request,
  express,
  makePgTestStore,
  SESSION_COOKIE_NAME,
  webAuth,
  makeAccounts,
  makeSessions,
  signValue,
  makeSelfServiceRoutes,
  withConfigNamespaces,
} from "./gemeinsam/kuendigung-importkopf.js";
import { makeAuditStore } from "../src/audit-store.js";
import * as ops from "../src/store/state-ops.js";

const SECRET = "312k-p3-web-secret-0123456789";
const SUB_C = "sub-c";
const TENANT_C = "t_sub-c";
const OLD_PERIOD_END = 1893456000;
const NEW_PERIOD_END = 1896134400;
const SUBSCRIPTION_ID = "sub_c1";
const CONFIG = { paymentEnabled: true };

function stripeLikeBillingIgnoringRepeatedKeys(gate) {
  const calls = { schedule: [], unschedule: [] };
  const seenKeys = new Set();
  let cancelAtPeriodEndAtStripe = false;
  const answer = async (direction, params, cancelAtPeriodEnd) => {
    calls[direction].push(params);
    await gate;
    if (!seenKeys.has(params.idempotencyKey)) {
      seenKeys.add(params.idempotencyKey);
      cancelAtPeriodEndAtStripe = cancelAtPeriodEnd;
    }
    return {
      subscriptionId: params.subscriptionId,
      cancelAtPeriodEnd,
      currentPeriodEnd: NEW_PERIOD_END,
    };
  };
  return {
    billing: {
      scheduleCancellation: (params) => answer("schedule", params, true),
      unscheduleCancellation: (params) => answer("unschedule", params, false),
    },
    calls,
    lastCall: (direction) => calls[direction].at(-1),
    keysFor: (direction) => calls[direction].map((params) => params.idempotencyKey),
    cancelAtPeriodEndAtStripe: () => cancelAtPeriodEndAtStripe,
  };
}

function gateAfterAuthenticatedRequests(webAuthMw, count) {
  let passed = 0;
  let release = () => {};
  const allPassed = new Promise((resolve) => {
    release = resolve;
  });
  const countingAuth = (req, res, next) =>
    webAuthMw(req, res, (...args) => {
      next(...args);
      passed += 1;
      if (passed >= count) release();
    });
  return { allPassed, countingAuth };
}

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

async function setup({ withSubscription = true, status = "active", concurrentRequests = 0 } = {}) {
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

  const { allPassed, countingAuth } = gateAfterAuthenticatedRequests(
    webAuth({ secret: SECRET, sessions, accounts }),
    concurrentRequests,
  );
  const stripe = stripeLikeBillingIgnoringRepeatedKeys(
    concurrentRequests > 0 ? allPassed : Promise.resolve(),
  );
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw: countingAuth,
      webAuthPendingMw: countingAuth,
      audit: () => {},
      config: withConfigNamespaces(CONFIG),
      billing: stripe.billing,
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
    billingSpy: stripe.calls,
    stripe,
    cookie: cookieFor(sessionId),
    close: () => new Promise((r) => server.close(r)),
  };
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
    assert.equal(s.stripe.lastCall("schedule").subscriptionId, SUBSCRIPTION_ID);
    assert.match(
      s.stripe.lastCall("schedule").idempotencyKey,
      /^cancel_sched_/,
      "Idempotenz-Schluessel traegt die Richtung (312k-P2-Vorgabe)",
    );
    assert.notEqual(
      s.stripe.lastCall("schedule").idempotencyKey,
      `cancel_sched_${SUBSCRIPTION_ID}`,
      "Idempotenz-Schluessel je Uebergang, nicht fest je Abo und Richtung",
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
    assert.match(
      s.stripe.lastCall("unschedule").idempotencyKey,
      /^cancel_unsched_/,
      "Schluessel traegt die Richtung",
    );
    assert.notEqual(
      s.stripe.lastCall("unschedule").idempotencyKey,
      `cancel_unsched_${SUBSCRIPTION_ID}`,
      "Idempotenz-Schluessel je Uebergang, nicht fest je Abo und Richtung",
    );

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
      billing: {},
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

test("(k) Kuendigen, Fortsetzen, Kuendigen, Fortsetzen: jeder Richtungswechsel wirkt bei Stripe", async () => {
  const s = await setup();
  try {
    await cancel(s);
    await resume(s);
    const erneutGekuendigt = await cancel(s);
    assert.equal(
      JSON.parse(erneutGekuendigt.body).cancelAtPeriodEnd,
      true,
      "Antwort meldet gekuendigt",
    );
    assert.equal(
      s.store.tenantSubscription(TENANT_C).cancelAtPeriodEnd,
      true,
      "Store haelt gekuendigt",
    );
    assert.equal(
      s.stripe.cancelAtPeriodEndAtStripe(),
      true,
      "nach Kuendigen, Fortsetzen und erneutem Kuendigen muss das Abo bei Stripe gekuendigt sein",
    );

    const erneutFortgesetzt = await resume(s);
    assert.equal(
      JSON.parse(erneutFortgesetzt.body).cancelAtPeriodEnd,
      false,
      "Antwort meldet fortgesetzt",
    );
    assert.equal(
      s.store.tenantSubscription(TENANT_C).cancelAtPeriodEnd,
      false,
      "Store haelt fortgesetzt",
    );
    assert.equal(
      s.stripe.cancelAtPeriodEndAtStripe(),
      false,
      "Abo ist bei Stripe wieder fortgesetzt",
    );
  } finally {
    await s.close();
  }
});

test("[NIE1] zweimal Kuendigen ohne Fortsetzen: ein Stripe-Aufruf, ein durabler Nachweis", async () => {
  const s = await setup();
  try {
    const erste = await cancel(s);
    const zweite = await cancel(s);
    assert.deepEqual([erste.status, zweite.status], [200, 200]);
    assert.deepEqual(
      {
        stripeAufrufe: s.stripe.keysFor("schedule").length,
        nachweise: (await auditRows(s, "self_service_cancel_scheduled")).length,
      },
      { stripeAufrufe: 1, nachweise: 1 },
    );
    assert.equal(s.stripe.cancelAtPeriodEndAtStripe(), true, "das Abo ist bei Stripe gekuendigt");
  } finally {
    await s.close();
  }
});

test("[NIE2] Schluessel zum Kuendigen gleicht nie einem Schluessel zum Fortsetzen desselben Abos", async () => {
  const s = await setup();
  try {
    await cancel(s);
    await resume(s);
    await cancel(s);
    await resume(s);
    const zumKuendigen = s.stripe.keysFor("schedule");
    const zumFortsetzen = new Set(s.stripe.keysFor("unschedule"));
    assert.equal(zumKuendigen.length, 2, "beide Kuendigungen erreichen Stripe");
    assert.equal(s.stripe.keysFor("unschedule").length, 2, "beide Ruecknahmen erreichen Stripe");
    assert.deepEqual(
      zumKuendigen.filter((key) => zumFortsetzen.has(key)),
      [],
      "kein Schluessel wird fuer beide Richtungen benutzt",
    );
  } finally {
    await s.close();
  }
});

test("[NIE3] zwei gleichzeitige Kuendigungen: ein Stripe-Aufruf, ein durabler Nachweis", async () => {
  const s = await setup({ concurrentRequests: 2 });
  try {
    const antworten = await Promise.all([cancel(s), cancel(s)]);
    assert.deepEqual(
      antworten.map((antwort) => antwort.status),
      [200, 200],
    );
    const nachweise = await auditRows(s, "self_service_cancel_scheduled");
    assert.equal(s.stripe.keysFor("schedule").length, 1, "genau ein Stripe-Aufruf zum Kuendigen");
    assert.equal(nachweise.length, 1, "genau ein durabler Nachweis");
  } finally {
    await s.close();
  }
});
