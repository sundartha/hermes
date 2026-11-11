import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { STRIPE_RESERVIERUNG_SCHLUESSEL, TELNYX_RESERVIERUNG_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { dauerPunkte, mitTelemetrie, zaehlerPunkte } from "../gemeinsam/anbieter-messung-export.mjs";

const HTTP_OK = 200;
const HTTP_ZU_VIELE = 429;
const HTTP_FEHLER = 500;
const NUMMER_BASIS = 12025550100;
const NUMMER = "+12025550100";
const TENANT = "t_reservierung";
const INTENT = "pi_reservierung";
const FEHLERTEXT_MIT_429 = "interner Fehler 429 fuer kunde-reservierung@example.test";
const FLUSH_STICHTAG = "2000-01-01T00:00:00.000Z";
const JSON_KOPF = { "content-type": "application/json" };

const stripeAntworten = { abweichung: null };
const stripeStub = http.createServer((req, res) => {
  req.resume();
  const schluessel = `${req.method} ${req.url}`;
  const abweichung = stripeAntworten.abweichung;
  if (abweichung && abweichung.ziel === schluessel)
    return res.writeHead(abweichung.status, JSON_KOPF).end(JSON.stringify({ error: { message: abweichung.text } }));
  const body = schluessel === "POST /v1/payment_intents" ? { id: INTENT } : {};
  res.writeHead(HTTP_OK, JSON_KOPF).end(JSON.stringify(body));
});
await new Promise((bereit) => stripeStub.listen(0, "127.0.0.1", bereit));

let bestellStatus = HTTP_OK;
let nummernZaehler = 0;
const telnyxStub = http.createServer((req, res) => {
  req.resume();
  if (req.url.startsWith("/v2/available_phone_numbers"))
    return res
      .writeHead(HTTP_OK, JSON_KOPF)
      .end(JSON.stringify({ data: [{ phone_number: `+${NUMMER_BASIS + nummernZaehler++}` }] }));
  if (req.url === "/v2/number_orders" && req.method === "POST")
    return res.writeHead(bestellStatus, JSON_KOPF).end(JSON.stringify({ errors: [{ code: "20000", title: "abgelehnt" }] }));
  if (req.url.startsWith("/v2/phone_numbers")) {
    const nummer = new URL(req.url, "http://stub").searchParams.get("filter[phone_number]");
    return res.writeHead(HTTP_OK, JSON_KOPF).end(JSON.stringify({ data: [{ id: `pn_${nummer}`, phone_number: nummer }] }));
  }
  res.writeHead(HTTP_OK, JSON_KOPF).end(JSON.stringify({ data: {} }));
});
await new Promise((bereit) => telnyxStub.listen(0, "127.0.0.1", bereit));

process.env.TELNYX_API_BASE = `http://127.0.0.1:${telnyxStub.address().port}`;
process.env.TELNYX_API_KEY = TELNYX_RESERVIERUNG_SCHLUESSEL;
process.env.STRIPE_API_BASE = `http://127.0.0.1:${stripeStub.address().port}`;
process.env.STRIPE_SECRET_KEY = STRIPE_RESERVIERUNG_SCHLUESSEL;

const { starteHermesMitPglite } = await import("../abrechnung/server-mit-testdatenbank.js");
const { waitUntil } = await import("../helpers.js");
const { starteTelemetrie } = await import("../../src/utils/telemetrie.js");

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "" });
const { config } = await import("../../src/config.js");
const store = await import("../../src/store.js");
const { PAYMENT_METHOD_TYPE_CARD } = await import("../../src/billing/payment-method-eligibility.js");

after(async () => {
  await new Promise((fertig) => stripeStub.close(fertig));
  await new Promise((fertig) => telnyxStub.close(fertig));
});

const ZIEL = {
  "reservierung-anlegen": "POST /v1/payment_intents",
  "reservierung-einziehen": `POST /v1/payment_intents/${INTENT}/capture`,
  "reservierung-freigeben": `POST /v1/payment_intents/${INTENT}/cancel`,
  "verbrauch-melden": "POST /v1/billing/meter_events",
};

