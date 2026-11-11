import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";

import { STRIPE_LESEN_SCHLUESSEL, STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { dauerPunkte, mitTelemetrie, zaehlerPunkte } from "../gemeinsam/anbieter-messung-export.mjs";

const HTTP_OK = 200;
const HTTP_ZU_VIELE = 429;
const HTTP_FEHLER = 500;
const TENANT = "t_lesen";
const KUNDE = "cus_lesen";
const KARTE = "pm_lesen";
const ABO = "sub_lesen";
const FEHLERTEXT_MIT_429 = "interner Fehler 429 fuer kunde-lesen@example.test";
const JSON_KOPF = { "content-type": "application/json" };
const MS_JE_SEKUNDE = 1000;
const WEBHOOK_PFAD = "/webhooks/stripe";

const ABO_PFAD = "/v1/subscriptions/";
const KARTEN_PFAD = "/v1/payment_methods/";

const stripeAntworten = { abweichung: null, anfragen: [] };
const stripeStub = http.createServer((req, res) => {
  req.resume();
  const pfad = new URL(req.url, "http://stub").pathname;
  stripeAntworten.anfragen.push(pfad);
  const abweichung = stripeAntworten.abweichung;
  if (abweichung && pfad.startsWith(abweichung.ziel))
    return res.writeHead(abweichung.status, JSON_KOPF).end(JSON.stringify({ error: { message: abweichung.text } }));
  const body =
    pfad.startsWith(ABO_PFAD)
      ? { status: "active", cancel_at_period_end: true, metadata: { plan_slug: "starter" }, latest_invoice: { total: 0 } }
      : { type: "card" };
  res.writeHead(HTTP_OK, JSON_KOPF).end(JSON.stringify(body));
});
await new Promise((bereit) => stripeStub.listen(0, "127.0.0.1", bereit));

process.env.STRIPE_API_BASE = `http://127.0.0.1:${stripeStub.address().port}`;
process.env.STRIPE_SECRET_KEY = STRIPE_LESEN_SCHLUESSEL;

const { starteHermesMitPglite } = await import("../abrechnung/server-mit-testdatenbank.js");
const { starteTelemetrie } = await import("../../src/utils/telemetrie.js");

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "" });
const { config } = await import("../../src/config.js");
const store = await import("../../src/store.js");

after(async () => {
  await new Promise((fertig) => stripeStub.close(fertig));
});

let zaehler = 0;

function ereignis({ id, tenantId, abo }) {
  const gemeinsam = { id: `${ABO}_${tenantId}`, status: "active", metadata: { tenant_ref: tenantId, plan_slug: "starter" } };
  const objekt = abo
    ? { ...gemeinsam, cancel_at_period_end: true }
    : { ...gemeinsam, customer: KUNDE, default_payment_method: `${KARTE}_${tenantId}` };
  return JSON.stringify({ id, type: "customer.subscription.updated", created: Math.floor(Date.now() / MS_JE_SEKUNDE), data: { object: objekt } });
}

