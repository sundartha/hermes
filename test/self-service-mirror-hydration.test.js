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
  makeWebAuthRoutes,
  SESSION_COOKIE_NAME,
} from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import { requestNumberForPaidTenant } from "../src/billing/provision-trigger.js";
import { NUMBER_STATUS, TENANT_STATUS, tenantIdForSubject } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "mirror-hydration-secret-0123456789";
const SUB = "sub-mirror";
const EMAIL = "mirror@kunde.test";
const TENANT = tenantIdForSubject(SUB);
const CUSTOMER = "cus_mirror";
const PAYMENT_METHOD = "pm_mirror";
const SESSION = "cs_mirror";
const PERIOD_END = 1893456000;
const PERIOD_START = 1890864000;
const PLAN = "starter";
const HIGH_CAP = 100;
const SESSION_TTL_S = 3600;
const RETURN_SUB_OK = "/app?sub=ok";

const CONFIG = Object.freeze({
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "price_starter",
  stripeBusinessPriceId: "price_business",
});

function fakeBilling() {
  return {
    createCustomer: async () => ({ customerId: CUSTOMER }),
    createSetupCheckoutSession: async () => ({
      url: "https://stripe.test/c/cs_mirror",
      sessionId: SESSION,
    }),
    createSubscriptionCheckoutSession: async () => ({
      url: "https://stripe.test/c/cs_mirror",
      sessionId: SESSION,
    }),
    getCheckoutSessionResult: async () => ({
      customerId: CUSTOMER,
      paymentMethodId: PAYMENT_METHOD,
    }),
    getSubscriptionCheckoutResult: async () => ({
      customerId: CUSTOMER,
      paymentMethodId: PAYMENT_METHOD,
      subscriptionId: "sub_new",
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      planSlug: PLAN,
    }),
    createSubscription: async () => ({ subscriptionId: "sub_new", currentPeriodEnd: PERIOD_END }),
  };
}

const provisionSeam = (store) => async (tenantId) => {
  await store.ensureTenant(tenantId);
  const r = requestNumberForPaidTenant(store.load(), {
    tenantId,
    fallbackCountry: "DE",
    maxNumbers: HIGH_CAP,
    maxNumbersPerTenant: HIGH_CAP,
  });
  store.save();
  return r.ok ? { ok: true, reason: "queued" } : r;
};

async function setup() {
  const { store, db, runner } = await makePgTestStore();
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: SECRET, sessions, accounts });

  const app = express();
  app.use(express.json());
  app.use(
    makeWebAuthRoutes({
      secret: SECRET,
      ttlSeconds: SESSION_TTL_S,
      accounts,
      sessions,
      audit: { record: async () => {} },
      devLoginEnabled: true,
      ensureTenant: (tid) => store.ensureTenant(tid),
    }),
  );
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw,
      audit: () => {},
      config: withConfigNamespaces({ ...CONFIG }),
      billing: fakeBilling(),
      accounts,
      provision: provisionSeam(store),
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });
  void db;
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    accounts,
    close: () => new Promise((r) => server.close(r)),
  };
}

function request(method, url, { cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
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
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: b,
            location: res.headers.location,
            cookies: res.headers["set-cookie"],
          }),
        );
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sessionCookieFrom(setCookie) {
  for (const c of setCookie || []) {
    if (c.startsWith(`${SESSION_COOKIE_NAME}=`)) return c.split(";")[0];
  }
  return null;
}

async function devLogin(s) {
  const res = await request("POST", `${s.base}/auth/dev-login`, { body: { sub: SUB, email: EMAIL } });
  const cookie = sessionCookieFrom(res.cookies);
  assert.ok(cookie, "dev-login setzt ein Session-Cookie");
  return cookie;
}

const setupCheckout = (base, cookie, plan) =>
  request("POST", `${base}/api/self-service/billing/setup-checkout`, { cookie, body: { plan } });
const billingReturn = (base, cookie, query) =>
  request("GET", `${base}/api/self-service/billing/return?${query}`, { cookie });
const mirrorTenant = (store) => store.load().tenants.find((t) => t.id === TENANT);
const requestedNumbersFor = (store, tenantId) =>
  store
    .load()
    .numbers.filter((n) => n.tenantId === tenantId && n.status === NUMBER_STATUS.REQUESTED);

test("(1) frischer Signup: setup-checkout -> 200 (kein 502), Spiegel-Tenant ist suspended", async () => {
  const s = await setup();
  try {
    const cookie = await devLogin(s);
    const res = await setupCheckout(s.base, cookie, PLAN);
    assert.equal(res.status, 200, "setup-checkout darf nicht mehr 502en (Spiegel hydratisiert)");
    const tenant = mirrorTenant(s.store);
    assert.ok(tenant, "Tenant ist jetzt im Store-Spiegel");
    assert.equal(
      tenant.status,
      TENANT_STATUS.SUSPENDED,
      "REALER DB-Status hydriert, NICHT hardcodiert active (Regel 1)",
    );
  } finally {
    await s.close();
  }
});

test("(2) ganze Kette: Rueckkehr bucht+aktiviert+provisioniert auf dem realen Signup-State", async () => {
  const s = await setup();
  try {
    const cookie = await devLogin(s);
    const chk = await setupCheckout(s.base, cookie, PLAN);
    assert.equal(chk.status, 200);

    const ret = await billingReturn(s.base, cookie, `session_id=${SESSION}&plan=${PLAN}`);
    assert.equal(ret.status, 302);
    assert.equal(ret.location, RETURN_SUB_OK);

    const tenant = mirrorTenant(s.store);
    assert.equal(tenant.stripeSubscriptionId, "sub_new", "Abo persistiert am Spiegel");
    assert.equal(tenant.stripePlanSlug, PLAN, "getragener Plan gebucht");
    assert.equal(tenant.kycLevel, "card", "KYC auf CARD gehoben");
    const acct = await s.accounts.resolve(SUB);
    assert.equal(acct.status, "active", "Tenant ueber accounts.setStatus aktiviert");
    assert.equal(
      requestedNumbersFor(s.store, TENANT).length,
      1,
      "genau eine Dry-Run-Nummer (Provisioning ueberlebte den Mirror-Status-Sync)",
    );
  } finally {
    await s.close();
  }
});

test("(3) zweiter Login dedupt; ensureTenant(unbekannt) -> false, fabriziert nichts", async () => {
  const s = await setup();
  try {
    await devLogin(s);
    const afterFirst = s.store.load().tenants.length;
    await devLogin(s);
    assert.equal(s.store.load().tenants.length, afterFirst, "kein doppelter Spiegel-Eintrag");

    const before = s.store.load().tenants.length;
    const r = await s.store.ensureTenant("t_does-not-exist");
    assert.equal(r, false, "unbekannte Id -> false");
    assert.equal(s.store.load().tenants.length, before, "kein Tenant aus dem Nichts erfunden");
  } finally {
    await s.close();
  }
});
