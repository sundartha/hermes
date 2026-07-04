// BK5 - Test-Mode Smoke end-to-end: der ganze Buchungs-Funnel auf EINEM geteilten
// pglite-Store, gefahren ueber echte HTTP-Requests (node:http) gegen die echten Seams
// (makeSelfServiceRoutes + der oeffentliche GET /api/plans + verifyStripeSignature/
// applyStripeWebhook). KEIN Server-Spawn (Lehre p6a-Stall, Boot ist fail-closed) -
// stattdessen app.listen(0) + curl-funktionale Requests, offline + deterministisch.
//
// Unterschied zu bk2/bk3/w4 (die jede Station ISOLIERT mit einem Spy pruefen): der
// provision-Seam ist HIER der ECHTE Produktions-Core requestNumberForPaidTenant auf dem
// GETEILTEN Store (kein No-op-Spy), und der Webhook-Schritt verifiziert die ECHTE HMAC +
// wendet applyStripeWebhook auf denselben Store an. BK5 prueft also die VERKETTUNG (ein
// State quer durch alle Seams), nicht erneut jede einzelne Gate-Verzweigung (Cap-Block,
// PAYMENT_ENABLED-aus-404, no_card/already_subscribed sind in bk2/bk3/w4 abgedeckt -> G5).
//
// F.I.R.S.T.: offline (pglite, kein Netz, keine echten Secrets), repeatable (fixe
// PERIOD_END/NOW_S, kein Date.now/Zufall), self-validating (boolesche Asserts), independent
// (jeder Fall eigenes setup() + finally close()). Die Faelle, die einen Post-Abo-State
// brauchen, fahren den Rueckkehr-Flow als Build-Phase (subscribeViaReturn, P13).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { makePgTestStore } from "./pg-helpers.js";
import {
  webAuth,
  webAuthAllowPending,
  makeAccounts,
  makeSessions,
  signValue,
} from "../src/web-auth.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import * as ops from "../src/store/state-ops.js";
import { requestNumberForPaidTenant } from "../src/billing/provision-trigger.js";
import {
  applyStripeWebhook,
  verifyStripeSignature,
  SUBSCRIPTION_EVENT,
} from "../src/billing/webhook.js";
import { PLAN_CATALOG } from "../src/plans.js";
import { NUMBER_STATUS, USAGE_EVENT_KIND } from "../src/store/defaults.js";

// ---- Benannte Konstanten (G25, kein Magic-Value) ---------------------------------
const SECRET = "bk5-smoke-secret-0123456789"; // Session-Cookie-HMAC
const WEBHOOK_SECRET = "whsec_bk5_smoke"; // Stripe-Webhook-HMAC
const SUB = "sub-bk5"; // OIDC-Subject
const TENANT = "t_sub-bk5"; // tenantIdForSubject(SUB)
const CUSTOMER = "cus_bk5";
const PAYMENT_METHOD = "pm_bk5";
const SESSION = "cs_bk5"; // Stripe-Checkout-Session-Id
const WEBHOOK_SUB_ID = "sub_bk5_wh"; // Subscription-Id im Webhook-Event
const PERIOD_END = 1893456000; // Unix-Sek (fix, P12/R: kein Date.now) = 2030-01-01Z
const PERIOD_START = 1890864000; // Unix-Sek, Periodenanker der Fake-Session (fix, P12/R)
const NOW_S = 1_700_000_000; // Webhook-Uhr (Aufrufer kontrolliert die Zeit)
const PLAN = "starter";
const INCLUDED_MIN = 30; // = PLAN_CATALOG starter.includedMinutes
const VOICE_MINUTES_USED = 5; // Fall (7): Teilverbrauch
const HIGH_CAP = 100; // Caps weit offen: kein Cap-Block im Happy-Funnel
const SESSION_TTL_S = 3600; // Lebensdauer der Test-Web-Session (1h)
// occurredAt des Verbrauchs-Events muss >= periodStartIso(PERIOD_END) liegen
// (PERIOD_END=2030-01-01Z -> Start 2029-12-01Z). Fix gewaehlt, zeit-frei (P12/R).
const USAGE_OCCURRED_AT = "2029-12-15T10:00:00.000Z";
// Erwartetes Redirect-Ziel des Rueckkehr-Flows bei gebuchtem Abo (G25, kein Magic-String).
const RETURN_SUB_OK = "/tenant.html?sub=ok";

