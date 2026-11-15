import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { TELNYX_TEST_SIGNATURE_HEADERS, seedCall, seedState, seedWithTelnyxNumber, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { startEmpfaenger } from "../gemeinsam/otlp-empfaenger.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const MS_JE_S = 1000;
const ID = "call_zusammenfassung";
const ZUSAMMENFASSUNG = "Termin am Donnerstag um zehn Uhr vereinbart.";
const BASIS_ENV = {
  ALLOWED_COUNTRY_CODES: "+49",
  FAKE_ORIGINATE: "true",
  ELEVENLABS_OUTBOUND_ENABLED: "false",
  PRECALL_BRIEFING_ENABLED: "false",
  METRIKEN_OTLP_TOKEN: TOKEN,
  METRIKEN_INTERVALL_MS: "50",
};

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

const vorSekunden = (s) => new Date(Date.now() - s * MS_JE_S).toISOString();

const anrufMitTranskript = () =>
  seedCall({
    id: ID,
    direction: "outbound",
    twilioSid: `CA${ID}`,
    from: "+4915255555555",
    to: "+4915112345678",
    answeredAt: vorSekunden(90),
    maxDurationS: 600,
    summary: ZUSAMMENFASSUNG,
    transcript: [
      { role: "agent", text: "Guten Tag, ich rufe wegen eines Termins an.", at: vorSekunden(80) },
      { role: "user", text: "Donnerstag um zehn passt.", at: vorSekunden(70) },
    ],
  });

async function beendeAnruf(env) {
  const empfaenger = await startEmpfaenger();
  const srv = await startServer({
    seed: seedState({ ...seedWithTelnyxNumber({ language: "de" }), calls: [anrufMitTranskript()] }),
    env: { ...BASIS_ENV, METRIKEN_OTLP_URL: empfaenger.url, ...env },
  });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${ID}`, {
      method: "POST",
      headers: TELNYX_TEST_SIGNATURE_HEADERS,
      body: new URLSearchParams({ CallSid: `CA${ID}`, CallStatus: "completed" }),
    });
    await waitForStoreState(srv, (store) => store.notifications.some((n) => n.callId === ID));
    const stand = srv.readStore();
    return { antwort: antwort.status, call: stand.calls.find((c) => c.id === ID), meldungen: stand.notifications.filter((n) => n.callId === ID), log: srv.stdout };
  } finally {
    await srv.stop();
    await empfaenger.stop();
  }
}

test("Anrufende-Messung Zusammenfassung: werfende Messung laesst Zusammenfassung und Meldung des Anrufs wie ohne Sonde", async () => {
  const ohne = await beendeAnruf({});
  const mit = await beendeAnruf(SONDE_ENV);
  assert.equal(ohne.meldungen.length, 1);
  assert.match(ohne.meldungen[0].body, new RegExp(ZUSAMMENFASSUNG));
  assert.doesNotMatch(ohne.log, /\[betriebsmessung\]/);
  assert.match(mit.log, /\[betriebsmessung\] anruf_ende fehlgeschlagen/);
  assert.equal(mit.antwort, 200);
  assert.equal(mit.meldungen.length, 1);
  assert.equal(mit.meldungen[0].title, ohne.meldungen[0].title);
  assert.equal(mit.meldungen[0].body, ohne.meldungen[0].body);
  assert.equal(mit.call.summary, ohne.call.summary);
  assert.deepEqual(mit.call.transcript, ohne.call.transcript);
});
