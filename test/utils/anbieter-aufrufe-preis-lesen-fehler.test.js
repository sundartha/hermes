import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { STRIPE_LESEN_SCHLUESSEL, STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { mitTelemetrie } from "../gemeinsam/anbieter-messung-export.mjs";

const HTTP_FEHLER = 500;
const PREIS_STARTER = "price_fehler_starter";
const PREIS_BUSINESS = "price_fehler_business";
const FEHLERTEXT_MIT_429 = "interner Fehler 429 fuer kunde-preis@example.test";
const JSON_KOPF = { "content-type": "application/json" };

let aufrufe = 0;
const stripeStub = http.createServer((req, res) => {
  req.resume();
  aufrufe += 1;
  res.writeHead(HTTP_FEHLER, JSON_KOPF).end(JSON.stringify({ error: { message: FEHLERTEXT_MIT_429 } }));
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

const boot = await mitTelemetrie(starteTelemetrie, async ({ telemetrie }) => {
  const erfasst = [];
  mock.method(telemetrie, "messeAnbieter", (aufruf) => {
    erfasst.push(aufruf);
    throw new Error("Erfassen kaputt kunde-preis@example.test");
  });
  const logzeilen = [];
  mock.method(console, "log", (...teile) => logzeilen.push(teile.join(" ")));
  const warnzeilen = [];
  mock.method(console, "warn", (...teile) => warnzeilen.push(teile.join(" ")));
  await starteHermesMitPglite({ alarmPostfach: "" });
  await waitUntil(() => logzeilen.some((zeile) => zeile.startsWith("[price-drift]")));
  mock.restoreAll();
  return { erfasst, logzeilen, warnzeilen };
});

test("preis-lesen: Stripe 500 mit 429 im Text wird als fehler gemessen", () => {
  assert.equal(aufrufe, 2);
  assert.deepEqual(
    boot.erfasst.map((aufruf) => [aufruf.anbieter, aufruf.vorgang, aufruf.ergebnis]),
    [
      ["stripe", "preis-lesen", "fehler"],
      ["stripe", "preis-lesen", "fehler"],
    ],
  );
  assert.ok(boot.erfasst.every((aufruf) => aufruf.dauerMs >= 0));
  assert.ok(!JSON.stringify(boot.erfasst).includes("kunde-preis@example.test"));
});

test("preis-lesen: wirft das Erfassen, laeuft die Preisprobe weiter und die Logzeilen nennen nur anbieter und vorgang", () => {
  assert.ok(boot.logzeilen.includes("[price-drift] anlass=boot geprueft=2 abweichungen=0 unbekannt=2"), boot.logzeilen.join("|"));
  const messzeilen = boot.warnzeilen.filter((zeile) => zeile.startsWith("[anbieter-messung]"));
  assert.deepEqual(messzeilen, [
    "[anbieter-messung] Erfassen fehlgeschlagen anbieter=stripe vorgang=preis-lesen",
    "[anbieter-messung] Erfassen fehlgeschlagen anbieter=stripe vorgang=preis-lesen",
  ]);
});