async function webhookLauf({ abo }) {
  Object.assign(config.billing, { paymentEnabled: true, stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS });
  zaehler += 1;
  const tenantId = `${TENANT}_${zaehler}`;
  store.load().tenants.push({ id: tenantId, status: "active" });
  store.setTenantStripe(tenantId, { customerId: KUNDE });
  store.save();
  await store.drainFlushes();
  const body = ereignis({ id: `evt_lesen_${zaehler}`, tenantId, abo });
  const zeit = Math.floor(Date.now() / MS_JE_SEKUNDE);
  const mac = crypto.createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${body}`).digest("hex");
  const res = await laufendesHermes().anfrage(WEBHOOK_PFAD, {
    method: "POST",
    headers: { ...JSON_KOPF, "stripe-signature": `t=${zeit},v1=${mac}` },
    body,
  });
  return { status: res.status, koerper: await res.json() };
}

const FAELLE = [
  { vorgang: "abo-lesen", pfad: ABO_PFAD, lauf: () => webhookLauf({ abo: true }) },
  { vorgang: "zahlart-lesen", pfad: KARTEN_PFAD, lauf: () => webhookLauf({ abo: false }) },
];

async function gemessen(lauf) {
  return mitTelemetrie(starteTelemetrie, async ({ telemetrie, exporte }) => {
    const ergebnis = await lauf(telemetrie);
    await telemetrie.spuele();
    return { ergebnis, exporte };
  });
}

async function ruf(fall, abweichung) {
  stripeAntworten.abweichung = abweichung ? { ziel: fall.pfad, ...abweichung } : null;
  stripeAntworten.anfragen = [];
  const messung = await gemessen(fall.lauf);
  return { ...messung, aufrufe: stripeAntworten.anfragen.filter((pfad) => pfad.startsWith(fall.pfad)).length };
}

const zaehlungVon = (exporte, vorgang) => zaehlerPunkte(exporte).filter((p) => p.vorgang === vorgang);
const dauerVon = (exporte, vorgang) => dauerPunkte(exporte).filter((p) => p.attribute.vorgang === vorgang);

for (const fall of FAELLE) {
  test(`${fall.vorgang}: Erfolg zaehlt ok, genau ein Dauer-Eintrag je Aufruf mit nur anbieter und vorgang`, async () => {
    const { exporte, aufrufe } = await ruf(fall);
    assert.ok(aufrufe >= 1);
    assert.deepEqual(zaehlungVon(exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "ok", wert: aufrufe },
    ]);
    assert.deepEqual(dauerVon(exporte, fall.vorgang), [
      { attribute: { anbieter: "stripe", vorgang: fall.vorgang }, anzahl: aufrufe },
    ]);
  });

  test(`${fall.vorgang}: Stripe 500 zaehlt fehler, Stripe 429 zaehlt 429`, async () => {
    const fehler = await ruf(fall, { status: HTTP_FEHLER, text: "kaputt" });
    assert.deepEqual(zaehlungVon(fehler.exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "fehler", wert: fehler.aufrufe },
    ]);
    const gedrosselt = await ruf(fall, { status: HTTP_ZU_VIELE, text: "zu viele" });
    assert.deepEqual(zaehlungVon(gedrosselt.exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "429", wert: gedrosselt.aufrufe },
    ]);
  });

  test(`${fall.vorgang}: 500 mit 429 im Text zaehlt fehler, der Text steht nicht im Export`, async () => {
    const { exporte, aufrufe } = await ruf(fall, { status: HTTP_FEHLER, text: FEHLERTEXT_MIT_429 });
    assert.deepEqual(zaehlungVon(exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "fehler", wert: aufrufe },
    ]);
    const text = JSON.stringify(exporte);
    for (const verboten of ["kunde-lesen@example.test", KUNDE, KARTE, ABO, TENANT])
      assert.ok(!text.includes(verboten), `Export enthaelt ${verboten}`);
  });
}

test("Antwort der Route bleibt mit und ohne Messung gleich, bei Erfolg und bei Stripe 429", async () => {
  for (const fall of FAELLE) {
    for (const abweichung of [undefined, { status: HTTP_ZU_VIELE, text: "zu viele" }]) {
      stripeAntworten.abweichung = abweichung ? { ziel: fall.pfad, ...abweichung } : null;
      const ohne = await fall.lauf();
      assert.equal(ohne.status, HTTP_OK, fall.vorgang);
      const { ergebnis } = await ruf(fall, abweichung);
      assert.deepEqual(ergebnis, ohne, fall.vorgang);
    }
  }
});

test("Wirft das Erfassen, bleibt die Antwort gleich und die Logzeilen nennen nur anbieter und vorgang", async () => {
  for (const fall of FAELLE) {
    stripeAntworten.abweichung = null;
    const ohne = await fall.lauf();
    const { ergebnis } = await gemessen(async (telemetrie) => {
      mock.method(telemetrie, "messeAnbieter", () => {
        throw new Error("Erfassen kaputt kunde-lesen@example.test");
      });
      const warnung = mock.method(console, "warn", () => {});
      const res = await fall.lauf();
      const zeilen = warnung.mock.calls.map((aufruf) => String(aufruf.arguments[0]));
      warnung.mock.restore();
      return { res, zeilen };
    });
    assert.deepEqual(ergebnis.res, ohne, fall.vorgang);
    assert.ok(ergebnis.zeilen.includes(`[anbieter-messung] Erfassen fehlgeschlagen anbieter=stripe vorgang=${fall.vorgang}`));
    assert.ok(ergebnis.zeilen.every((z) => /^\[anbieter-messung\] Erfassen fehlgeschlagen anbieter=stripe vorgang=[a-z-]+$/.test(z)));
  }
});
