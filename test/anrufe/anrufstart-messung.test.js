import { test, mock } from "node:test";
import assert from "node:assert/strict";

import {
  TELNYX_TEST_TENANT_NUMBER,
  placeCall,
  postTelnyxIncoming,
  seedWithTelnyxNumber,
  startServer,
} from "../helpers.js";
import { startEmpfaenger } from "../gemeinsam/otlp-empfaenger.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import * as betrieb from "../../src/utils/betriebsmessung.js";

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

const summenVon = (export_, name) =>
  export_.resourceMetrics
    .flatMap((r) => r.scopeMetrics)
    .flatMap((s) => s.metrics)
    .filter((m) => m.name === name && m.sum)
    .flatMap((m) => m.sum.dataPoints)
    .map((p) => ({
      labels: Object.fromEntries(p.attributes.map((a) => [a.key, a.value.stringValue])),
      wert: Number(p.asInt ?? p.asDouble),
    }));

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

function werfenderMeter() {
  const wirft = () => {
    throw new Error("meter kaputt");
  };
  return { createCounter: () => ({ add: wirft }), createObservableGauge: () => ({}), addBatchObservableCallback() {} };
}

test("Anrufstart-Messung B6-B8: ein werfender Zaehler laesst den Aufrufer ungestoert und schreibt nur eine Logzeile ohne Kennung", () => {
  const warnungen = mock.method(console, "warn", () => {});
  const beende = betrieb.schalteScharf({ meter: werfenderMeter(), poolZustand: () => null, warteschlangeZustand: async () => null });
  try {
    assert.doesNotThrow(() => betrieb.zaehleAnrufGestartet("outbound"));
    assert.doesNotThrow(() => betrieb.zaehleAnrufAbgelehnt("stundenlimit"));
    const meldungen = warnungen.mock.calls.map((a) => a.arguments[0]);
    assert.deepEqual(meldungen.filter((m) => m.startsWith("[betriebsmessung] anruf_")), [
      "[betriebsmessung] anruf_gestartet fehlgeschlagen: meter kaputt",
      "[betriebsmessung] anruf_abgelehnt fehlgeschlagen: meter kaputt",
    ]);
  } finally {
    beende();
    warnungen.mock.restore();
  }
});

test("Anrufstart-Messung: nach dem Beenden und vor dem Scharfschalten tun die Zaehler nichts", () => {
  const hinzu = [];
  const meter = {
    createCounter: (name) => ({ add: (n, labels) => hinzu.push([name, n, labels]) }),
    createObservableGauge: () => ({}),
    addBatchObservableCallback() {},
  };
  betrieb.zaehleAnrufGestartet("outbound");
  const beende = betrieb.schalteScharf({ meter, poolZustand: () => null, warteschlangeZustand: async () => null });
  betrieb.zaehleAnrufGestartet("inbound");
  betrieb.zaehleAnrufAbgelehnt("denylist");
  beende();
  betrieb.zaehleAnrufGestartet("outbound");
  assert.deepEqual(hinzu, [
    [GESTARTET, 1, { direction: "inbound" }],
    [ABGELEHNT, 1, { grund: "denylist" }],
  ]);
});
