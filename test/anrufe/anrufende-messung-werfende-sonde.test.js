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
  waitForLog,
  waitForStoreState,
} from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { OTLP_MESSWERTE_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const SONDEN_URL = pathToFileURL(createRequire(import.meta.url).resolve("@opentelemetry/sdk-metrics")).href;
const SONDE = [
  `const { MeterProvider } = await import(${JSON.stringify(SONDEN_URL)});`,
  "const echt = MeterProvider.prototype.getMeter;",
  "MeterProvider.prototype.getMeter = function (...args) {",
  "  const meter = echt.apply(this, args);",
  "  const wirf = () => { process.stdout.write('[meter-sonde] messen wirft\\n'); throw new Error('meter kaputt'); };",
  "  const zaehler = meter.createCounter.bind(meter);",
  "  meter.createCounter = (...a) => { const z = zaehler(...a); z.add = wirf; return z; };",
  "  const histogramm = meter.createHistogram.bind(meter);",
  "  meter.createHistogram = (...a) => { const h = histogramm(...a); h.record = wirf; return h; };",
  "  return meter;",
  "};",
].join("\n");

const ANRUF = "call_wirft";
const LOG_FRIST_MS = 8000;

test("Anrufende-Messung S6b: werfende Messung aendert Status und Abrechnung nicht, Sonden-Zeile wird abgewartet", async () => {
  const anruf = seedCall({
    id: ANRUF,
    direction: "outbound",
    twilioSid: `CA${ANRUF}`,
    from: "+4915255555555",
    to: "+4915112345678",
    answeredAt: "2026-01-01T00:00:00.000Z",
    maxDurationS: 600,
  });
  const srv = await startServer({
    seed: seedState({ ...seedWithTelnyxNumber({ language: "de" }), calls: [anruf] }),
    env: {
      ALLOWED_COUNTRY_CODES: "+49",
      FAKE_ORIGINATE: "true",
      ELEVENLABS_OUTBOUND_ENABLED: "false",
      PRECALL_BRIEFING_ENABLED: "false",
      METRIKEN_OTLP_TOKEN: OTLP_MESSWERTE_TOKEN,
      METRIKEN_OTLP_URL: "http://127.0.0.1:9",
      METRIKEN_INTERVALL_MS: "50",
      NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(SONDE)}`,
    },
  });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${ANRUF}`, {
      method: "POST",
      headers: TELNYX_TEST_SIGNATURE_HEADERS,
      body: new URLSearchParams({ CallSid: `CA${ANRUF}`, CallStatus: "completed" }),
    });
    assert.equal(antwort.status, 200);
    await waitForStoreState(srv, (store) => store.calls.find((c) => c.id === ANRUF)?.billedAt);
    await waitForLog(srv, /\[meter-sonde\] messen wirft/, LOG_FRIST_MS);
    await waitForLog(srv, /\[betriebsmessung\] anruf_ende fehlgeschlagen/, LOG_FRIST_MS);
    const call = srv.readStore().calls.find((c) => c.id === ANRUF);
    assert.equal(call.status, "completed");
    assert.ok(call.billedAt);
  } finally {
    await srv.stop();
  }
});
