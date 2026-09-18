// BK2 — Checkout-Verkettung: Kachel-CTA -> Stripe. Prueft die Plan-Mitnahme durch den
// Karten-Umweg: setup-checkout haengt den (katalog-validierten) Plan an die Stripe-
// successUrl, billing/return liest req.query.plan und bucht+aktiviert direkt (gefuehrter
// no_card-Flow: keine Karte -> Checkout -> Rueckkehr -> Plan automatisch gebucht).
//
// Kompositions-Integrationstest nach Muster w4/p5/i9: reines pglite (offline, F.I.R.S.T.),
// KEIN Server-Spawn (Lehre p6a-Stall). Fake-Billing mit createSetupCheckoutSession-Spy
// (faengt successUrl) + createSubscription-Spy (faengt priceId). PG-Account bleibt suspended
// (KEIN accounts.setStatus(active)) -> der Status-Flip im return-Flow ist beobachtbar.
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
import { CustomerMissingError } from "../src/billing/errors.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const SECRET = "bk2-checkout-secret-0123456789";
const SUB = "sub-bk2";
const TENANT = "t_sub-bk2";
const CUSTOMER = "cus_b";
const SESSION = "cs_b";
const PERIOD_END = 1893456000;
const PERIOD_START = 1890864000; // Unix-Sek, Periodenanker der Fake-Session (fix, P12/R)
const CHECKOUT_OUTCOME = Object.freeze({
  customerId: CUSTOMER,
  paymentMethodId: "pm_b",
  subscriptionId: "sub_new",
  currentPeriodStart: PERIOD_START,
  currentPeriodEnd: PERIOD_END,
  planSlug: "starter",
});
const CONFIG = {
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "price_starter",
  stripeProPriceId: "price_pro",
  stripeCustomerRetryDelayMs: 0, // Self-Heal-Tests warten nie echt (P12/T9)
};

// Fake-Billing (in-process, KEIN Netz). spy.successUrl faengt die an Stripe uebergebene
// successUrl (BK2-Plan-Carry); spy.subParams faengt die createSubscription-Parameter
// (priceId). getCheckoutSessionResult liefert IMMER den vorgeseedeten Customer -> die
// Karte bindet im return-Flow (Customer-Match in card-setup.js). staleCustomerHeal (Fix B):
// der ERSTE createSubscriptionCheckoutSession-Call wirft CustomerMissingError (stale
// gespeicherter Customer), der Heal-Retry (mit dem frisch angelegten Customer) gelingt.
function fakeBilling(spy = {}, checkoutOutcome = {}, { staleCustomerHeal = false } = {}) {
  let subCheckoutCallCount = 0;
  return {
    createCustomer: async () => ({ customerId: "cus_fresh" }),
    createSetupCheckoutSession: async (p) => {
      spy.setupParams = p;
      spy.successUrl = p.successUrl;
      return { url: "https://stripe.test/c/cs_b", sessionId: SESSION };
    },
    createSubscriptionCheckoutSession: async (p) => {
      subCheckoutCallCount += 1;
      spy.subCheckoutParams = p;
      spy.successUrl = p.successUrl;
      if (staleCustomerHeal && subCheckoutCallCount === 1) {
        throw new CustomerMissingError(
          "Stripe createSubscriptionCheckoutSession fehlgeschlagen: HTTP 400 resource_missing",
        );
      }
      return { url: "https://stripe.test/c/cs_b", sessionId: SESSION };
    },
    getCheckoutSessionResult: async () => ({ customerId: CUSTOMER, paymentMethodId: "pm_b" }),
    getSubscriptionCheckoutResult: async (sessionId) => {
      spy.resultSessionId = sessionId;
      return { ...CHECKOUT_OUTCOME, ...checkoutOutcome };
    },
    createSubscription: async (p) => {
      spy.subParams = p;
      return { subscriptionId: "sub_new", currentPeriodEnd: PERIOD_END };
    },
  };
}

