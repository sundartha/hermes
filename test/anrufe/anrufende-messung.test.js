import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import {
  TELNYX_TEST_SIGNATURE_HEADERS,
  seedCall,
  seedState,
  seedWithTelnyxNumber,
  startServer,
  waitForStoreState,
} from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { startEmpfaenger } from "../gemeinsam/otlp-empfaenger.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const WARTE_FRIST_MS = 8000;
const MS_JE_S = 1000;
const ENDE = "hermes.call.ended";
const DAUER = "hermes.call.duration";
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
const zaehlerPunkt = (p) => ({ labels: labelsVon(p), wert: Number(p.asInt ?? p.asDouble) });

const summenVon = (export_, name) =>
  metrikenVon(export_)
    .filter((m) => m.name === name && m.sum)
    .flatMap((m) => m.sum.dataPoints)
    .map(zaehlerPunkt);

const histogrammeVon = (export_, name) =>
  metrikenVon(export_)
    .filter((m) => m.name === name && m.histogram)
    .map((m) => ({
      einheit: m.unit,
      punkte: m.histogram.dataPoints.map((p) => ({ labels: labelsVon(p), summe: p.sum, anzahl: Number(p.count) })),
    }));

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

const warteAufZaehler = (empfaenger, name) => warteAuf(empfaenger, (e) => summenVon(e, name));
const warteAufDauer = (empfaenger) => warteAuf(empfaenger, (e) => histogrammeVon(e, DAUER));

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

function angenommenerAnruf(id, richtung, zusatz = {}) {
  return seedCall({
    id,
    direction: richtung,
    twilioSid: `CA${id}`,
    from: richtung === "inbound" ? NUMMER : "+4915255555555",
    to: richtung === "inbound" ? "+4915255555555" : NUMMER,
    answeredAt: vorSekunden(90),
    maxDurationS: 600,
    ...zusatz,
  });
}

const seedMit = (calls) => seedState({ ...seedWithTelnyxNumber({ language: "de" }), calls });

function meldeFelder(srv, id, felder) {
  return abrufMitFrist(`${srv.localUrl}/voice/status?callId=${id}`, {
    method: "POST",
    headers: TELNYX_TEST_SIGNATURE_HEADERS,
    body: new URLSearchParams({ CallSid: `CA${id}`, ...felder }),
  });
}

const meldeStatus = (srv, id, status) => meldeFelder(srv, id, { CallStatus: status });

const labelsDerRichtung = (punkte, richtung) => punkte.find((p) => p.labels.direction === richtung).labels;

const alleExportTexte = (empfaenger) => JSON.stringify(empfaenger.exporte);

test("Anrufende-Messung S1: ein regulaer beendeter ausgehender Anruf zaehlt ended und misst die Gespraechsdauer in s", async () => {
  await mitServer({ seed: seedMit([angenommenerAnruf("call_aus", "outbound")]) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_aus", "completed");
    const punkte = await warteAufZaehler(empfaenger, ENDE);
    assert.deepEqual(punkte, [{ labels: { direction: "outbound", ergebnis: "completed", grund: "keiner" }, wert: 1 }]);
    const [dauer] = await warteAufDauer(empfaenger);
    assert.equal(dauer.einheit, "s");
    assert.equal(dauer.punkte.length, 1);
    assert.deepEqual(dauer.punkte[0].labels, { direction: "outbound" });
    assert.equal(dauer.punkte[0].anzahl, 1);
    assert.ok(dauer.punkte[0].summe >= 90 && dauer.punkte[0].summe < 100, `Summe ${dauer.punkte[0].summe}`);
  });
});

test("Anrufende-Messung S2: ein regulaer beendeter eingehender Anruf zaehlt mit direction inbound", async () => {
  await mitServer({ seed: seedMit([angenommenerAnruf("call_ein", "inbound")]) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_ein", "completed");
    const punkte = await warteAufZaehler(empfaenger, ENDE);
    assert.deepEqual(punkte, [{ labels: { direction: "inbound", ergebnis: "completed", grund: "keiner" }, wert: 1 }]);
    const [dauer] = await warteAufDauer(empfaenger);
    assert.deepEqual(dauer.punkte[0].labels, { direction: "inbound" });
  });
});

test("Anrufende-Messung S3: no-answer zaehlt als failed mit grund no-answer und ohne Dauer", async () => {
  const unbeantwortet = angenommenerAnruf("call_na", "outbound", { answeredAt: null });
  await mitServer({ seed: seedMit([unbeantwortet]) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_na", "no-answer");
    const punkte = await warteAufZaehler(empfaenger, ENDE);
    assert.deepEqual(punkte, [{ labels: { direction: "outbound", ergebnis: "failed", grund: "no-answer" }, wert: 1 }]);
    assert.ok(empfaenger.exporte.every((e) => histogrammeVon(e, DAUER).length === 0));
  });
});

