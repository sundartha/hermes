import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import {
  webAuth,
  webAuthAllowPending,
  makeAccounts,
  makeSessions,
  signValue,
  SESSION_COOKIE_NAME,
} from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { requestNumberForPaidTenant } from "../src/billing/provision-trigger.js";
import { KYC_LEVEL, NEEDS_MANUAL_RECONCILE_REASON } from "../src/store/defaults.js";
import { NUMBER_DISPLAY_STATUS, numberStatusFor } from "../src/store/views.js";
import { PAYMENT_METHOD_TYPE_CARD } from "../src/billing/payment-method-eligibility.js";
import { CHECKOUT_RETURN } from "../src/portal-paths.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "gp-p3-wiederanlauf-secret-0123456789";
const SUB = "sub-gp-p3";
const TENANT = `t_${SUB}`;
const CUSTOMER = "cus_gp_p3";
const SESSION = "cs_gp_p3";
const NEW_PAYMENT_METHOD = "pm_neu";
const PERIOD_END = 1893456000;
const HIGH_CAP = 999;
const DEFAULT_MAX_ATTEMPTS = 3;
const HTTP_FOUND = 302;

const CONFIG = {
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "price_starter",
  stripeBusinessPriceId: "price_business",
  stripeCustomerRetryDelayMs: 0,
};

function fakeBilling(paymentMethodType) {
  return {
    createCustomer: async () => ({ customerId: CUSTOMER }),
    createSetupCheckoutSession: async () => ({ url: "https://stripe.test/c/cs", sessionId: SESSION }),
    getCheckoutSessionResult: async () => ({
      customerId: CUSTOMER,
      paymentMethodId: NEW_PAYMENT_METHOD,
      paymentMethodType,
    }),
  };
}

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

function provisionSeam(store, spy, { throws = false } = {}) {
  return async (tenantId) => {
    spy.push(tenantId);
    if (throws) throw new Error("Provisioning-Naht bewusst kaputt (fail-soft-Probe)");
    const ergebnis = requestNumberForPaidTenant(store.load(), {
      tenantId,
      fallbackCountry: "DE",
      maxNumbers: HIGH_CAP,
      maxNumbersPerTenant: HIGH_CAP,
    });
    store.save();
    return ergebnis.ok ? { ok: true, reason: "queued" } : ergebnis;
  };
}

function seedFailedNumbers(state, failedCount) {
  for (let lauf = 0; lauf < failedCount; lauf += 1) {
    const { number } = ops.requestNumber(state, {
      tenantId: TENANT,
      maxNumbers: HIGH_CAP,
      maxNumbersPerTenant: HIGH_CAP,
    });
    ops.failNumber(state, number.id);
  }
}

async function setup({
  failedCount = 0,
  subscriber = true,
  paymentMethodType = PAYMENT_METHOD_TYPE_CARD,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  provisionThrows = false,
} = {}) {
  const { store: pgStore, runner } = await makePgTestStore();
  const store = { ...pgStore, withStoreLock: (fn) => Promise.resolve().then(fn) };
  seedTenant(store, { failedCount, subscriber });

  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "gp3@kunde.de" });
  const { id: sessionId } = await sessions.create({ sub: SUB, tenantId: TENANT, ttlSeconds: 3600 });

  const provisionSpy = [];
  const auditCalls = [];
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw: webAuth({ secret: SECRET, sessions, accounts }),
      webAuthPendingMw: webAuthAllowPending({ secret: SECRET, sessions, accounts }),
      audit: (event, _req, detail) => auditCalls.push({ event, detail }),
      config: withConfigNamespaces({ ...CONFIG, provisioningRetryMaxAttempts: maxAttempts }),
      billing: fakeBilling(paymentMethodType),
      accounts,
      provision: provisionSeam(store, provisionSpy, { throws: provisionThrows }),
    }),
  );
  const server = await new Promise((bereit) => {
    const gestartet = app.listen(0, "127.0.0.1", () => bereit(gestartet));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    provisionSpy,
    auditCalls,
    cookie: cookieFor(sessionId),
    close: () => new Promise((zu) => server.close(zu)),
  };
}

function seedTenant(store, { failedCount, subscriber }) {
  const state = store.load();
  ops.registerTenant(state, TENANT, { firstName: "Kunde", lastName: "GP3", idpSubject: SUB });
  ops.setTenantStripe(state, TENANT, { customerId: CUSTOMER });
  if (subscriber) {
    ops.setKycLevel(state, TENANT, KYC_LEVEL.CARD);
    ops.setTenantSubscription(state, TENANT, {
      subscriptionId: "sub_gp_p3",
      planSlug: "starter",
      currentPeriodEnd: PERIOD_END,
    });
  }
  seedFailedNumbers(state, failedCount);
  store.save();
}