const CONFIG = Object.freeze({
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "price_starter",
  stripeBusinessPriceId: "price_business",
});

const cookieFor = (id) => `session=${encodeURIComponent(signValue(id, SECRET))}`;

// Fake-BillingPort (BK2-Superset, in-process, KEIN Netz, kein echtes Stripe): spy faengt
// die successUrl (Plan-Carry) + die createSubscription-Parameter (priceId).
// getCheckoutSessionResult liefert IMMER den vorgeseedeten Customer + ein paymentMethod ->
// die Karte bindet im Rueckkehr-Flow (Customer-Match in card-setup.js).
function fakeBilling(spy = {}) {
  return {
    createCustomer: async () => ({ customerId: CUSTOMER }),
    createSetupCheckoutSession: async (p) => {
      spy.successUrl = p.successUrl;
      return { url: "https://stripe.test/c/cs_bk5", sessionId: SESSION };
    },
    createSubscriptionCheckoutSession: async (p) => {
      spy.subCheckoutParams = p;
      spy.successUrl = p.successUrl;
      return { url: "https://stripe.test/c/cs_bk5", sessionId: SESSION };
    },
    getCheckoutSessionResult: async () => ({
      customerId: CUSTOMER,
      paymentMethodId: PAYMENT_METHOD,
    }),
    getSubscriptionCheckoutResult: async (sessionId) => {
      spy.resultSessionId = sessionId;
      return {
        customerId: CUSTOMER,
        paymentMethodId: PAYMENT_METHOD,
        subscriptionId: "sub_new",
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
        planSlug: PLAN,
      };
    },
    createSubscription: async (p) => {
      spy.subParams = p;
      return { subscriptionId: "sub_new", currentPeriodEnd: PERIOD_END };
    },
  };
}

// Der GETEILTE-Store-Provision-Seam: der ECHTE Decision-Core auf demselben Store, den die
// Routen lesen (nicht der bk2/w4-Spy). Dry-Run: kein queue/drain -> die Nummer bleibt
// 'requested' (genau wie triggerTenantProvisioning bei provisioningEnabled=false). Kein
// Geld, kein Provider-Kauf. save() persistiert die Mutation (Muster server.js-Trigger).
function realProvision(store) {
  return async (tenantId) => {
    requestNumberForPaidTenant(store.load(), {
      tenantId,
      fallbackCountry: "DE",
      maxNumbers: HIGH_CAP,
      maxNumbersPerTenant: HIGH_CAP,
    });
    store.save();
  };
}

// Harness wie w4/bk2-setup(): EIN pglite-Store + Identitaets-Schicht + Self-Service-Routen
// + der oeffentliche Plan-Katalog auf einer Wegwerf-App. activated=true aktiviert den
// PG-Account sofort (fuer die /state-Sicht, webAuthMw = active-only); Default suspended,
// damit der Status-Flip im Rueckkehr-Flow beobachtbar bleibt (Muster bk2/p5).
async function setup({ activated = false } = {}) {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  // Store-Mirror: Tenant (status=ACTIVE per registerTenant-Default -> requestNumber-Gate
  // erfuellt) + Customer ohne paymentMethod (die Karte bindet erst im Rueckkehr-Flow).
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Kunde", lastName: "BK5", idpSubject: SUB });
  ops.setTenantStripe(s, TENANT, { customerId: CUSTOMER });
  store.save();

  // PG-Account: upsertOnFirstLogin legt 'suspended' an. activated -> sofort aktivieren.
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "bk5@kunde.de" });
  if (activated) await accounts.setStatus(TENANT, "active");
  const { id: sessionId } = await sessions.create({
    sub: SUB,
    tenantId: TENANT,
    ttlSeconds: SESSION_TTL_S,
  });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: SECRET, sessions, accounts });
  const billingSpy = {};
  const app = express();
  app.use(express.json());
  // Oeffentlicher, read-only Plan-Katalog - DIESELBE Quelle wie server.js:168 (PLAN_CATALOG),
  // kein zweites Literal (G5). Pre-Auth (keine Middleware), keine PII.
  app.get("/api/plans", (_req, res) => res.json(PLAN_CATALOG));
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw,
      audit: () => {},
      config: CONFIG,
      billing: fakeBilling(billingSpy),
      accounts,
      provision: realProvision(store),
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    accounts,
    sessions,
    billingSpy,
    cookie: cookieFor(sessionId),
    close: () => new Promise((r) => server.close(r)),
  };
}

