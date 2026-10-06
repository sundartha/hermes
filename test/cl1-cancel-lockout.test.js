import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import {
  applyStripeWebhook,
  applyStripeWebhookSerialized,
  interpretStripeEvent,
  SUBSCRIPTION_EVENT,
  SUSPEND_REASON,
  WEBHOOK_ACTION,
} from "../src/billing/webhook.js";
import { makeDefaultState, registerTenant, setTenantSubscription, tenantSubscription } from "../src/store/state-ops.js";
import { makePgTestStore } from "./pg-helpers.js";
import { SESSION_COOKIE_NAME, webAuth, webAuthAllowPending, makeAccounts, makeSessions, signValue } from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const TENANT = "t_cl1";
const HTTP_OK = 200;
const HTTP_CONFLICT = 409;

function fakeDeps({ storedSubscriptionId = null } = {}) {
  const calls = {
    setStatus: [],
    invalidate: [],
    subscription: [],
    suspend: [],
    audit: [],
  };
  return {
    calls,
    store: {
      findTenantBySubscription: () => null,
      tenantExists: () => true,
      setTenantSubscription: (tenant, patch) => calls.subscription.push([tenant, patch]),
      tenantSubscription: () => ({ planSlug: null, subscriptionId: storedSubscriptionId }),
      setSuspendedAtIfAbsent: (tenant) => calls.suspend.push(tenant),
      clearBillingHold: () => {},
    },
    accounts: { setStatus: async (tenant, status) => calls.setStatus.push([tenant, status]) },
    sessions: { invalidateByTenant: async (tenant) => calls.invalidate.push(tenant) },
    audit: (name, _req, detail) => calls.audit.push([name, detail]),
    req: {},
  };
}

function deletedEvent({ id, created, subId = "sub_cl1", tenant = TENANT } = {}) {
  return {
    id,
    created,
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: subId, metadata: { tenant_ref: tenant } } },
  };
}

function paymentFailedEvent({ id, created, subId = "sub_cl1", tenant = TENANT } = {}) {
  return {
    id,
    created,
    type: SUBSCRIPTION_EVENT.PAYMENT_FAILED,
    data: { object: { subscription: subId, metadata: { tenant_ref: tenant } } },
  };
}

test("interpretStripeEvent: customer.subscription.deleted -> suspendReason=SUBSCRIPTION_DELETED", () => {
  const out = interpretStripeEvent(deletedEvent({ id: "evt_i1", created: 1 }));
  assert.equal(out.action, WEBHOOK_ACTION.SUSPEND);
  assert.equal(out.suspendReason, SUSPEND_REASON.SUBSCRIPTION_DELETED);
});

test("interpretStripeEvent: invoice.payment_failed -> suspendReason=PAYMENT_FAILED", () => {
  const out = interpretStripeEvent(paymentFailedEvent({ id: "evt_i2", created: 1 }));
  assert.equal(out.action, WEBHOOK_ACTION.SUSPEND);
  assert.equal(out.suspendReason, SUSPEND_REASON.PAYMENT_FAILED);
});

test("Spec-Test 1: applyStripeWebhook(deleted) mit gespeichertem Abo -> setStatus(suspended) UND genau ein setTenantSubscription({subscriptionId:null})", async () => {
  const deps = fakeDeps({ storedSubscriptionId: "sub_old" });
  await applyStripeWebhook(deletedEvent({ id: "evt_1", created: 1 }), deps);
  assert.deepEqual(deps.calls.setStatus, [[TENANT, "suspended"]]);
  assert.deepEqual(deps.calls.subscription, [[TENANT, { subscriptionId: null }]], "NUR die Referenz entwertet - kein planSlug/cancelAtPeriodEnd im Patch");
});

test("Spec-Test 2: applyStripeWebhook(payment_failed) mit gespeichertem Abo -> setStatus(suspended), KEINE Abo-Schreibung", async () => {
  const deps = fakeDeps({ storedSubscriptionId: "sub_old" });
  await applyStripeWebhook(paymentFailedEvent({ id: "evt_2", created: 1 }), deps);
  assert.deepEqual(deps.calls.setStatus, [[TENANT, "suspended"]]);
  assert.deepEqual(deps.calls.subscription, [], "Abo lebt im Dunning weiter - Referenz bleibt (Doppelabbuchungs-Schutz)");
});

test("Store-Roundtrip: setTenantSubscription(state, tenantId, {subscriptionId:null}) -> tenantSubscription liefert null, planSlug bleibt", () => {
  const state = makeDefaultState();
  registerTenant(state, "t_cl1_store", {});
  setTenantSubscription(state, "t_cl1_store", { subscriptionId: "sub_x", planSlug: "starter" });
  assert.equal(tenantSubscription(state, "t_cl1_store").subscriptionId, "sub_x");
  setTenantSubscription(state, "t_cl1_store", { subscriptionId: null });
  assert.equal(tenantSubscription(state, "t_cl1_store").subscriptionId, null, "der Setter TRAEGT null (Vorentscheidung Plan)");
  assert.equal(tenantSubscription(state, "t_cl1_store").planSlug, "starter", "planSlug bleibt stehen (Owner-Entscheidung geparkt)");
});