const JOB_OFFEN = "queued";
let tenantZaehler = 0;

let betreiberSitzung = null;
async function betreiberAnfrage(hermes, pfad, optionen = {}) {
  betreiberSitzung ??= hermes.anmelden().then(async (sitzung) => {
    await hermes.betreiberDarfAnrufen();
    return sitzung;
  });
  const { sessionCookie } = await betreiberSitzung;
  return hermes.anfrage(pfad, {
    ...optionen,
    headers: { cookie: sessionCookie, "content-type": "application/json", ...optionen.headers },
  });
}

async function onboardLauf({ bestell }) {
  bestellStatus = bestell;
  const hermes = laufendesHermes();
  Object.assign(config.billing, { paymentEnabled: true, numberSetupFeeCents: 500, paymentCurrency: "eur" });
  Object.assign(config.provisioning, {
    provisioningEnabled: true,
    provisioningCountry: "US",
    maxNumbers: 100,
    maxNumbersPerTenant: 100,
  });
  const tenantId = `${TENANT}_${tenantZaehler++}`;
  store.load().tenants.push({
    id: tenantId,
    status: "active",
    stripeCustomerId: "cus_1",
    stripePaymentMethodId: "pm_1",
    stripePaymentMethodType: PAYMENT_METHOD_TYPE_CARD,
  });
  store.save();
  await store.drainFlushes();
  const res = await betreiberAnfrage(hermes, "/api/onboard", { method: "POST", body: JSON.stringify({ tenantId }) });
  const antwort = await res.json();
  const { numberId } = antwort;
  const jobVon = () => store.load().provisioningJobs.find((job) => job.numberId === numberId);
  await waitUntil(() => jobVon() && jobVon().status !== JOB_OFFEN);
  const koerper = { country: antwort.country, language: antwort.language, provisioning: antwort.provisioning, status: antwort.status };
  const nummer = store.load().numbers.find((n) => n.id === numberId);
  const nummerStatus = nummer.status;
  const job = jobVon();
  return { status: res.status, koerper, nummerStatus, jobStatus: job.status, jobFehler: job.lastError };
}

async function verbrauchLauf() {
  const hermes = laufendesHermes();
  Object.assign(config.billing, { paymentEnabled: true, flushEpochIso: FLUSH_STICHTAG });
  const tenantId = `${TENANT}_${tenantZaehler++}`;
  store.load().tenants.push({ id: tenantId, status: "active" });
  for (const altes of store.load().usageEvents) altes.stripeMeterSent = true;
  store.load().usageEvents.push({
    id: `ue_${tenantId}`,
    tenantId,
    callId: null,
    kind: "voice_minute",
    quantity: 2,
    costCents: 0,
    occurredAt: new Date().toISOString(),
    stripeMeterSent: false,
  });
  const res = await betreiberAnfrage(hermes, "/api/billing/flush-meters", { method: "POST" });
  return { status: res.status, koerper: await res.json() };
}

const FAELLE = [
  { vorgang: "reservierung-anlegen", lauf: () => onboardLauf({ bestell: HTTP_OK }) },
  { vorgang: "reservierung-einziehen", lauf: () => onboardLauf({ bestell: HTTP_OK }) },
  { vorgang: "reservierung-freigeben", lauf: () => onboardLauf({ bestell: HTTP_FEHLER }) },
  { vorgang: "verbrauch-melden", lauf: verbrauchLauf },
];

async function gemessen(lauf) {
  return mitTelemetrie(starteTelemetrie, async ({ telemetrie, exporte }) => {
    const ergebnis = await lauf(telemetrie);
    await telemetrie.spuele();
    return { ergebnis, exporte };
  });
}

const ruf = async (fall, abweichung) => {
  stripeAntworten.abweichung = abweichung ? { ziel: ZIEL[fall.vorgang], ...abweichung } : null;
  return gemessen(fall.lauf);
};
const zaehlungVon = (exporte, vorgang) => zaehlerPunkte(exporte).filter((p) => p.vorgang === vorgang);
const dauerVon = (exporte, vorgang) => dauerPunkte(exporte).filter((p) => p.attribute.vorgang === vorgang);

