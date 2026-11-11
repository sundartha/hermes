import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { importNachUmgebung } from "../gemeinsam/umgebung-import.js";
import anfrageMitFrist from "../gemeinsam/anfrage-mit-frist.mjs";
import request from "../gemeinsam/testserver-anfrage.mjs";
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

let config, wireWebLogin, installGlobalMiddleware, webAuth, makePgTestStore, BOOTSTRAP_TENANT_ID, withStripeStub;

before(async () => {
  let makeStripeStub;
  [{ config }, { wireWebLogin }, { installGlobalMiddleware }, webAuth, { makePgTestStore, BOOTSTRAP_TENANT_ID }, { makeStripeStub }] =
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


const ALT = "sub_ende_alt";
const NEU = "sub_ende_neu";

function mitHermes(fn) {
  return withStripeStub(async () => new Response("{}", { status: 404 }), async () => {
    const { store, runner } = await makePgTestStore();
    const protokoll = [];
    const messaging = () => ({ sendSms: async () => {} });
    const { accounts, cookie } = await kundeOhneAbo(store, runner);
    const { basis, schliessen } = await hermesStarten({ store, runner, protokoll, messaging });
    try {
      return await fn({ store, runner, accounts, cookie, protokoll, sende: (ereignis) => signiertSenden(basis, ereignis) });
    } finally {
      await schliessen();
    }
  });
}

async function aktivMit(h, gespeichert) {
  await h.accounts.setStatus(KUNDE_TENANT, "active");
  const patch = { cancelAtPeriodEnd: true, planSlug: "starter" };
  if (gespeichert) patch.subscriptionId = gespeichert;
  h.store.setTenantSubscription(KUNDE_TENANT, patch);
}

function ereignis(typ, object) {
  return {
    id: `evt_ende_${crypto.randomUUID()}`,
    type: typ,
    created: Math.floor(Date.now() / MS_PER_S),
    data: { object: { customer: STRIPE_KUNDE, metadata: { tenant_ref: KUNDE_TENANT }, ...object } },
  };
}

const geloescht = (kennung) => ereignis("customer.subscription.deleted", { id: kennung, status: "canceled" });
const zahlungFehlt = (kennung) => ereignis("invoice.payment_failed", kennung ? { subscription: kennung } : {});
const status = (h) =>
  h.runner.withClient(async (c) => (await c.query("SELECT status FROM tenant WHERE id = $1", [KUNDE_TENANT])).rows[0].status);

test("Ende eines alten Abos sperrt den Tenant mit anderem gespeicherten Abo nicht", async () => {
  await mitHermes(async (h) => {
    await aktivMit(h, NEU);
    const vorher = h.store.tenantSubscription(KUNDE_TENANT);
    assert.equal((await h.sende(geloescht(ALT))).status, 200);
    assert.equal(await status(h), "active");
    assert.deepEqual(h.store.tenantSubscription(KUNDE_TENANT), vorher);
    assert.equal(h.store.tenantSubscription(KUNDE_TENANT).subscriptionId, NEU);
    assert.equal(h.store.tenantSubscription(KUNDE_TENANT).cancelAtPeriodEnd, true);
    assert.deepEqual(
      h.protokoll.filter(([aktion]) => aktion === "stripe_webhook_ignored"),
      [["stripe_webhook_ignored", `action=suspend tenant=${KUNDE_TENANT} reason=not_held_subscription`]],
    );
    assert.equal(h.protokoll.some(([aktion]) => aktion === "stripe_webhook_suspend"), false);
  });
});

test("Ende des gespeicherten Abos sperrt und leert die Kennung", async () => {
  await mitHermes(async (h) => {
    await aktivMit(h, ALT);
    assert.equal((await h.sende(geloescht(ALT))).status, 200);
    assert.equal(await status(h), "suspended");
    assert.equal(h.store.tenantSubscription(KUNDE_TENANT).subscriptionId, null);
  });
});

test("Ende eines Abos bei leerer gespeicherter Kennung sperrt weiterhin", async () => {
  await mitHermes(async (h) => {
    await aktivMit(h, null);
    assert.equal((await h.sende(geloescht(ALT))).status, 200);
    assert.equal(await status(h), "suspended");
  });
});

test("fehlgeschlagene Zahlung eines alten Abos sperrt den Tenant mit anderem gespeicherten Abo nicht", async () => {
  await mitHermes(async (h) => {
    await aktivMit(h, NEU);
    assert.equal((await h.sende(zahlungFehlt(ALT))).status, 200);
    assert.equal(await status(h), "active");
    assert.equal(h.store.tenantSubscription(KUNDE_TENANT).subscriptionId, NEU);
  });
});

test("fehlgeschlagene Zahlung ohne Abo-Kennung sperrt weiterhin und behaelt die Kennung", async () => {
  await mitHermes(async (h) => {
    await aktivMit(h, NEU);
    assert.equal((await h.sende(zahlungFehlt(null))).status, 200);
    assert.equal(await status(h), "suspended");
    assert.equal(h.store.tenantSubscription(KUNDE_TENANT).subscriptionId, NEU);
  });
});
