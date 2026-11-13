import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { STRIPE_ROUTEN_GEHEIMNIS } from "./erfundene-geheimnisse.js";
import { wertVon, zeitpunkt } from "./kennzahlen-anrufe.js";

const ROLLE = "kennzahlen_leser";
const ADRESSE = "postgres://kennzahlen-leser-attrappe.invalid/hermes";
const WEBHOOK_PFAD = "/webhooks/stripe";
const MS_PER_S = 1000;
const HTTP_OK = 200;

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: [ROLLE],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
  unterKennzahlenLeser: true,
  kennzahlenAdresse: ADRESSE,
  ohneStartanruf: true,
});
const { config } = await import("../../src/config.js");
const store = await import("../../src/store.js");
Object.assign(config.billing, { paymentEnabled: true, stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS });

async function takt() {
  await store.kennzahlenTakt();
  return store.kennzahlenMomentaufnahme();
}

async function kundeMitKonto(kennung, tageVorher) {
  const { db } = laufendesHermes();
  const tenantId = `t_${kennung}`;
  store.load().tenants.push({ id: tenantId, status: "suspended", firstName: kennung, ownerName: kennung });
  store.save();
  await store.drainFlushes();
  await db.query("INSERT INTO account (sub, email, tenant_id, created_at) VALUES ($1, $2, $3, $4)", [
    `sub_${kennung}`,
    `${kennung}@kennzahlen.invalid`,
    tenantId,
    zeitpunkt(tageVorher, "08:00:00"),
  ]);
  return tenantId;
}

async function stripeSenden(ereignis) {
  const rumpf = JSON.stringify(ereignis);
  const zeit = Math.floor(Date.now() / MS_PER_S);
  const mac = crypto.createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${rumpf}`).digest("hex");
  const antwort = await laufendesHermes().anfrage(WEBHOOK_PFAD, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${zeit},v1=${mac}` },
    body: rumpf,
  });
  assert.equal(antwort.status, HTTP_OK);
}

async function aboAnlegen(tenantId, abo, plan) {
  await stripeSenden({
    type: "customer.subscription.created",
    data: { object: { id: abo, status: "active", metadata: { tenant_ref: tenantId, plan_slug: plan } } },
  });
}

test("S6: zwei Kunden mit Konto von heute und einer von gestern ergeben anmeldungen_heute 2", async () => {
  const vorher = wertVon(await takt(), "anmeldungen_heute");
  await kundeMitKonto("heute_a", 0);
  await kundeMitKonto("heute_b", 0);
  await kundeMitKonto("gestern", 1);
  assert.equal(wertVon(await takt(), "anmeldungen_heute") - vorher, 2);
});

test("S19: nach invoice.payment_failed zählt das Abo starter nicht mehr", async () => {
  const tenantId = await kundeMitKonto("zahlt_nicht", 3);
  await aboAnlegen(tenantId, "sub_zahlt_nicht", "starter");
  assert.equal(wertVon(await takt(), "abos", { plan: "starter" }), 1);
  await stripeSenden({
    type: "invoice.payment_failed",
    data: { object: { subscription: "sub_zahlt_nicht", customer: "cus_zahlt_nicht", metadata: { tenant_ref: tenantId } } },
  });
  assert.equal(wertVon(await takt(), "abos", { plan: "starter" }), 0);
});

test("S7: zwei Kunden mit starter, einer mit business und einer ohne Abo ergeben abos 2 und 1", async () => {
  for (const [kennung, plan] of [["s1", "starter"], ["s2", "starter"], ["b1", "business"]]) {
    await aboAnlegen(await kundeMitKonto(kennung, 4), `sub_${kennung}`, plan);
  }
  await kundeMitKonto("ohne_abo", 4);
  const zeilen = await takt();
  assert.equal(wertVon(zeilen, "abos", { plan: "starter" }), 2);
  assert.equal(wertVon(zeilen, "abos", { plan: "business" }), 1);
});
