import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { starteHermesMitPglite, LOGIN_SUB } from "../abrechnung/server-mit-testdatenbank.js";
import { STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";

const HTTP_OK = 200;
const HTTP_CONFLICT = 409;
const MS_PER_S = 1000;
const NUMMERN_OBERGRENZE = 100;
const TENANT = "t_tausch_wege";
const ALTE_NUMMER = "+4915799990003";
const ERSATZ_NUMMER = "+12025550133";
const JSON_KOPF = { "content-type": "application/json" };

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "" });
const { config } = await import("../../src/config.js");
const store = await import("../../src/store.js");
const { runNummerntausch } = await import("../../src/worker/nummerntausch.js");

async function mandantMitDeutscherNummer() {
  store.load().tenants.push({ id: TENANT, status: "active", kycLevel: "card", ownerName: "Tausch Tester" });
  store.load().numbers.push({
    id: "num_tausch_wege",
    tenantId: TENANT,
    e164: ALTE_NUMMER,
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_alt_wege",
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  store.save();
  await store.drainFlushes();
  Object.assign(config.provisioning, {
    provisioningEnabled: true,
    maxNumbers: NUMMERN_OBERGRENZE,
    maxNumbersPerTenant: 1,
  });
  Object.assign(config.billing, { paymentEnabled: true, stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS });
}

async function betreiberAnfrage(pfad, koerper) {
  const hermes = laufendesHermes();
  const { sessionCookie } = await hermes.anmelden();
  await hermes.db.query(
    "UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)",
    [LOGIN_SUB],
  );
  return hermes.anfrage(pfad, {
    method: "POST",
    headers: { ...JSON_KOPF, cookie: sessionCookie },
    body: JSON.stringify(koerper),
  });
}

async function zahlungSenden() {
  const rumpf = JSON.stringify({
    type: "customer.subscription.created",
    data: {
      object: { id: `sub_${TENANT}`, status: "active", metadata: { tenant_ref: TENANT, plan_slug: "starter" } },
    },
  });
  const zeit = Math.floor(Date.now() / MS_PER_S);
  const mac = crypto.createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${rumpf}`).digest("hex");
  return laufendesHermes().anfrage("/webhooks/stripe", {
    method: "POST",
    headers: { ...JSON_KOPF, "stripe-signature": `t=${zeit},v1=${mac}` },
    body: rumpf,
  });
}

function nummernDesMandanten() {
  return store.load().numbers.filter((nummer) => nummer.tenantId === TENANT);
}

async function pruefeAlleWegeGesperrt() {
  const onboard = await betreiberAnfrage("/api/onboard", { tenantId: TENANT });
  assert.equal(onboard.status, HTTP_CONFLICT);
  const retry = await betreiberAnfrage("/api/onboard/retry", { tenantId: TENANT });
  assert.equal(retry.status, HTTP_CONFLICT);
  assert.match((await retry.json()).error, /already_provisioned/);
  const zahlung = await zahlungSenden();
  assert.equal(zahlung.status, HTTP_OK);
}

test("Kriterium 12: Mandant mit +49-Nummer bleibt fuer Onboarding, Wiederholung und Zahlung gesperrt, auch nach dem Tausch", async () => {
  await mandantMitDeutscherNummer();

  await pruefeAlleWegeGesperrt();
  assert.equal(nummernDesMandanten().length, 1, "die normalen Wege legen keine zweite Nummer an");

  const anbieter = {
    searchNumbers: async () => [{ e164: ERSATZ_NUMMER }],
    orderNumber: async ({ e164 }) => ({ e164, providerNumberId: "pnum_neu_wege" }),
  };
  await runNummerntausch({
    store,
    config,
    numberProvisioning: () => anbieter,
    sipRegistrar: null,
    inboundTrunkSchreiber: null,
    logger: { log() {}, warn() {}, error() {} },
  });

  assert.equal(nummernDesMandanten().filter((nummer) => nummer.status === "active").length, 2);
  await pruefeAlleWegeGesperrt();
  assert.equal(nummernDesMandanten().length, 2, "auch nach dem Tausch entsteht ueber die Wege keine weitere Nummer");
});
