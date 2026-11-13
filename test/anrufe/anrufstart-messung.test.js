import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import {
  TELNYX_TEST_TENANT_NUMBER,
  placeCall,
  postTelnyxIncoming,
  seedState,
  seedCall,
  seedWithTelnyxNumber,
  startServer,
} from "../helpers.js";
import { startEmpfaenger } from "../gemeinsam/otlp-empfaenger.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const WARTE_FRIST_MS = 8000;
const GESTARTET = "hermes.call.started";
const ABGELEHNT = "hermes.call.denied";
const ERLAUBT = "+4930000000002";
const ANRUFER = "+4930000000003";
const SPERRLISTE = "+4990000000009";
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

function warteAufZaehler(empfaenger, name) {
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(WARTE_FRIST_MS).addEventListener("abort", () => reject(new Error(`kein Export mit ${name}`)));
    const pruefen = () => {
      const treffer = empfaenger.exporte.map((e) => summenVon(e, name)).findLast((punkte) => punkte.length > 0);
      if (treffer) resolve(treffer);
      else empfaenger.wartende.push(pruefen);
    };
    pruefen();
  });
}

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

const keinZaehler = (empfaenger, name) => empfaenger.exporte.every((e) => summenVon(e, name).length === 0);

test("Anrufstart-Messung S1: ein ausgehender Anruf zaehlt hermes.call.started mit direction outbound", async () => {
  await mitServer({ seed: seedWithTelnyxNumber() }, async ({ srv, empfaenger }) => {
    const res = await placeCall(srv, ERLAUBT);
    assert.equal(res.status, HTTP_OK);
    assert.equal((await res.json()).deduplicated, false);
    const punkte = await warteAufZaehler(empfaenger, GESTARTET);
    assert.deepEqual(punkte, [{ labels: { direction: "outbound" }, wert: 1 }]);
  });
});

test("Anrufstart-Messung S2: ein eingehender Anruf zaehlt hermes.call.started mit direction inbound", async () => {
  await mitServer({ seed: seedWithTelnyxNumber() }, async ({ srv, empfaenger }) => {
    const res = await postTelnyxIncoming(srv, { from: ANRUFER, to: TELNYX_TEST_TENANT_NUMBER });
    assert.equal(res.status, HTTP_OK);
    assert.match(await res.text(), /<Say/);
    const punkte = await warteAufZaehler(empfaenger, GESTARTET);
    assert.deepEqual(punkte, [{ labels: { direction: "inbound" }, wert: 1 }]);
  });
});

test("Anrufstart-Messung S3/B3: die Sperrliste zaehlt hermes.call.denied mit grund denylist, antwortet wie bisher und startet nichts", async () => {
  await mitServer({ seed: seedWithTelnyxNumber() }, async ({ srv, empfaenger }) => {
    const res = await placeCall(srv, SPERRLISTE);
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.equal((await res.json()).reason, "denylist");
    const punkte = await warteAufZaehler(empfaenger, ABGELEHNT);
    assert.deepEqual(punkte, [{ labels: { grund: "denylist" }, wert: 1 }]);
    assert.ok(keinZaehler(empfaenger, GESTARTET));
  });
});

test("Anrufstart-Messung S4: erreichte Kostendecke bei eingehendem Anruf zaehlt hermes.call.denied mit grund budget_tenant", async () => {
  await mitServer({ seed: seedWithTelnyxNumber({ language: "de" }), env: { MAX_BUDGET_EUR: "0" } }, async ({ srv, empfaenger }) => {
    const res = await postTelnyxIncoming(srv, { from: ANRUFER });
    assert.match(await res.text(), /<Hangup\/>/);
    const punkte = await warteAufZaehler(empfaenger, ABGELEHNT);
    assert.deepEqual(punkte, [{ labels: { grund: "budget_tenant" }, wert: 1 }]);
    assert.ok(keinZaehler(empfaenger, GESTARTET));
  });
});

const HTTP_TOO_MANY = 429;
const SDK_URL = pathToFileURL(createRequire(import.meta.url).resolve("@opentelemetry/sdk-metrics")).href;
const WERFENDER_METER = [
  `const { MeterProvider } = await import(${JSON.stringify(SDK_URL)});`,
  "const echt = MeterProvider.prototype.getMeter;",
  "MeterProvider.prototype.getMeter = function (...args) {",
  "  const meter = echt.apply(this, args);",
  "  const echterZaehler = meter.createCounter.bind(meter);",
  "  meter.createCounter = (...a) => {",
  "    const zaehler = echterZaehler(...a);",
  "    zaehler.add = () => { process.stdout.write('[meter-sonde] add wirft\\n'); throw new Error('meter kaputt'); };",
  "    return zaehler;",
  "  };",
  "  return meter;",
  "};",
].join("\n");
const SONDE_ENV = { NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(WERFENDER_METER)}` };

test("Anrufstart-Messung S5: werfender Zaehler aendert ausgehend weder Antwort noch Anruf-ID", async () => {
  await mitServer({ seed: seedWithTelnyxNumber(), env: SONDE_ENV }, async ({ srv }) => {
    const res = await placeCall(srv, ERLAUBT);
    assert.equal(res.status, HTTP_OK);
    const body = await res.json();
    assert.equal(body.deduplicated, false);
    assert.match(body.call_id ?? body.id ?? body.callId, /^call_/);
    assert.match(srv.stdout, /\[meter-sonde\] add wirft/);
  });
});

test("Anrufstart-Messung S5: werfender Zaehler aendert die Antworten auf Sperrliste und Stundenlimit nicht", async () => {
  const seed = seedState({
    tenants: seedWithTelnyxNumber().tenants,
    numbers: seedWithTelnyxNumber().numbers,
    calls: [seedCall({ id: "call_zuletzt" })],
  });
  await mitServer({ seed, env: { ...SONDE_ENV, MAX_CALLS_PER_HOUR: "1" } }, async ({ srv }) => {
    const limit = await placeCall(srv, ERLAUBT);
    assert.equal(limit.status, HTTP_TOO_MANY);
    assert.equal((await limit.json()).reason, "stundenlimit");
    const gesperrt = await placeCall(srv, SPERRLISTE);
    assert.equal(gesperrt.status, HTTP_FORBIDDEN);
    assert.equal((await gesperrt.json()).reason, "denylist");
    assert.match(srv.stdout, /\[meter-sonde\] add wirft/);
  });
});

test("Anrufstart-Messung S5: werfender Zaehler aendert die Antworten auf eingehende Anrufe nicht", async () => {
  await mitServer({ seed: seedWithTelnyxNumber({ language: "de" }), env: SONDE_ENV }, async ({ srv }) => {
    const res = await postTelnyxIncoming(srv, { from: ANRUFER, to: TELNYX_TEST_TENANT_NUMBER });
    assert.equal(res.status, HTTP_OK);
    assert.match(await res.text(), /<Say/);
    assert.match(srv.stdout, /\[meter-sonde\] add wirft/);
  });
  await mitServer({ seed: seedWithTelnyxNumber({ language: "de" }), env: { ...SONDE_ENV, MAX_BUDGET_EUR: "0" } }, async ({ srv }) => {
    const res = await postTelnyxIncoming(srv, { from: ANRUFER });
    assert.match(await res.text(), /<Hangup\/>/);
    assert.match(srv.stdout, /\[meter-sonde\] add wirft/);
  });
});
