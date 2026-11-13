import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TELNYX_TEST_SIGNATURE_HEADERS,
  seedCall,
  seedState,
  seedWithTelnyxNumber,
  startServer,
} from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { startEmpfaenger } from "../gemeinsam/otlp-empfaenger.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const WARTE_FRIST_MS = 8000;
const MS_JE_S = 1000;
const ANNAHME = "hermes.call.answer_time";
const ENDE = "hermes.call.ended";
const NUMMER = "+4915112345678";
const BASIS_ENV = {
  ALLOWED_COUNTRY_CODES: "+49",
  FAKE_ORIGINATE: "true",
  ELEVENLABS_OUTBOUND_ENABLED: "false",
  PRECALL_BRIEFING_ENABLED: "false",
  METRIKEN_OTLP_TOKEN: TOKEN,
  METRIKEN_INTERVALL_MS: "50",
};

const metrikenVon = (export_) => export_.resourceMetrics.flatMap((r) => r.scopeMetrics).flatMap((s) => s.metrics);
const labelsVon = (punkt) => Object.fromEntries(punkt.attributes.map((a) => [a.key, a.value.stringValue]));

const histogrammeVon = (export_, name) =>
  metrikenVon(export_)
    .filter((m) => m.name === name && m.histogram)
    .map((m) => ({
      einheit: m.unit,
      punkte: m.histogram.dataPoints.map((p) => ({ labels: labelsVon(p), summe: p.sum, anzahl: Number(p.count) })),
    }));

const zaehlerVon = (export_, name) =>
  metrikenVon(export_)
    .filter((m) => m.name === name && m.sum)
    .flatMap((m) => m.sum.dataPoints);

function warteAuf(empfaenger, auswahl) {
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(WARTE_FRIST_MS).addEventListener("abort", () => reject(new Error("kein passender Export")));
    const pruefen = () => {
      const treffer = empfaenger.exporte.map(auswahl).findLast((punkte) => punkte.length > 0);
      if (treffer) resolve(treffer);
      else empfaenger.wartende.push(pruefen);
    };
    pruefen();
  });
}

const warteAufAnnahme = (empfaenger) => warteAuf(empfaenger, (e) => histogrammeVon(e, ANNAHME));
const warteAufEnde = (empfaenger) => warteAuf(empfaenger, (e) => zaehlerVon(e, ENDE));

async function mitServer(optionen, lauf) {
  const empfaenger = await startEmpfaenger();
  const srv = await startServer({ ...optionen, env: { ...BASIS_ENV, METRIKEN_OTLP_URL: empfaenger.url, ...optionen.env } });
  try {
    return await lauf({ srv, empfaenger });
  } finally {
    await srv.stop();
    await empfaenger.stop();
  }
}

const vorSekunden = (s) => new Date(Date.now() - s * MS_JE_S).toISOString();

function anruf(id, richtung, zusatz = {}) {
  return seedCall({
    id,
    direction: richtung,
    twilioSid: `CA${id}`,
    from: richtung === "inbound" ? NUMMER : "+4915255555555",
    to: richtung === "inbound" ? "+4915255555555" : NUMMER,
    startedAt: vorSekunden(100),
    answeredAt: vorSekunden(90),
    maxDurationS: 600,
    ...zusatz,
  });
}

const seedMit = (calls) => seedState({ ...seedWithTelnyxNumber({ language: "de" }), calls });

const meldeStatus = (srv, id, status) =>
  abrufMitFrist(`${srv.localUrl}/voice/status?callId=${id}`, {
    method: "POST",
    headers: TELNYX_TEST_SIGNATURE_HEADERS,
    body: new URLSearchParams({ CallSid: `CA${id}`, CallStatus: status }),
  });

test("Annahmezeit-Messung S1: ein angenommener ausgehender Anruf misst 10 s bis zur Annahme in s", async () => {
  await mitServer({ seed: seedMit([anruf("call_aus", "outbound")]) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_aus", "completed");
    const [annahme] = await warteAufAnnahme(empfaenger);
    assert.equal(annahme.einheit, "s");
    assert.equal(annahme.punkte.length, 1);
    assert.deepEqual(annahme.punkte[0].labels, { direction: "outbound" });
    assert.equal(annahme.punkte[0].anzahl, 1);
    assert.ok(Math.abs(annahme.punkte[0].summe - 10) < 0.5, `Summe ${annahme.punkte[0].summe}`);
  });
});

test("Annahmezeit-Messung S2: ein eingehender Anruf misst mit direction inbound, ohne Nummer oder Kennung im Export", async () => {
  await mitServer({ seed: seedMit([anruf("call_ein", "inbound")]) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_ein", "completed");
    const [annahme] = await warteAufAnnahme(empfaenger);
    assert.deepEqual(annahme.punkte[0].labels, { direction: "inbound" });
    const text = JSON.stringify(empfaenger.exporte);
    for (const verboten of [NUMMER, "+4915255555555", "call_ein", "CAcall"])
      assert.ok(!text.includes(verboten), `Export enthaelt ${verboten}`);
  });
});

test("Annahmezeit-Messung S3: ein nie angenommener Anruf liefert keine Annahmezeit, zaehlt aber ended", async () => {
  const offen = anruf("call_na", "outbound", { answeredAt: null });
  await mitServer({ seed: seedMit([offen]) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_na", "no-answer");
    await warteAufEnde(empfaenger);
    const nachEnde = empfaenger.exporte.length;
    await warteAuf(empfaenger, () => (empfaenger.exporte.length >= nachEnde + 2 ? [true] : []));
    const reihen = empfaenger.exporte.flatMap((e) => histogrammeVon(e, ANNAHME));
    assert.deepEqual(reihen, []);
  });
});

test("Annahmezeit-Messung S4: eine Annahme vor dem Start liefert keine Annahmezeit", async () => {
  const verdreht = anruf("call_neg", "outbound", { startedAt: vorSekunden(80) });
  await mitServer({ seed: seedMit([verdreht]) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_neg", "completed");
    await warteAufEnde(empfaenger);
    assert.ok(empfaenger.exporte.every((e) => histogrammeVon(e, ANNAHME).length === 0));
  });
});

test("Annahmezeit-Messung S5: eine Annahme im selben Moment wie der Start misst 0", async () => {
  const gleich = vorSekunden(90);
  await mitServer({ seed: seedMit([anruf("call_null", "outbound", { startedAt: gleich, answeredAt: gleich })]) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_null", "completed");
    const [annahme] = await warteAufAnnahme(empfaenger);
    assert.equal(annahme.punkte[0].anzahl, 1);
    assert.equal(annahme.punkte[0].summe, 0);
  });
});

test("Annahmezeit-Messung S6: ein zweites Ende desselben Anrufs misst die Annahmezeit nicht doppelt", async () => {
  await mitServer({ seed: seedMit([anruf("call_zwei", "outbound")]) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_zwei", "completed");
    await meldeStatus(srv, "call_zwei", "completed");
    await warteAufAnnahme(empfaenger);
    const [annahme] = await warteAufAnnahme(empfaenger);
    assert.equal(annahme.punkte[0].anzahl, 1);
  });
});