test("Anrufende-Messung S4: unbekannte Gruende werden zu sonstig bzw. failed, nie der Rohtext, nie eine Nummer", async () => {
  const frei = angenommenerAnruf("call_frei", "outbound", {
    answeredAt: null,
    failureReason: `Teilnehmer ${NUMMER} nicht erreichbar`,
  });
  await mitServer({ seed: seedMit([frei, angenommenerAnruf("call_sip", "inbound", { answeredAt: null })]) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_frei", "busy");
    await meldeFelder(srv, "call_sip", { CallStatus: "failed", SipHangupCause: "sip-999", HangupCause: "xyz" });
    const punkte = await warteAuf(empfaenger, (e) => {
      const alle = summenVon(e, ENDE);
      return alle.length === 2 ? alle : [];
    });
    const grund = (richtung) => labelsDerRichtung(punkte, richtung).grund;
    assert.equal(grund("outbound"), "sonstig");
    assert.equal(grund("inbound"), "failed");
    const text = alleExportTexte(empfaenger);
    for (const verboten of [NUMMER, "+4915255555555", "call_frei", "call_sip", "sip-999", "nicht erreichbar", "CAcall"])
      assert.ok(!text.includes(verboten), `Export enthaelt ${verboten}`);
  });
});

test("Anrufende-Messung S5: ein zweites Ende desselben Anrufs zaehlt nicht doppelt", async () => {
  const anrufe = [angenommenerAnruf("call_zwei", "outbound"), angenommenerAnruf("call_marke", "inbound")];
  await mitServer({ seed: seedMit(anrufe) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_zwei", "completed");
    await meldeStatus(srv, "call_zwei", "completed");
    await meldeStatus(srv, "call_marke", "completed");
    const punkte = await warteAuf(empfaenger, (e) => {
      const alle = summenVon(e, ENDE);
      return alle.length === 2 ? alle : [];
    });
    assert.equal(punkte.find((p) => p.labels.direction === "outbound").wert, 1);
  });
});

test("Anrufende-Messung S3b: ein Anruf mit Annahme nach dem Ende liefert keine Dauer, zaehlt aber ended", async () => {
  const verdreht = angenommenerAnruf("call_neg", "outbound", { answeredAt: vorSekunden(-60) });
  await mitServer({ seed: seedMit([verdreht]) }, async ({ srv, empfaenger }) => {
    await meldeStatus(srv, "call_neg", "completed");
    const punkte = await warteAufZaehler(empfaenger, ENDE);
    assert.equal(punkte[0].wert, 1);
    assert.ok(empfaenger.exporte.every((e) => histogrammeVon(e, DAUER).length === 0));
  });
});

const SDK_URL = pathToFileURL(createRequire(import.meta.url).resolve("@opentelemetry/sdk-metrics")).href;
const WERFENDER_METER = [
  `const { MeterProvider } = await import(${JSON.stringify(SDK_URL)});`,
  "const echt = MeterProvider.prototype.getMeter;",
  "MeterProvider.prototype.getMeter = function (...args) {",
  "  const meter = echt.apply(this, args);",
  "  const wirf = () => { process.stdout.write('[meter-sonde] messen wirft\\n'); throw new Error('meter kaputt'); };",
  "  const echterZaehler = meter.createCounter.bind(meter);",
  "  meter.createCounter = (...a) => { const z = echterZaehler(...a); z.add = wirf; return z; };",
  "  const echtesHistogramm = meter.createHistogram.bind(meter);",
  "  meter.createHistogram = (...a) => { const h = echtesHistogramm(...a); h.record = wirf; return h; };",
  "  return meter;",
  "};",
].join("\n");
const SONDE_ENV = { NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(WERFENDER_METER)}` };

test("Anrufende-Messung S6: werfende Messung aendert Status und Abrechnung des Anrufs nicht", async () => {
  await mitServer({ seed: seedMit([angenommenerAnruf("call_wirft", "outbound")]), env: SONDE_ENV }, async ({ srv }) => {
    const antwort = await meldeStatus(srv, "call_wirft", "completed");
    assert.equal(antwort.status, 200);
    await waitForStoreState(srv, (store) => store.calls.find((c) => c.id === "call_wirft")?.billedAt);
    const call = srv.readStore().calls.find((c) => c.id === "call_wirft");
    assert.equal(call.status, "completed");
    assert.match(srv.stdout, /\[meter-sonde\] messen wirft/);
    assert.match(srv.stdout, /\[betriebsmessung\] anruf_ende fehlgeschlagen/);
  });
});