for (const fall of FAELLE) {
  test(`${fall.vorgang}: Erfolg zaehlt ok, genau ein Dauer-Eintrag mit nur anbieter und vorgang`, async () => {
    const { exporte } = await ruf(fall);
    assert.deepEqual(zaehlungVon(exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "ok", wert: 1 },
    ]);
    assert.deepEqual(dauerVon(exporte, fall.vorgang), [
      { attribute: { anbieter: "stripe", vorgang: fall.vorgang }, anzahl: 1 },
    ]);
  });

  test(`${fall.vorgang}: Stripe 500 zaehlt fehler, Stripe 429 zaehlt 429`, async () => {
    const fehler = await ruf(fall, { status: HTTP_FEHLER, text: "kaputt" });
    assert.deepEqual(zaehlungVon(fehler.exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "fehler", wert: 1 },
    ]);
    const gedrosselt = await ruf(fall, { status: HTTP_ZU_VIELE, text: "zu viele" });
    assert.deepEqual(zaehlungVon(gedrosselt.exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "429", wert: 1 },
    ]);
  });

  test(`${fall.vorgang}: 500 mit 429 im Text zaehlt fehler, der Text steht nicht im Export`, async () => {
    const { exporte } = await ruf(fall, { status: HTTP_FEHLER, text: FEHLERTEXT_MIT_429 });
    assert.deepEqual(zaehlungVon(exporte, fall.vorgang), [
      { anbieter: "stripe", vorgang: fall.vorgang, ergebnis: "fehler", wert: 1 },
    ]);
    const text = JSON.stringify(exporte);
    for (const verboten of ["kunde-reservierung@example.test", NUMMER, TENANT, INTENT])
      assert.ok(!text.includes(verboten), `Export enthaelt ${verboten}`);
  });
}

test("Antwort und Ausgang bleiben mit und ohne Messung gleich, bei Erfolg und bei Stripe 429", async () => {
  for (const fall of FAELLE) {
    for (const abweichung of [undefined, { status: HTTP_ZU_VIELE, text: "zu viele" }]) {
      stripeAntworten.abweichung = abweichung ? { ziel: ZIEL[fall.vorgang], ...abweichung } : null;
      const ohne = await fall.lauf();
      const { ergebnis } = await ruf(fall, abweichung);
      assert.deepEqual(ergebnis, ohne, fall.vorgang);
      if (abweichung && fall.vorgang === "reservierung-anlegen") {
        assert.equal(ohne.jobFehler, "Stripe placeHold fehlgeschlagen: HTTP 429");
      }
    }
  }
});

test("Wirft das Erfassen, bleiben Antwort und Ausgang gleich und die Logzeilen nennen nur anbieter und vorgang", async () => {
  for (const fall of FAELLE) {
    stripeAntworten.abweichung = null;
    const ohne = await fall.lauf();
    const { ergebnis } = await gemessen(async (telemetrie) => {
      mock.method(telemetrie, "messeAnbieter", () => {
        throw new Error("Erfassen kaputt kunde-reservierung@example.test");
      });
      const warnung = mock.method(console, "warn", () => {});
      const res = await fall.lauf();
      const zeilen = warnung.mock.calls.map((aufruf) => String(aufruf.arguments[0]));
      warnung.mock.restore();
      return { res, zeilen: zeilen.filter((z) => z.includes("anbieter=stripe")) };
    });
    assert.deepEqual(ergebnis.res, ohne, fall.vorgang);
    assert.ok(ergebnis.zeilen.length >= 1, fall.vorgang);
    assert.ok(
      ergebnis.zeilen.every((z) => /^\[anbieter-messung\] Erfassen fehlgeschlagen anbieter=stripe vorgang=[a-z-]+$/.test(z)),
      fall.vorgang,
    );
    assert.ok(ergebnis.zeilen.includes(`[anbieter-messung] Erfassen fehlgeschlagen anbieter=stripe vorgang=${fall.vorgang}`));
  }
});