// node:http-Request, faengt status + body + Location-Header (Muster bk2). Ohne cookie ->
// kein Cookie-Header (Fall 1: oeffentlicher Endpoint).
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
          resolve({ status: res.statusCode, body: b, location: res.headers.location }),
        );
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const getState = (s) => request("GET", `${s.base}/api/self-service/state`, { cookie: s.cookie });
const setupCheckout = (s, plan) =>
  request("POST", `${s.base}/api/self-service/billing/setup-checkout`, {
    cookie: s.cookie,
    body: { plan },
  });
const billingReturn = (s, query) =>
  request("GET", `${s.base}/api/self-service/billing/return?${query}`, { cookie: s.cookie });

// Build-Phase (P13) fuer die Post-Abo-Faelle (5)/(6)/(7): faehrt den Rueckkehr-Flow mit
// getragenem Plan -> bucht+aktiviert+provisioniert auf dem geteilten Store. Der innere
// Assert sichert nur die Vorbedingung (das eigentliche Rueckkehr-Verhalten prueft Fall 4).
async function subscribeViaReturn(s) {
  const ret = await billingReturn(s, `session_id=${SESSION}&plan=${PLAN}`);
  assert.equal(ret.location, RETURN_SUB_OK, "Build: Abo-Aktivierung via Rueckkehr erwartet");
}

// Zaehlt die 'requested' Dry-Run-Nummern EINES Tenants auf dem geteilten Store.
const requestedNumbersFor = (store, tenantId) =>
  store
    .load()
    .numbers.filter((n) => n.tenantId === tenantId && n.status === NUMBER_STATUS.REQUESTED);

// Seedet EIN Voice-Minute-Event mit fixem occurredAt (im Abrechnungsfenster) in den
// geteilten Ledger und persistiert. Muster bk4-quota-view (occurredAt explizit gesetzt).
function seedVoiceMinute(store, tenantId, quantity) {
  const event = ops.recordUsageEvent(store.load(), {
    tenantId,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity,
    costCents: 0,
  });
  event.occurredAt = USAGE_OCCURRED_AT;
  store.save();
}

// (1) Pricing-Sicht VOR Auth: der oeffentliche Katalog ist ohne Cookie lesbar.
test("(1) GET /api/plans (pre-Auth) liefert den Katalog ohne PII", async () => {
  const s = await setup();
  try {
    const res = await request("GET", `${s.base}/api/plans`);
    assert.equal(res.status, 200);
    const plans = JSON.parse(res.body);
    assert.equal(plans.length, 2);
    assert.deepEqual(
      plans.map((p) => p.slug),
      ["starter", "business"],
    );
    assert.deepEqual(
      plans.map((p) => p.amountCents),
      [499, 999],
    );
    assert.equal(
      plans.every((p) => p.currency === "eur"), // EUR-Cutover (Stripe live, 2026-07-03)
      true,
    );
  } finally {
    await s.close();
  }
});

// (2) Leerzustand VOR Abo: aktiver Account, aber kein Plan/keine Karte/keine Nummer.
test("(2) /state vor Abo -> kein Plan, kein quota, keine Nummer, keine Karte", async () => {
  const s = await setup({ activated: true });
  try {
    const res = await getState(s);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.subscription.planSlug, null);
    assert.equal(body.quota, null);
    assert.equal(body.agent.number, "");
    assert.equal(body.hasCard, false);
  } finally {
    await s.close();
  }
});

// (3) Plan waehlen -> der Checkout traegt den Plan an die Stripe-successUrl, Price im
// subscription-Mode-Checkout (Rabattcode-Feature).
test("(3) setup-checkout {plan:starter} -> successUrl traegt &plan=starter, Price im Checkout", async () => {
  const s = await setup();
  try {
    const res = await setupCheckout(s, PLAN);
    assert.equal(res.status, 200);
    assert.equal(s.billingSpy.successUrl.includes(`&plan=${PLAN}`), true);
    assert.equal(s.billingSpy.subCheckoutParams.priceId, "price_starter");
  } finally {
    await s.close();
  }
});

