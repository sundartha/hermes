import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { importNachUmgebung } from "../gemeinsam/umgebung-import.js";
import anfrageMitFrist from "../gemeinsam/anfrage-mit-frist.mjs";
import request from "../gemeinsam/testserver-anfrage.mjs";
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";
import { STRIPE_ROUTEN_GEHEIMNIS, WEB_SITZUNGS_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";

const KUNDE_SUB = "abo-plan-kunde";
const KUNDE_TENANT = `t_${KUNDE_SUB}`;
const KUNDE_MAIL = "kunde@abo-plan.invalid";
const STRIPE_KUNDE = "cus_abo_plan";
const STRIPE_KARTE = "pm_abo_plan";
const STRIPE_SCHLUESSEL = "sk_test_abo_plan";
const WEBHOOK_PFAD = "/webhooks/stripe";
const LOKAL = "http://127.0.0.1:";
const SITZUNG_DAUER_S = 3600;
const MS_PER_S = 1000;
const ALARM_NUMMER = "+491700000099";
const ALARM_ABSENDER = "+4930000000099";
const METADATUM = /^metadata\[(.+)\]$/;

let config, wireWebLogin, installGlobalMiddleware, webAuth, makePgTestStore, withStripeStub;

before(async () => {
  let makeStripeStub;
  [{ config }, { wireWebLogin }, { installGlobalMiddleware }, webAuth, { makePgTestStore }, { makeStripeStub }] =
    await importNachUmgebung(
      { VOICE_TARIFF_DEFAULT_CENTS: "6" },
      () => import("../../src/config.js"),
      () => import("../../src/wiring/web-login.js"),
      () => import("../../src/app.js"),
      () => import("../../src/web-auth.js"),
      () => import("../pg-helpers.js"),
      () => import("../helpers.js"),
    );
  Object.assign(config.billing, {
    paymentEnabled: true,
    stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS,
    stripeStarterPriceId: "price_starter_abo_plan",
    stripeBusinessPriceId: "price_business_abo_plan",
  });
  Object.assign(config.tenancy, { selfServiceEnabled: true, multiTenant: true });
  config.auth.sessionSecret = WEB_SITZUNGS_GEHEIMNIS;
  config.billing.platformAlertSmsTo = ALARM_NUMMER;
  withStripeStub = makeStripeStub(config, STRIPE_SCHLUESSEL);
});

async function kundeOhneAbo(store, runner) {
  store.load().tenants.push({
    id: KUNDE_TENANT,
    status: "suspended",
    firstName: "Kunde",
    ownerName: "Kunde Abo",
    idpSubject: KUNDE_SUB,
  });
  store.setTenantStripe(KUNDE_TENANT, { customerId: STRIPE_KUNDE, paymentMethodId: STRIPE_KARTE });
  const accounts = webAuth.makeAccounts(runner);
  const { tenantId } = await accounts.upsertOnFirstLogin({ sub: KUNDE_SUB, email: KUNDE_MAIL });
  if (tenantId !== KUNDE_TENANT) throw new Error(`Testaufbau: Konto zeigt auf ${tenantId} statt ${KUNDE_TENANT}`);
  const sitzung = await webAuth.makeSessions(runner).create({
    sub: KUNDE_SUB,
    tenantId: KUNDE_TENANT,
    ttlSeconds: SITZUNG_DAUER_S,
  });
  const cookie = `${webAuth.SESSION_COOKIE_NAME}=${encodeURIComponent(webAuth.signValue(sitzung.id, WEB_SITZUNGS_GEHEIMNIS))}`;
  return { accounts, cookie };
}

async function hermesStarten({ store, runner, protokoll, messaging }) {
  const app = express();
  installGlobalMiddleware({ app, config });
  await wireWebLogin({
    app,
    config,
    store,
    audit: (action, _req, detail) => protokoll.push([action, detail]),
    provision: async () => ({ ok: true, reason: "queued" }),
    createPortalRunner: () => runner,
    stripeWebhookPath: WEBHOOK_PFAD,
    appPath: "/app",
    messaging,
  });
  const server = await new Promise((fertig) => {
    const laufend = app.listen(0, "127.0.0.1", () => fertig(laufend));
  });
  return { basis: `${LOKAL}${server.address().port}`, schliessen: () => new Promise((zu) => server.close(zu)) };
}

function signiertSenden(basis, ereignis) {
  const rumpf = JSON.stringify(ereignis);
  const zeit = Math.floor(Date.now() / MS_PER_S);
  const mac = crypto.createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${rumpf}`).digest("hex");
  const ziel = new URL(`${basis}${WEBHOOK_PFAD}`);
  return new Promise((fertig, scheitern) => {
    const kopf = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(rumpf),
      "Stripe-Signature": `t=${zeit},v1=${mac}`,
    };
    const anfrage = anfrageMitFrist(
      { hostname: ziel.hostname, port: ziel.port, path: ziel.pathname, method: "POST", headers: kopf },
      (antwort) => {
        antwort.resume();
        antwort.on("end", () => fertig({ status: antwort.statusCode }));
      },
    );
    anfrage.on("error", scheitern);
    anfrage.end(rumpf);
  });
}


const ABO_A = "sub_abweichend_a";
const ABO_B = "sub_abweichend_b";

function stripeMitAbrissDannErfolg() {
  let anlagen = 0;
  const abrufen = async (url, optionen = {}) => {
    const abos = `${config.billing.stripeApiBase}/v1/subscriptions`;
    if (String(url) === abos && optionen.method === "POST") {
      anlagen += 1;
      if (anlagen === 1)
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
      return Response.json({ id: ABO_B, status: "active" });
    }
    return new Response("{}", { status: 404 });
  };
  return abrufen;
}

function mitHermes(fn) {
  return withStripeStub(stripeMitAbrissDannErfolg(), async () => {
    const { store, runner } = await makePgTestStore();
    const protokoll = [];
    const sms = [];
    const messaging = () => ({ sendSms: async (nachricht) => sms.push(nachricht) });
    store.load().numbers.push({
      id: "num_abweichend", tenantId: BOOTSTRAP_TENANT_ID, status: "active", provider: "telnyx", e164: ALARM_ABSENDER,
      providerNumberId: null,
    });
    const { cookie } = await kundeOhneAbo(store, runner);
    const { basis, schliessen } = await hermesStarten({ store, runner, protokoll, messaging });
    const abonnieren = (plan) => request("POST", `${basis}/api/self-service/billing/subscribe`, { cookie, body: { plan } });
    try {
      return await fn({ store, protokoll, sms, abonnieren, sende: (ereignis) => signiertSenden(basis, ereignis) });
    } finally {
      await schliessen();
    }
  });
}

function aboEreignis(typ, aboKennung, metadata) {
  return {
    id: `evt_abweichend_${crypto.randomUUID()}`,
    type: typ,
    created: Math.floor(Date.now() / MS_PER_S),
    data: { object: { id: aboKennung, status: "active", customer: STRIPE_KUNDE, metadata } },
  };
}

const ZUM_KUNDEN = { tenant_ref: KUNDE_TENANT, plan_slug: "starter" };

async function zweiMalAbonniert(h) {
  assert.equal((await h.abonnieren("starter")).status, 502);
  assert.equal((await h.abonnieren("business")).status, 200);
  const abo = h.store.tenantSubscription(KUNDE_TENANT);
  assert.equal(abo.subscriptionId, ABO_B);
  assert.equal(abo.planSlug, "business");
}

for (const typ of ["customer.subscription.created", "customer.subscription.updated"]) {
  test(`abweichende Kennung: ${typ} fuer anderes Abo ueberschreibt Kennung und Plan nicht und loest Alarm aus`, async () => {
    await mitHermes(async (h) => {
      await zweiMalAbonniert(h);
      const vorher = h.store.tenantSubscription(KUNDE_TENANT);
      const antwort = await h.sende(aboEreignis(typ, ABO_A, ZUM_KUNDEN));
      assert.equal(antwort.status, 200);
      const nachher = h.store.tenantSubscription(KUNDE_TENANT);
      assert.deepEqual(nachher, vorher);
      assert.equal(h.sms.length, 1);
      assert.equal(h.sms[0].to, ALARM_NUMMER);
      assert.equal(
        h.sms[0].body,
        `[Hermes] Abweichendes Abo: tenant=${KUNDE_TENANT} gespeichert=${ABO_B} ereignis=${ABO_A}`,
      );
      assert.deepEqual(
        h.protokoll.filter(([aktion]) => aktion === "stripe_webhook_subscription_conflict"),
        [["stripe_webhook_subscription_conflict", `tenant=${KUNDE_TENANT} stored=${ABO_B} event=${ABO_A}`]],
      );
    });
  });
}

test("abweichende Kennung: Kuendigungsvormerkung fuer anderes Abo aendert nichts und loest Alarm aus", async () => {
  await mitHermes(async (h) => {
    await zweiMalAbonniert(h);
    const vorher = h.store.tenantSubscription(KUNDE_TENANT);
    const ereignis = aboEreignis("customer.subscription.updated", ABO_A, ZUM_KUNDEN);
    ereignis.data.object.cancel_at_period_end = true;
    assert.equal((await h.sende(ereignis)).status, 200);
    assert.deepEqual(h.store.tenantSubscription(KUNDE_TENANT), vorher);
    assert.equal(h.sms.length, 1);
  });
});

test("gleiche Kennung wie gespeichert: Plan wird gesetzt, kein Alarm", async () => {
  await mitHermes(async (h) => {
    await zweiMalAbonniert(h);
    const antwort = await h.sende(aboEreignis("customer.subscription.updated", ABO_B, { ...ZUM_KUNDEN, plan_slug: "starter" }));
    assert.equal(antwort.status, 200);
    assert.equal(h.store.tenantSubscription(KUNDE_TENANT).planSlug, "starter");
    assert.equal(h.sms.length, 0);
  });
});

test("Tenant ohne gespeicherte Kennung: created setzt Kennung und Plan, kein Alarm", async () => {
  await mitHermes(async (h) => {
    assert.equal((await h.abonnieren("starter")).status, 502);
    assert.equal((await h.sende(aboEreignis("customer.subscription.created", ABO_A, ZUM_KUNDEN))).status, 200);
    const abo = h.store.tenantSubscription(KUNDE_TENANT);
    assert.equal(abo.subscriptionId, ABO_A);
    assert.equal(abo.planSlug, "starter");
    assert.equal(h.sms.length, 0);
  });
});

test("Ende eines anderen Abos loest keinen Abweichungs-Alarm aus", async () => {
  await mitHermes(async (h) => {
    await zweiMalAbonniert(h);
    assert.equal((await h.sende(aboEreignis("customer.subscription.deleted", ABO_A, ZUM_KUNDEN))).status, 200);
    assert.equal(h.sms.length, 0);
  });
});

test("Ereignis ohne Abo-Kennung fuer Tenant mit Kennung: Plan wird gesetzt, kein Alarm", async () => {
  await mitHermes(async (h) => {
    await zweiMalAbonniert(h);
    const ereignis = aboEreignis("customer.subscription.updated", undefined, ZUM_KUNDEN);
    assert.equal((await h.sende(ereignis)).status, 200);
    assert.equal(h.store.tenantSubscription(KUNDE_TENANT).planSlug, "starter");
    assert.equal(h.sms.length, 0);
  });
});
