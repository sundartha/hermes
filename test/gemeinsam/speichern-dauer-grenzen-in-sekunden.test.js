import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { starteTelemetrie } from "../../src/utils/telemetrie.js";
import { messeSpeichern } from "../../src/utils/betriebsmessung.js";
import { startEmpfaenger } from "./otlp-empfaenger.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "./erfundene-geheimnisse.js";

const EXPORT_INTERVALL_MS = 50;
const WARTE_FRIST_MS = 30000;
const NAME = "hermes.store.save.duration";
const GRENZEN = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const ZWANZIG_MS = 20;
const ZWEI_SEKUNDEN_MS = 2000;

const metrikenVon = (export_) => export_.resourceMetrics.flatMap((r) => r.scopeMetrics).flatMap((s) => s.metrics);
const histogrammPunkte = (export_) =>
  metrikenVon(export_)
    .filter((m) => m.name === NAME && m.histogram)
    .flatMap((m) => m.histogram.dataPoints);

function warteAufMessungen(empfaenger, anzahl) {
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(WARTE_FRIST_MS).addEventListener("abort", () => reject(new Error("kein passender Export")));
    const pruefen = () => {
      const punkte = empfaenger.exporte.flatMap(histogrammPunkte);
      const treffer = punkte.findLast((p) => Number(p.count) >= anzahl);
      if (treffer) resolve(treffer);
      else empfaenger.wartende.push(pruefen);
    };
    pruefen();
  });
}

async function messe(dauernMs) {
  const empfaenger = await startEmpfaenger();
  const warnungen = mock.method(console, "warn", () => {});
  let versatz = 0;
  const echt = performance.now.bind(performance);
  const uhr = mock.method(performance, "now", () => echt() + versatz);
  const telemetrie = await starteTelemetrie({ url: empfaenger.url, token: TOKEN, intervallMs: EXPORT_INTERVALL_MS });
  try {
    for (const dauer of dauernMs) {
      await messeSpeichern(async () => {
        versatz += dauer;
      });
    }
    return await warteAufMessungen(empfaenger, dauernMs.length);
  } finally {
    await telemetrie.stoppe();
    await empfaenger.stop();
    uhr.mock.restore();
    warnungen.mock.restore();
  }
}

const eimer = (punkt) => punkt.bucketCounts.map(Number);

test("Speichern-Dauer: eine Messung von 20 ms liegt im Eimer über 0,01 bis 0,025 Sekunden", async () => {
  const punkt = await messe([ZWANZIG_MS]);
  assert.deepEqual(punkt.explicitBounds, GRENZEN);
  assert.deepEqual(eimer(punkt), [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("Speichern-Dauer: 20 ms und 2 s landen in verschiedenen Eimern", async () => {
  const punkt = await messe([ZWANZIG_MS, ZWEI_SEKUNDEN_MS]);
  assert.deepEqual(eimer(punkt), [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0]);
});