function request(method, url, { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const ziel = new URL(url);
    const headers = cookie ? { Cookie: cookie } : {};
    const req = http.request(
      {
        hostname: ziel.hostname,
        port: ziel.port,
        path: ziel.pathname + ziel.search,
        method,
        headers,
      },
      (res) => {
        let rumpf = "";
        res.on("data", (stueck) => (rumpf += stueck));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: rumpf, location: res.headers.location }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const cardReturn = (lauf) =>
  request("GET", `${lauf.base}/api/self-service/billing/return?session_id=${SESSION}`, {
    cookie: lauf.cookie,
  });

function skipReasonOf(lauf) {
  const state = lauf.store.load();
  const tenant = state.tenants.find((eintrag) => eintrag.id === TENANT);
  return tenant.numberProvisionSkipReason;
}

test("(1) failed + aktiver Subscriber + Karte + Deckel offen -> Provisioning laeuft wieder an", async () => {
  const lauf = await setup({ failedCount: 1 });
  try {
    const res = await cardReturn(lauf);
    assert.equal(res.status, HTTP_FOUND);
    assert.equal(res.location, CHECKOUT_RETURN.CARD_OK);
    assert.deepEqual(lauf.provisionSpy, [TENANT]);
    const gespeichert = lauf.auditCalls.find((eintrag) => eintrag.event === "self_service_card_saved");
    assert.equal(gespeichert.detail.includes("wiederanlauf=retry"), true, gespeichert.detail);
    assert.notEqual(numberStatusFor(lauf.store.load(), TENANT), NUMBER_DISPLAY_STATUS.FAILED);
    assert.equal(
      [NUMBER_DISPLAY_STATUS.REQUESTED, NUMBER_DISPLAY_STATUS.PROVISIONING].includes(
        numberStatusFor(lauf.store.load(), TENANT),
      ),
      true,
    );
  } finally {
    await lauf.close();
  }
});

test("(2) Deckel erschoepft -> KEIN Anstoss, Tenant traegt needs_manual_reconcile", async () => {
  const lauf = await setup({ failedCount: DEFAULT_MAX_ATTEMPTS });
  try {
    const res = await cardReturn(lauf);
    assert.equal(res.status, HTTP_FOUND);
    assert.equal(res.location, CHECKOUT_RETURN.CARD_OK);
    assert.deepEqual(lauf.provisionSpy, []);
    assert.equal(skipReasonOf(lauf), NEEDS_MANUAL_RECONCILE_REASON);
  } finally {
    await lauf.close();
  }
});

test("(3) kein verifiziertes Abo -> KEIN Anstoss, KEIN Marker (Geld-Gate)", async () => {
  const lauf = await setup({ failedCount: 1, subscriber: false });
  try {
    const res = await cardReturn(lauf);
    assert.equal(res.status, HTTP_FOUND);
    assert.deepEqual(lauf.provisionSpy, []);
    assert.notEqual(skipReasonOf(lauf), NEEDS_MANUAL_RECONCILE_REASON);
  } finally {
    await lauf.close();
  }
});

test("(4) Positiv-Kontrolle: erste Kartenbindung ohne Nummer -> Bestandsverhalten unveraendert", async () => {
  const lauf = await setup({ failedCount: 0 });
  try {
    const res = await cardReturn(lauf);
    assert.equal(res.status, HTTP_FOUND);
    assert.equal(res.location, CHECKOUT_RETURN.CARD_OK);
    assert.deepEqual(lauf.provisionSpy, []);
    assert.notEqual(skipReasonOf(lauf), NEEDS_MANUAL_RECONCILE_REASON);
    assert.equal(lauf.store.tenantStripe(TENANT).paymentMethodId, NEW_PAYMENT_METHOD);
  } finally {
    await lauf.close();
  }
});

test("(5) hold-unfaehige Methode -> KEIN Anstoss, KEIN verbrannter Versuch, Typ trotzdem persistiert", async () => {
  const lauf = await setup({ failedCount: 1, paymentMethodType: "link" });
  try {
    const res = await cardReturn(lauf);
    assert.equal(res.status, HTTP_FOUND);
    assert.deepEqual(lauf.provisionSpy, []);
    assert.notEqual(skipReasonOf(lauf), NEEDS_MANUAL_RECONCILE_REASON);
    assert.equal(lauf.store.tenantStripe(TENANT).paymentMethodType, "link");
  } finally {
    await lauf.close();
  }
});

test("(6) fail-soft: ein werfender Anstoss kippt die Kartenbindung NICHT", async () => {
  const lauf = await setup({ failedCount: 1, provisionThrows: true });
  try {
    const res = await cardReturn(lauf);
    assert.equal(res.status, HTTP_FOUND);
    assert.equal(res.location, CHECKOUT_RETURN.CARD_OK);
    assert.equal(lauf.store.tenantStripe(TENANT).paymentMethodId, NEW_PAYMENT_METHOD);
  } finally {
    await lauf.close();
  }
});

test("(7) maxAttempts=0 ist der Rollback-Hebel: kein Anstoss UND kein Marker", async () => {
  const lauf = await setup({ failedCount: 1, maxAttempts: 0 });
  try {
    const res = await cardReturn(lauf);
    assert.equal(res.status, HTTP_FOUND);
    assert.deepEqual(lauf.provisionSpy, []);
    assert.notEqual(skipReasonOf(lauf), NEEDS_MANUAL_RECONCILE_REASON);
  } finally {
    await lauf.close();
  }
});

test("(8) markTenantNeedsManualReconcile ist idempotent (zweiter Aufruf changed=false)", () => {
  const state = ops.makeDefaultState();
  ops.registerTenant(state, TENANT, { firstName: "K", lastName: "I", idpSubject: SUB });
  assert.equal(ops.markTenantNeedsManualReconcile(state, TENANT).changed, true);
  assert.equal(ops.markTenantNeedsManualReconcile(state, TENANT).changed, false);
  assert.equal(ops.markTenantNeedsManualReconcile(state, "t_unbekannt").changed, false);
});
