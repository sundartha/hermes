// Regressionstest fuer den Live-Bug "setTenantStripe: Tenant t_<sub> nicht gefunden":
// ein per OIDC-Web-Login frisch registrierter Tenant landet in der DB (accounts.
// upsertOnFirstLogin -> tenant-Zeile 'suspended'), aber NICHT im Boot-hydrierten Store-
// Spiegel -> jede WRITE-Store-Op auf dem Subscribe-Pfad warf fail-closed -> 502.
//
// Modell wie bk5-smoke-e2e (pglite + app.listen(0) + node:http, KEIN Server-Spawn), aber
// DELIBERATELY OHNE den ops.registerTenant-Vorseed (genau die Zeile, die den Bug in bk5
// maskiert). Der Tenant entsteht ausschliesslich ueber den ECHTEN Signup-Pfad /auth/dev-
// login -> mintSession -> upsertOnFirstLogin + ensureTenant (KEIN registerTenant).
//
// F.I.R.S.T.: offline (pglite, kein Netz, keine echten Secrets), repeatable (fixe Werte,
// kein Date.now/Zufall), self-validating (boolesche Asserts), independent (jeder Fall
// eigenes setup() + finally close()).
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
} from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import { requestNumberForPaidTenant } from "../src/billing/provision-trigger.js";
import { NUMBER_STATUS, TENANT_STATUS, tenantIdForSubject } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

// ---- Benannte Konstanten (G25, kein Magic-Value) ---------------------------------
const SECRET = "mirror-hydration-secret-0123456789"; // Session-Cookie-HMAC
const SUB = "sub-mirror"; // OIDC-Subject
const EMAIL = "mirror@kunde.test";
const TENANT = tenantIdForSubject(SUB); // = t_sub-mirror (EINE Quelle, kein Literal)
const CUSTOMER = "cus_mirror";
const PAYMENT_METHOD = "pm_mirror";
const SESSION = "cs_mirror"; // Stripe-Checkout-Session-Id
const PERIOD_END = 1893456000; // Unix-Sek (fix, kein Date.now) = 2030-01-01Z
const PERIOD_START = 1890864000; // Unix-Sek, Periodenanker der Fake-Session (fix)
const PLAN = "starter";
const HIGH_CAP = 100; // Caps weit offen: kein Cap-Block im Happy-Funnel
const SESSION_TTL_S = 3600;
const RETURN_SUB_OK = "/tenant.html?sub=ok"; // Rueckkehr-Ziel bei gebuchtem Abo

const CONFIG = Object.freeze({
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "price_starter",
  stripeBusinessPriceId: "price_business",
});

// Fake-BillingPort (in-process, KEIN Netz, kein echtes Stripe), Modell wie bk5: liefert
// IMMER den Customer + ein paymentMethod, sodass die Karte im Rueckkehr-Flow bindet.
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

// Produktions-Provision-Seam 1:1 nachgebaut (server.js triggerTenantProvisioning):
// ZUERST ensureTenant (zieht den nach upsertOnFirstLogin in der DB aktivierten status in
// den Spiegel - sonst liest requestNumber noch 'suspended' -> tenant_inactive -> kein
// Kauf), dann der echte Decision-Core auf demselben Store. Dry-Run: kein queue/drain ->
// die Nummer bleibt 'requested'. save() persistiert die Mutation.
// GAP-04: activatePaidTenant wertet die Rueckgabe jetzt aus (provisionCleared) - der
// Nachbau reicht das Ergebnis von requestNumberForPaidTenant durch (dieselbe Form, die
// der echte Orchestrator letztlich liefert: {ok:true, ...} bei frischer Anfrage).
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

// Harness: EIN pglite-Store + Identitaets-Schicht + Web-Login-Routen (mit ensureTenant
// verdrahtet, dev-login an) + Self-Service-Routen auf einer Wegwerf-App. KEIN
// registerTenant-Vorseed -> der Tenant entsteht erst ueber den echten dev-login-Pfad.
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
      // genau die Produktions-Verdrahtung (server.js): store.ensureTenant
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

// node:http-Request, faengt status + body + Location + set-cookie (Modell bk5).
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

// Extrahiert den `session=...`-Teil aus dem Set-Cookie der dev-login-Antwort (der Wert ist
// bereits URL-encoded, wird so unveraendert als Cookie-Header zurueckgereicht).
function sessionCookieFrom(setCookie) {
  for (const c of setCookie || []) {
    if (c.startsWith("session=")) return c.split(";")[0];
  }
  return null;
}

// Echter Signup ueber den dev-login-Shim: mintet die Session ueber DIESELBE Quelle wie der
// WorkOS-Callback (upsertOnFirstLogin + ensureTenant), OHNE registerTenant. Liefert das
// Session-Cookie.
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

// (1) CORE REGRESSION: der frische Signup (kein registerTenant) erreicht setup-checkout
// mit 200 statt 502; der Spiegel traegt jetzt den Tenant mit dem REALEN suspended-Status.
test("(1) frischer Signup: setup-checkout -> 200 (kein 502), Spiegel-Tenant ist suspended", async () => {
  const s = await setup();
  try {
    const cookie = await devLogin(s);
    // Vor-Fix: ensureCustomer -> setTenantStripe wirft (Tenant nicht im Spiegel) ->
    // asyncBilling -> 502 billing_unavailable.
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

// (2) GANZE KETTE: Rueckkehr von Stripe bucht + aktiviert + provisioniert auf dem realen
// Signup-State (Abo/Plan/KYC am Spiegel, accounts active, GENAU eine Dry-Run-Nummer ->
// beweist, dass das Provisioning den Mirror-Status-Sync ueberlebt).
test("(2) ganze Kette: Rueckkehr bucht+aktiviert+provisioniert auf dem realen Signup-State", async () => {
  const s = await setup();
  try {
    const cookie = await devLogin(s);
    // Karte/Customer ueber den echten setup-checkout-Pfad binden (setzt customerId=CUSTOMER).
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

// (3) IDEMPOTENZ / KEINE FABRIKATION: ein zweiter Login dupliziert den Spiegel-Eintrag
// nicht; ensureTenant fuer eine unbekannte Id liefert false und fuegt nichts hinzu.
test("(3) zweiter Login dedupt; ensureTenant(unbekannt) -> false, fabriziert nichts", async () => {
  const s = await setup();
  try {
    await devLogin(s);
    const afterFirst = s.store.load().tenants.length;
    await devLogin(s); // zweiter Login desselben sub
    assert.equal(s.store.load().tenants.length, afterFirst, "kein doppelter Spiegel-Eintrag");

    const before = s.store.load().tenants.length;
    const r = await s.store.ensureTenant("t_does-not-exist");
    assert.equal(r, false, "unbekannte Id -> false");
    assert.equal(s.store.load().tenants.length, before, "kein Tenant aus dem Nichts erfunden");
  } finally {
    await s.close();
  }
});
