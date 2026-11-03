import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { importNachUmgebung } from "../gemeinsam/umgebung-import.js";
import anfrageMitFrist from "../gemeinsam/anfrage-mit-frist.mjs";
import request from "../gemeinsam/testserver-anfrage.mjs";
import { STRIPE_ROUTEN_GEHEIMNIS, WEB_SITZUNGS_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";

const ERWARTETER_FEHLER = "Abo mit abgerissener Antwort hat nach dem Webhook keinen Plan";
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
const STARTER_DECKE_CENT = 300;
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
  withStripeStub = makeStripeStub(config, STRIPE_SCHLUESSEL);
});

function metadatenAus(aboAnlage) {
  const felder = [...aboAnlage].filter(([schluessel]) => METADATUM.test(schluessel));
  return Object.fromEntries(felder.map(([schluessel, wert]) => [schluessel.match(METADATUM)[1], wert]));
}

function stripeMitAbgerissenerAntwort() {
  const aboKennung = `sub_abo_plan_${crypto.randomUUID()}`;
  const aboAnlagen = [];
  const aufgezeichneteMetadaten = () => {
    if (aboAnlagen.length !== 1) throw new Error(`Testaufbau: ${aboAnlagen.length} Abo-Anlagen bei Stripe statt 1`);
    return metadatenAus(aboAnlagen[0]);
  };
  const abrufen = async (url, optionen = {}) => {
    const ziel = String(url);
    const abos = `${config.billing.stripeApiBase}/v1/subscriptions`;
    if (ziel === abos && optionen.method === "POST") {
      aboAnlagen.push(new URLSearchParams(String(optionen.body)));
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
    }
    if (ziel.startsWith(`${abos}/${aboKennung}`)) {
      const abo = { id: aboKennung, status: "active", cancel_at_period_end: false, latest_invoice: { total: 1900 } };
      return Response.json({ ...abo, metadata: aufgezeichneteMetadaten() });
    }
    return new Response("{}", { status: 404 });
  };
  return { aboKennung, abrufen, aboAnlagen, aufgezeichneteMetadaten };
}

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

async function hermesStarten({ store, runner, protokoll }) {
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

function mitHermes(fn) {
  const stripe = stripeMitAbgerissenerAntwort();
  return withStripeStub(stripe.abrufen, async () => {
    const { store, runner } = await makePgTestStore();
    const protokoll = [];
    const { accounts, cookie } = await kundeOhneAbo(store, runner);
    const { basis, schliessen } = await hermesStarten({ store, runner, protokoll });
    const abonnieren = (plan) => request("POST", `${basis}/api/self-service/billing/subscribe`, { cookie, body: { plan } });
    const sendeSigniert = (ereignis) => signiertSenden(basis, ereignis);
    try {
      return await fn({ store, accounts, protokoll, stripe, abonnieren, sendeSigniert });
    } finally {
      await schliessen();
    }
  });
}

function aboAngelegt(aboKennung, metadata) {
  return {
    id: `evt_abo_plan_${crypto.randomUUID()}`,
    type: "customer.subscription.created",
    created: Math.floor(Date.now() / MS_PER_S),
    data: { object: { id: aboKennung, status: "active", customer: STRIPE_KUNDE, metadata } },
  };
}

const budgetZeile = (store) => (store.load().tenantBudgets || []).find((zeile) => zeile.tenantId === KUNDE_TENANT);

test("abo-plan: Abo mit abgerissener Stripe-Antwort bekommt seinen Plan aus dem signierten created", async () => {
  await mitHermes(async ({ store, stripe, abonnieren, sendeSigniert }) => {
    assert.equal((await abonnieren("starter")).status, 502);
    const webhook = await sendeSigniert(aboAngelegt(stripe.aboKennung, stripe.aufgezeichneteMetadaten()));
    assert.equal(webhook.status, 200);
    assert.equal(store.tenantSubscription(KUNDE_TENANT).planSlug, "starter", ERWARTETER_FEHLER);
  });
});

test("[NIE1] abgerissene Stripe-Antwort: 502 billing_unavailable, weder Abo-Kennung noch Plan gespeichert", async () => {
  await mitHermes(async ({ store, stripe, abonnieren }) => {
    const antwort = await abonnieren("starter");
    assert.equal(antwort.status, 502);
    assert.deepEqual(JSON.parse(antwort.body), { error: "billing_unavailable" });
    assert.equal(stripe.aboAnlagen.length, 1, "Stripe hat die Abo-Anlage erhalten");
    const abo = store.tenantSubscription(KUNDE_TENANT);
    assert.equal(abo.subscriptionId, null, "keine erfundene Abo-Kennung");
    assert.equal(abo.planSlug, null, "kein Plan ohne Bestätigung");
  });
});

test("[NIE2] signiertes created mit unbekanntem plan_slug setzt keinen Plan und schaltet nicht frei", async () => {
  await mitHermes(async ({ store, accounts, protokoll, stripe, sendeSigniert }) => {
    const webhook = await sendeSigniert(aboAngelegt(stripe.aboKennung, { tenant_ref: KUNDE_TENANT, plan_slug: "gold" }));
    assert.equal(webhook.status, 200);
    assert.equal(store.tenantSubscription(KUNDE_TENANT).planSlug, null);
    assert.equal(store.tenantSubscription(KUNDE_TENANT).subscriptionId, null);
    assert.equal((await accounts.resolve(KUNDE_SUB)).status, "suspended", "Mandant bleibt gesperrt");
    assert.deepEqual(
      protokoll.filter(([action]) => action === "stripe_webhook_ignored"),
      [["stripe_webhook_ignored", `action=activate tenant=${KUNDE_TENANT} unknown_plan`]],
    );
  });
});

test("[NIE3] nach dem Abriss nichts im Store, erst das created aus den aufgezeichneten Metadaten setzt starter mit 300 ct", async () => {
  await mitHermes(async ({ store, stripe, abonnieren, sendeSigniert }) => {
    assert.equal((await abonnieren("starter")).status, 502);
    const vorher = store.tenantSubscription(KUNDE_TENANT);
    assert.equal(vorher.subscriptionId, null, "keine Abo-Kennung vor dem Webhook");
    assert.equal(vorher.planSlug, null, "kein Plan vor dem Webhook");
    assert.equal(budgetZeile(store), undefined, "keine Budget-Zeile vor dem Webhook");
    const webhook = await sendeSigniert(aboAngelegt(stripe.aboKennung, stripe.aufgezeichneteMetadaten()));
    assert.equal(webhook.status, 200);
    const nachher = store.tenantSubscription(KUNDE_TENANT);
    assert.equal(nachher.subscriptionId, stripe.aboKennung);
    assert.equal(nachher.planSlug, "starter", "Plan folgt den Metadaten der Abo-Anlage");
    assert.equal(store.tenantBudgetSnapshot(KUNDE_TENANT, config.billing).capCents, STARTER_DECKE_CENT);
  });
});
