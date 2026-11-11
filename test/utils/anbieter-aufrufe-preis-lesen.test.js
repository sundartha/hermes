import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { STRIPE_LESEN_SCHLUESSEL, STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { dauerPunkte, mitTelemetrie, zaehlerPunkte } from "../gemeinsam/anbieter-messung-export.mjs";

const HTTP_OK = 200;
const HTTP_ZU_VIELE = 429;
const PREIS_STARTER = "price_lesen_starter";
const PREIS_BUSINESS = "price_lesen_business";
const JSON_KOPF = { "content-type": "application/json" };
const PREISE = {
  [`/v1/prices/${PREIS_STARTER}`]: { unit_amount: 499, currency: "eur" },
  [`/v1/prices/${PREIS_BUSINESS}`]: { unit_amount: 999, currency: "eur" },
};

let aufrufe = 0;
const stripeStub = http.createServer((req, res) => {
  req.resume();
  const pfad = new URL(req.url, "http://stub").pathname;
  aufrufe += 1;
  if (pfad.endsWith(PREIS_BUSINESS))
    return res.writeHead(HTTP_ZU_VIELE, JSON_KOPF).end(JSON.stringify({ error: { message: "zu viele" } }));
  res.writeHead(HTTP_OK, JSON_KOPF).end(JSON.stringify(PREISE[pfad]));
});
await new Promise((bereit) => stripeStub.listen(0, "127.0.0.1", bereit));

Object.assign(process.env, {
  STRIPE_API_BASE: `http://127.0.0.1:${stripeStub.address().port}`,
  STRIPE_SECRET_KEY: STRIPE_LESEN_SCHLUESSEL,
  STRIPE_WEBHOOK_SECRET: STRIPE_ROUTEN_GEHEIMNIS,
  STRIPE_STARTER_PRICE_ID: PREIS_STARTER,
  STRIPE_BUSINESS_PRICE_ID: PREIS_BUSINESS,
  PAYMENT_ENABLED: "true",
  NUMBER_SETUP_FEE_CENTS: "500",
  PLATFORM_SPEND_WARN_PERCENT: "0",
});

const { starteHermesMitPglite } = await import("../abrechnung/server-mit-testdatenbank.js");
const { waitUntil } = await import("../helpers.js");
const { starteTelemetrie } = await import("../../src/utils/telemetrie.js");

after(async () => {
  await new Promise((fertig) => stripeStub.close(fertig));
});

const boot = await mitTelemetrie(starteTelemetrie, async ({ telemetrie, exporte }) => {
  const logzeilen = [];
  mock.method(console, "log", (...teile) => logzeilen.push(teile.join(" ")));
  await starteHermesMitPglite({ alarmPostfach: "" });
  await waitUntil(() => logzeilen.some((zeile) => zeile.startsWith("[price-drift]")));
  mock.restoreAll();
  await telemetrie.spuele();
  return { exporte, logzeilen };
});

test("preis-lesen: ein Aufruf zaehlt ok, einer mit Stripe 429 zaehlt 429", () => {
  const punkte = zaehlerPunkte(boot.exporte).sort((a, b) => a.ergebnis.localeCompare(b.ergebnis));
  assert.deepEqual(punkte, [
    { anbieter: "stripe", vorgang: "preis-lesen", ergebnis: "429", wert: 1 },
    { anbieter: "stripe", vorgang: "preis-lesen", ergebnis: "ok", wert: 1 },
  ]);
});

test("preis-lesen: jeder Aufruf erzeugt einen Dauer-Eintrag mit nur anbieter und vorgang", () => {
  assert.deepEqual(dauerPunkte(boot.exporte), [
    { attribute: { anbieter: "stripe", vorgang: "preis-lesen" }, anzahl: 2 },
  ]);
  const text = JSON.stringify(boot.exporte);
  for (const verboten of [PREIS_STARTER, PREIS_BUSINESS, "zu viele"]) assert.ok(!text.includes(verboten), verboten);
});

test("preis-lesen: die Preisprobe beim Start meldet den Befund wie ohne Messung", () => {
  assert.ok(
    boot.logzeilen.includes("[price-drift] anlass=boot geprueft=2 abweichungen=0 unbekannt=1"),
    boot.logzeilen.join("|"),
  );
});