test("Idempotenz: zweites deleted (andere event.id) nach bereits geleerter Referenz -> kein zweiter Patch", async () => {
  const subId = "sub_cl1_idem";
  const deps = fakeDeps({ storedSubscriptionId: null });
  await applyStripeWebhookSerialized(deletedEvent({ id: "evt_idem_1", created: 1_800_000_000, subId }), deps);
  await applyStripeWebhookSerialized(deletedEvent({ id: "evt_idem_2", created: 1_800_000_001, subId }), deps);
  assert.deepEqual(deps.calls.subscription, [], "clearSubscriptionReference ist bei bereits leerer Referenz ein No-Op");
});

const SECRET = "cl1-cancel-lockout-secret-0123456789";
const CUSTOMER = "cus_cl1";
const CONFIG = {
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "price_starter",
  stripeBusinessPriceId: "price_business",
};

async function setupRoute({ tenantId, priorSubscriptionId = "sub_prior" }) {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (sql, params) => db.query(sql, params), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  const sub = tenantId.replace(/^t_/, "");
  const state = store.load();
  const { registerTenant: reg, setTenantStripe, setTenantSubscription: setSub } = await import("../src/store/state-ops.js");
  reg(state, tenantId, { firstName: "Kunde", lastName: "CL1", idpSubject: sub });
  setTenantStripe(state, tenantId, { customerId: CUSTOMER, paymentMethodId: "pm_cl1" });
  setSub(state, tenantId, { subscriptionId: priorSubscriptionId, planSlug: "starter", currentPeriodEnd: 1893456000 });

  await accounts.upsertOnFirstLogin({ sub, email: `${tenantId}@kunde.de` });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: SECRET, sessions, accounts });
  const billing = {
    createSetupCheckoutSession: async () => ({ url: "https://stripe.test/c/cs", sessionId: "cs_x" }),
    createSubscriptionCheckoutSession: async () => ({ url: "https://stripe.test/c/cs", sessionId: "cs_x" }),
  };
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw,
      audit: () => {},
      config: withConfigNamespaces(CONFIG),
      billing,
      accounts,
      provision: async () => ({ ok: true, reason: "queued" }),
    }),
  );
  const server = await new Promise((resolve) => {
    const sv = app.listen(0, "127.0.0.1", () => resolve(sv));
  });
  async function loginAs() {
    const { id: sessionId } = await sessions.create({ sub, tenantId, ttlSeconds: 3600 });
    return `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(sessionId, SECRET))}`;
  }

  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    accounts,
    sessions,
    loginAs,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function postSetupCheckout(ctx, plan, cookie) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${ctx.base}/api/self-service/billing/setup-checkout`);
    const payload = JSON.stringify({ plan });
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

test("Spec-Test 3: nach deleted (echter Store) antwortet setup-checkout NICHT mehr mit 409 (der Ausweg existiert)", async () => {
  const tenantId = "t_cl1_route_deleted";
  const ctx = await setupRoute({ tenantId });
  try {
    await applyStripeWebhook(deletedEvent({ id: "evt_route_del", created: 1, subId: "sub_prior", tenant: tenantId }), {
      store: ctx.store,
      accounts: ctx.accounts,
      sessions: ctx.sessions,
      audit: () => {},
      req: {},
    });
    const cookie = await ctx.loginAs();
    const res = await postSetupCheckout(ctx, "starter", cookie);
    assert.notEqual(res.status, HTTP_CONFLICT, "deleted hat die Referenz entwertet - kein Ausweg-los-Zustand mehr");
    assert.equal(res.status, HTTP_OK);
  } finally {
    await ctx.close();
  }
});

test("Spec-Test 4 (Gegenprobe): nach payment_failed antwortet setup-checkout weiterhin mit 409 (Doppelabbuchungs-Schutz bleibt)", async () => {
  const tenantId = "t_cl1_route_failed";
  const ctx = await setupRoute({ tenantId });
  try {
    await applyStripeWebhook(paymentFailedEvent({ id: "evt_route_fail", created: 1, subId: "sub_prior", tenant: tenantId }), {
      store: ctx.store,
      accounts: ctx.accounts,
      sessions: ctx.sessions,
      audit: () => {},
      req: {},
    });
    const cookie = await ctx.loginAs();
    const res = await postSetupCheckout(ctx, "starter", cookie);
    assert.equal(res.status, HTTP_CONFLICT);
    assert.match(res.body, /already_subscribed/);
  } finally {
    await ctx.close();
  }
});