// (4) Rueckkehr -> buchen + aktivieren + provisionieren (echter Core) auf einem State.
test("(4) Rueckkehr bucht+aktiviert+provisioniert genau eine Dry-Run-Nummer", async () => {
  const s = await setup();
  try {
    const ret = await billingReturn(s, `session_id=${SESSION}&plan=${PLAN}`);
    assert.equal(ret.status, 302);
    assert.equal(ret.location, RETURN_SUB_OK);
    const tenant = s.store.load().tenants.find((x) => x.id === TENANT);
    assert.equal(tenant.stripeSubscriptionId, "sub_new", "Abo persistiert");
    assert.equal(tenant.stripePlanSlug, PLAN, "getragener Plan gebucht");
    assert.equal(tenant.kycLevel, "card", "KYC auf CARD gehoben");
    const acct = await s.accounts.resolve(SUB);
    assert.equal(acct.status, "active", "Tenant ueber accounts.setStatus aktiviert");
    assert.equal("subParams" in s.billingSpy, false, "kein zweiter Geld-Call (createSubscription)");
    assert.equal(requestedNumbersFor(s.store, TENANT).length, 1, "genau eine Dry-Run-Nummer");
  } finally {
    await s.close();
  }
});

// (5) Webhook 'active' NACH dem Subscribe -> idempotent: kein Doppelkauf, Status bleibt.
test("(5) signierter active-Webhook ist idempotent (weiterhin eine Nummer)", async () => {
  const s = await setup();
  try {
    await subscribeViaReturn(s); // Build: 1 Dry-Run-Nummer + active
    const body = JSON.stringify({
      type: SUBSCRIPTION_EVENT.CREATED,
      data: {
        object: {
          id: WEBHOOK_SUB_ID,
          status: "active",
          current_period_end: PERIOD_END,
          metadata: { tenant_ref: TENANT, plan_slug: PLAN },
        },
      },
    });
    const mac = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${NOW_S}.${body}`).digest("hex");
    assert.equal(
      verifyStripeSignature({
        rawBody: body,
        signatureHeader: `t=${NOW_S},v1=${mac}`,
        secret: WEBHOOK_SECRET,
        nowS: NOW_S,
      }),
      true,
      "HMAC verifiziert",
    );
    await applyStripeWebhook(JSON.parse(body), {
      store: s.store,
      accounts: s.accounts,
      sessions: s.sessions,
      audit: () => {},
      req: {},
      provision: realProvision(s.store),
    });
    assert.equal(requestedNumbersFor(s.store, TENANT).length, 1, "Webhook kauft nicht doppelt");
    const acct = await s.accounts.resolve(SUB);
    assert.equal(acct.status, "active", "Status durch idempotenten Webhook unveraendert");
  } finally {
    await s.close();
  }
});

// (6) Dashboard final: Plan + Kontingent sichtbar, kein Id-Leak, Dry-Run-Nummer-Wahrheit.
test("(6) /state nach Abo zeigt Plan + volles Kontingent, ohne Id-Leak", async () => {
  const s = await setup();
  try {
    await subscribeViaReturn(s);
    const res = await getState(s);
    const body = JSON.parse(res.body);
    assert.equal(body.subscription.planSlug, PLAN);
    assert.equal(body.subscription.currentPeriodEnd, PERIOD_END);
    assert.deepEqual(body.quota, {
      includedMinutes: INCLUDED_MIN,
      usedMinutes: 0,
      remainingMinutes: INCLUDED_MIN,
      exhausted: false,
    });
    assert.equal("subscriptionId" in body.subscription, false, "kein sub_-Id-Leak in der View");
    // Dry-Run-Wahrheit: die Nummer bleibt 'requested' (kein Kauf) -> activeNumberFor liefert ""
    // (nur ACTIVE zaehlt). Echte E.164-Aktivierung ist der Owner-Go-Live (PLAN-Abschnitt 8).
    assert.equal(body.agent.number, "", "Dry-Run: noch keine aktive E.164-Nummer");
  } finally {
    await s.close();
  }
});

// (7) Kontingent ist live aus dem Ledger abgeleitet, nicht hardcodiert.
test("(7) /state leitet das verbrauchte Kontingent live aus dem Ledger ab", async () => {
  const s = await setup();
  try {
    await subscribeViaReturn(s);
    seedVoiceMinute(s.store, TENANT, VOICE_MINUTES_USED);
    const res = await getState(s);
    const body = JSON.parse(res.body);
    assert.equal(body.quota.usedMinutes, VOICE_MINUTES_USED);
    assert.equal(body.quota.remainingMinutes, INCLUDED_MIN - VOICE_MINUTES_USED);
  } finally {
    await s.close();
  }
});