const cookieFor = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(id, SECRET))}`;

// Harness wie w4-setup(): Store + Identitaets-Schicht + Self-Service-Routen auf einer
// Wegwerf-App. Zusaetzlich Customer cus_b vorgeseedet (ohne payment_method - die Karte
// wird erst im return-Flow gebunden). subscribed -> ein bestehendes Abo vorseeden (Case 7).
async function setup({
  paymentEnabled = true,
  subscribed = false,
  cardOnFile = false,
  configPatch = {},
  checkoutOutcome = {},
  staleCustomerHeal = false,
} = {}) {
  const { store, db } = await makePgTestStore();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);

  // Store-Mirror: Tenant (status=ACTIVE per registerTenant-Default) + Customer ohne pm.
  // cardOnFile -> zusaetzlich ein gebundenes payment_method (Zustand NACH einem
  // abgeschlossenen ersten Return; unterscheidet Doppel-Redirect vom Webhook-Race).
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Kunde", lastName: "BK2", idpSubject: SUB });
  ops.setTenantStripe(s, TENANT, {
    customerId: CUSTOMER,
    ...(cardOnFile ? { paymentMethodId: "pm_old" } : {}),
  });
  if (subscribed) {
    ops.setTenantSubscription(s, TENANT, {
      subscriptionId: "sub_old",
      planSlug: "starter",
      currentPeriodEnd: PERIOD_END,
    });
  }

  // PG-Account: upsertOnFirstLogin legt 'suspended' an. KEIN setStatus(active) -> der
  // Status-Flip im return-Flow ist beobachtbar (Deadlock-Aufloesung wie p5).
  await accounts.upsertOnFirstLogin({ sub: SUB, email: "bk2@kunde.de" });
  const { id: sessionId } = await sessions.create({ sub: SUB, tenantId: TENANT, ttlSeconds: 3600 });

  const webAuthMw = webAuth({ secret: SECRET, sessions, accounts });
  const webAuthPendingMw = webAuthAllowPending({ secret: SECRET, sessions, accounts });
  const billingSpy = {};
  const provisionSpy = [];
  // Self-Heal (Fix B): faengt audit-Aufrufe (Muster billingSpy) - so ist der alarmierbare
  // stripe_customer_self_heal-Event pruefbar, ohne echtes audit-Backend.
  const auditCalls = [];
  const app = express();
  app.use(express.json());
  app.use(
    makeSelfServiceRoutes({
      store,
      webAuthMw,
      webAuthPendingMw,
      audit: (event, _req, detail) => auditCalls.push({ event, detail }),
      config: withConfigNamespaces({ ...CONFIG, paymentEnabled, ...configPatch }),
      billing: fakeBilling(billingSpy, checkoutOutcome, { staleCustomerHeal }),
      accounts,
      // GAP-04: activatePaidTenant aktiviert nur bei GEKLAERTEM Ergebnis (provisionCleared).
      provision: async (t) => {
        provisionSpy.push(t);
        return { ok: true, reason: "queued" };
      },
    }),
  );
  const server = await new Promise((r) => {
    const sv = app.listen(0, "127.0.0.1", () => r(sv));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    accounts,
    billingSpy,
    provisionSpy,
    auditCalls,
    cookie: cookieFor(sessionId),
    close: () => new Promise((r) => server.close(r)),
  };
}

// Request-Helper faengt zusaetzlich den Location-Header (Muster i9 getCardReturn) - so
// sind die 302-Redirect-Ziele (?card=ok / ?sub=ok / ?sub=failed) pruefbar.
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

// setup-checkout mit optionalem Plan (Muster T1: der Client schickt IMMER {plan}; fehlt
// der Plan, wird er undefined -> JSON "{}" -> Server: card-only).
const setupCheckout = (s, plan) =>
  request("POST", `${s.base}/api/self-service/billing/setup-checkout`, {
    cookie: s.cookie,
    body: { plan },
  });
const billingReturn = (s, query) =>
  request("GET", `${s.base}/api/self-service/billing/return?${query}`, { cookie: s.cookie });

test("(1) setup-checkout {plan:starter} -> subscription-Mode-Session, successUrl traegt &plan=starter", async () => {
  const s = await setup();
  try {
    const res = await setupCheckout(s, "starter");
    assert.equal(res.status, 200);
    assert.equal(s.billingSpy.successUrl.includes("&plan=starter"), true);
    assert.equal(s.billingSpy.subCheckoutParams.priceId, "price_starter");
    assert.equal(s.billingSpy.subCheckoutParams.planSlug, "starter");
    assert.equal("setupParams" in s.billingSpy, false, "KEIN setup-Mode bei getragenem Plan");
  } finally {
    await s.close();
  }
});

test("(2) setup-checkout ohne Plan -> successUrl OHNE &plan= (byte-identisch zum Bestand)", async () => {
  const s = await setup();
  try {
    const res = await setupCheckout(s);
    assert.equal(res.status, 200);
    assert.equal(s.billingSpy.successUrl.includes("&plan="), false, "kein Plan-Anhang");
  } finally {
    await s.close();
  }
});

test("(3) setup-checkout {plan:gold} (unbekannt) -> kein &plan= (Muell verworfen)", async () => {
  const s = await setup();
  try {
    await setupCheckout(s, "gold");
    assert.equal(s.billingSpy.successUrl.includes("&plan="), false, "unbekannter Slug verworfen");
  } finally {
    await s.close();
  }
});

test("(4) return ?plan=starter -> 302 sub=ok, Abo aus der Session aktiviert (KEIN zweiter Geld-Call)", async () => {
  const s = await setup();
  try {
    const ret = await billingReturn(s, `session_id=${SESSION}&plan=starter`);
    assert.equal(ret.status, 302);
    assert.equal(ret.location, "/app?sub=ok", "Redirect ins Abo-gebucht-Ziel");
    assert.equal(s.billingSpy.resultSessionId, SESSION, "liest die abgeschlossene Session");
    assert.equal("subParams" in s.billingSpy, false, "kein zweiter Geld-Call (createSubscription)");
    // Abo-Referenzen im Mirror.
    const t = s.store.load().tenants.find((x) => x.id === TENANT);
    assert.equal(t.stripeSubscriptionId, "sub_new", "Abo persistiert");
    assert.equal(t.stripePlanSlug, "starter", "getragener Plan gebucht");
    assert.equal(t.kycLevel, "card", "KYC auf CARD gehoben");
    // Status-Flip ueber den pg-Status-Seam (war suspended).
    const acct = await s.accounts.resolve(SUB);
    assert.equal(acct.status, "active", "Tenant ueber accounts.setStatus aktiviert");
    // Provisioning genau 1x mit dem eigenen Tenant.
    assert.deepEqual(s.provisionSpy, [TENANT], "Provisioning genau 1x");
  } finally {
    await s.close();
  }
});

test("(5) return ohne Plan -> 302 card=ok, KEIN subscribe (Regressions-Guard)", async () => {
  const s = await setup();
  try {
    const ret = await billingReturn(s, `session_id=${SESSION}`);
    assert.equal(ret.status, 302);
    assert.equal(ret.location, "/app?card=ok", "reiner Karten-Flow");
    assert.equal("subParams" in s.billingSpy, false, "createSubscription nicht gerufen");
    assert.deepEqual(s.provisionSpy, [], "kein Provisioning ohne getragenen Plan");
  } finally {
    await s.close();
  }
});

test("(6) return ?plan=gold (unbekannt) -> 302 card=ok, kein subscribe (Muell verworfen)", async () => {
  const s = await setup();
  try {
    const ret = await billingReturn(s, `session_id=${SESSION}&plan=gold`);
    assert.equal(ret.status, 302);
    assert.equal(ret.location, "/app?card=ok", "unbekannter Slug -> reiner Karten-Flow");
    assert.equal("subParams" in s.billingSpy, false, "kein Subscribe mit Muell");
  } finally {
    await s.close();
  }
});

test("(7) return ?plan=starter bei bereits aboniertem Tenant MIT Karte, IDENTISCHE subscriptionId (Doppel-Redirect derselben Session) -> 302 sub=ok (idempotent-erfolgreich), kein Provisioning, altes Abo unveraendert", async () => {
  // subscriptionId der Session == bereits gespeicherte Id UND Karte-on-file: der reale
  // Doppel-Redirect-Fall (der erste Return hat die Karte gebunden; Test 13 deckt den-
  // selben Sachverhalt ueber den echten Session-Roundtrip ab). OHNE Karte ist derselbe
  // Zustand das Webhook-gewonnene Rennen -> Heilungspfad, siehe Test 16.
  const s = await setup({
    subscribed: true,
    cardOnFile: true,
    checkoutOutcome: { subscriptionId: "sub_old" },
  });
  try {
    const ret = await billingReturn(s, `session_id=${SESSION}&plan=starter`);
    assert.equal(ret.status, 302);
    assert.equal(ret.location, "/app?sub=ok", "already_subscribed ist idempotent-erfolgreich");
    assert.deepEqual(s.provisionSpy, [], "kein zweites Provisioning");
    const t = s.store.load().tenants.find((x) => x.id === TENANT);
    assert.equal(t.stripeSubscriptionId, "sub_old", "bestehendes Abo bleibt unveraendert");
  } finally {
    await s.close();
  }
});

test("(8) return ?plan=starter bei PAYMENT_ENABLED aus -> 404 (Geld-Gate auf der neuen Behavior)", async () => {
  const s = await setup({ paymentEnabled: false });
  try {
    const ret = await billingReturn(s, `session_id=${SESSION}&plan=starter`);
    assert.equal(ret.status, 404);
  } finally {
    await s.close();
  }
});

test("(9) setup-checkout {plan:starter} ohne Price-Konfig -> 500 plan_unconfigured VOR jedem Stripe-Call", async () => {
  const s = await setup({ configPatch: { stripeStarterPriceId: "" } });
  try {
    const res = await setupCheckout(s, "starter");
    assert.equal(res.status, 500);
    assert.equal(JSON.parse(res.body).error, "plan_unconfigured");
    assert.equal("subCheckoutParams" in s.billingSpy, false);
    assert.equal("setupParams" in s.billingSpy, false);
  } finally {
    await s.close();
  }
});

test("(10) setup-checkout {plan:starter} bei bestehendem Abo -> 409, KEINE Session (kein zweites Stripe-Abo)", async () => {
  const s = await setup({ subscribed: true });
  try {
    const res = await setupCheckout(s, "starter");
    assert.equal(res.status, 409);
    assert.equal(JSON.parse(res.body).error, "already_subscribed");
    assert.equal("subCheckoutParams" in s.billingSpy, false);
  } finally {
    await s.close();
  }
});

test("(11) return ?plan=starter mit fremder Session (Customer-Mismatch) -> 403, nichts persistiert (R4)", async () => {
  const s = await setup({ checkoutOutcome: { customerId: "cus_fremd" } });
  try {
    const ret = await billingReturn(s, `session_id=${SESSION}&plan=starter`);
    assert.equal(ret.status, 403);
    assert.equal(JSON.parse(ret.body).error, "Customer-Mismatch");
    const t = s.store.load().tenants.find((x) => x.id === TENANT);
    assert.equal(t.stripeSubscriptionId ?? null, null, "kein Abo persistiert");
    assert.deepEqual(s.provisionSpy, [], "kein Provisioning");
    const acct = await s.accounts.resolve(SUB);
    assert.equal(acct.status, "suspended", "keine Aktivierung");
  } finally {
    await s.close();
  }
});

test("(12) return ?plan=pro bei einer starter-Session (Plan-Tamper) -> 403, nichts persistiert", async () => {
  const s = await setup();
  try {
    const ret = await billingReturn(s, `session_id=${SESSION}&plan=pro`);
    assert.equal(ret.status, 403);
    assert.equal(JSON.parse(ret.body).error, "Customer-Mismatch");
    const t = s.store.load().tenants.find((x) => x.id === TENANT);
    assert.equal(t.stripeSubscriptionId ?? null, null, "kein Abo persistiert (teureres Kontingent verhindert)");
  } finally {
    await s.close();
  }
});

test("(13) doppelter return derselben Session -> beide sub=ok, Provisioning genau 1x", async () => {
  const s = await setup();
  try {
    const first = await billingReturn(s, `session_id=${SESSION}&plan=starter`);
    assert.equal(first.location, "/app?sub=ok");
    const second = await billingReturn(s, `session_id=${SESSION}&plan=starter`);
    assert.equal(second.status, 302);
    assert.equal(second.location, "/app?sub=ok", "Doppel-Redirect idempotent-erfolgreich");
    assert.deepEqual(s.provisionSpy, [TENANT], "Provisioning bleibt bei genau 1x");
  } finally {
    await s.close();
  }
});

// Review-Blocker S1 (Runde 1): Test (13) deckt nur die BEREITS abgesicherte Variante ab
// (zwei /return-Aufrufe MIT DERSELBEN session_id). Der eigentliche Race liegt VOR /return:
// zwei nahezu gleichzeitige setup-checkout-Aufrufe (Doppelklick/zwei Tabs) fuer denselben
// Tenant+Plan bestehen BEIDE den already_subscribed-Vor-Check (store.tenantSubscription
// ist bei beiden noch leer, keine Session ist abgeschlossen) - ohne Idempotency-Key haette
// jeder Aufruf eine EIGENE Stripe-Checkout-Session erzeugt, beide abschliessbar -> zwei
// echte, real abgerechnete Stripe-Abos (Kostenleck). Diese Regression prueft, dass beide
// Aufrufe DENSELBEN Idempotency-Key an Stripe reichen - der eigentliche Schutz (Stripe
// liefert dann dieselbe Session zurueck, nur EINE ist abschliessbar).
test("(14) TOCTOU-Regression: zwei setup-checkout-Aufrufe (Doppelklick/zwei Tabs, VOR jeder abgeschlossenen Session) erhalten DENSELBEN Idempotency-Key", async () => {
  const s = await setup();
  try {
    const first = await setupCheckout(s, "starter");
    assert.equal(first.status, 200);
    const firstKey = s.billingSpy.subCheckoutParams.idempotencyKey;
    assert.ok(firstKey, "Idempotency-Key wird gesetzt");

    // Der Vor-Check (store.tenantSubscription) ist zwischen beiden Aufrufen weiterhin leer
    // (kein /return dazwischen) - simuliert exakt den TOCTOU-Zeitpunkt aus dem Finding.
    const second = await setupCheckout(s, "starter");
    assert.equal(second.status, 200, "der Vor-Check erlaubt beide Aufrufe (das ist die Luecke)");
    const secondKey = s.billingSpy.subCheckoutParams.idempotencyKey;
    assert.equal(secondKey, firstKey, "gleicher Tenant+Plan -> gleicher Key, Stripe dedupt die zweite Session");
  } finally {
    await s.close();
  }
});

// Review-Blocker Runde 2 (Cross-Plan-Race, P16/G3): zwei nahezu gleichzeitige
// setup-checkout-Aufrufe fuer VERSCHIEDENE Plaene (verschiedene Idempotency-Keys,
// Test 14 deckt nur denselben Plan ab) erzeugen zwei ECHTE, real abgerechnete
// Stripe-Subscriptions. Simuliert hier die zweite Rueckkehr: der Tenant hat bereits
// ein Abo (starter, sub_old aus einer ERSTEN, abgeschlossenen Session), die ZWEITE
// Session (pro) traegt eine ANDERE, ebenfalls real bezahlte subscriptionId.
// Das darf NIE als Erfolg (sub=ok) gemeldet werden - der Kunde wuerde sonst denken,
// der Pro-Plan sei aktiv, waehrend der Store weiter starter zeigt und die
// echte Pro-Subscription bei Stripe unverwaltet weiterlaeuft.
test("(15) return ?plan=pro bei bereits (starter-)aboniertem Tenant, ABWEICHENDE subscriptionId (Cross-Plan-Race) -> 302 sub=failed, KEIN falscher Erfolg, altes Abo unveraendert, kein Provisioning", async () => {
  const s = await setup({
    subscribed: true, // sub_old/starter bereits gespeichert (aus einer ersten, abgeschlossenen Session)
    checkoutOutcome: { planSlug: "pro", subscriptionId: "sub_pro_real" },
  });
  try {
    const ret = await billingReturn(s, `session_id=${SESSION}&plan=pro`);
    assert.equal(ret.status, 302);
    assert.equal(
      ret.location,
      "/app?sub=failed",
      "abweichende subscriptionId ist NIE ein idempotenter Erfolg (kein falsches sub=ok)",
    );
    assert.deepEqual(s.provisionSpy, [], "kein Provisioning der verwaisten Subscription");
    const t = s.store.load().tenants.find((x) => x.id === TENANT);
    assert.equal(t.stripeSubscriptionId, "sub_old", "das bestehende (starter-)Abo bleibt unveraendert");
    assert.equal(t.stripePlanSlug, "starter", "kein stiller Plan-Wechsel auf pro");
    const acct = await s.accounts.resolve(SUB);
    assert.equal(acct.status, "suspended", "keine Aktivierung ueber die verwaiste Subscription");
  } finally {
    await s.close();
  }
});

// Wurzelfix "Abo ohne Nummer" (Live-Befund 2026-07-06): der Stripe-Webhook gewinnt das
// Rennen gegen diesen Return regelmaessig (Zustellung in ms vs. Browser-Redirect in
// Sekunden), speichert das Abo und stoesst Provisioning an - band aber keine Karte.
// Der Return brach danach bei already_subscribed VOR setTenantStripe ab: Tenant
// dauerhaft abonniert-aber-kartenlos, jedes Provisioning fail-closed tot.
test("(16) return ?plan=starter nach Webhook-gewonnenem Rennen (Abo gespeichert, KEINE Karte) -> Karte gebunden, Aktivierung + Provisioning genau 1x, 302 sub=ok", async () => {
  // subscribed OHNE cardOnFile = exakt der Zustand, den der schnellere Webhook hinterlaesst.
  const s = await setup({ subscribed: true, checkoutOutcome: { subscriptionId: "sub_old" } });
  try {
    const ret = await billingReturn(s, `session_id=${SESSION}&plan=starter`);
    assert.equal(ret.status, 302);
    assert.equal(ret.location, "/app?sub=ok", "Heilung ist idempotent-erfolgreich");
    const t = s.store.load().tenants.find((x) => x.id === TENANT);
    assert.equal(t.stripePaymentMethodId, "pm_b", "Karte aus der verifizierten Session gebunden");
    assert.equal(t.stripeSubscriptionId, "sub_old", "bestehendes Abo bleibt unveraendert");
    assert.equal(t.stripeCurrentPeriodStart, PERIOD_START, "Perioden-Anker aus der Session nachgezogen (Quota-Fenster)");
    assert.equal(t.stripeCurrentPeriodEnd, PERIOD_END);
    assert.deepEqual(s.provisionSpy, [TENANT], "Heilung stoesst das idempotente Provisioning an");
    const acct = await s.accounts.resolve(SUB);
    assert.equal(acct.status, "active", "Aktivierung laeuft wie im ok-Pfad");
  } finally {
    await s.close();
  }
});

// Fix B (PLAN-CHECKOUT-STALE-STRIPE-CUSTOMER.md): stale customerId bei Stripe (z.B. Test/
// Live-Wechsel, Dashboard-Cleanup) fuehrte VORHER zu 502 billing_unavailable ("Couldn't
// start checkout."). Der Self-Heal-Wrapper verwirft die stale Referenz, legt EINEN
// frischen Customer an und wiederholt den Checkout-Start genau einmal (retryDelayMs:0
// in der Test-Config, kein echtes Warten).
test("(17) setup-checkout {plan:starter} bei stale Stripe-Customer (resource_missing) -> Self-Heal: 200 + url, frischer Customer persistiert, Audit stripe_customer_self_heal", async () => {
  const s = await setup({ staleCustomerHeal: true });
  try {
    const res = await setupCheckout(s, "starter");
    assert.equal(res.status, 200, "Self-Heal liefert die Checkout-URL statt 502");
    assert.equal(JSON.parse(res.body).url, "https://stripe.test/c/cs_b");
    const t = s.store.load().tenants.find((x) => x.id === TENANT);
    assert.equal(t.stripeCustomerId, "cus_fresh", "stale Customer verworfen, frischer persistiert");
    assert.ok(
      s.auditCalls.some((c) => c.event === "stripe_customer_self_heal" && c.detail === `tenant=${TENANT}`),
      "alarmierbarer Audit-Event fuer den Heal",
    );
  } finally {
    await s.close();
  }
});
