import { test } from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { startEmpfaenger } from "./otlp-empfaenger.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "./erfundene-geheimnisse.js";

const SERIEN_BUDGET_JE_INSTANZ = 150;
const SERIEN_JE_HISTOGRAMM_OHNE_GRENZEN = 3;
const WARTE_FRIST_MS = 8000;
const FREMDE_PFADE = 40;
const DATENPUNKT_ARTEN = ["histogram", "gauge", "sum"];

function warteAufExport(empfaenger, pruefung) {
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(WARTE_FRIST_MS).addEventListener("abort", () => reject(new Error("kein passender Export empfangen")));
    const pruefen = () => {
      const treffer = empfaenger.exporte.findLast(pruefung);
      if (treffer) resolve(treffer);
      else empfaenger.wartende.push(pruefen);
    };
    pruefen();
  });
}

const metrikenVon = (export_) => export_.resourceMetrics.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));

function serienJeMetrik(metrik) {
  return DATENPUNKT_ARTEN.reduce((summe, art) => {
    const punkte = metrik[art]?.dataPoints ?? [];
    const jePunkt = art === "histogram" ? (p) => p.explicitBounds.length + SERIEN_JE_HISTOGRAMM_OHNE_GRENZEN : () => 1;
    return summe + punkte.reduce((s, p) => s + jePunkt(p), 0);
  }, 0);
}

const serienGesamt = (export_) => metrikenVon(export_).reduce((summe, m) => summe + serienJeMetrik(m), 0);
const gaugePunkte = (export_) => metrikenVon(export_).flatMap((m) => m.gauge?.dataPoints ?? []);

const exportMit = (metriken) => ({ resourceMetrics: [{ scopeMetrics: [{ metrics: metriken }] }] });
const gaugeMetrik = (name, anzahl) => ({ name, gauge: { dataPoints: Array.from({ length: anzahl }, () => ({ asDouble: 1 })) } });

test("Serienrechnung: Histogramm, Gauge und Summe zaehlen je Art", () => {
  const histogramm = { name: "h", histogram: { dataPoints: [{ explicitBounds: [1, 2, 3, 4, 5, 6, 7, 8] }] } };
  const summe = { name: "s", sum: { dataPoints: [{ asInt: 1 }, { asInt: 2 }] } };
  assert.equal(serienGesamt(exportMit([histogramm])), 11);
  assert.equal(serienGesamt(exportMit([gaugeMetrik("g", 3)])), 3);
  assert.equal(serienGesamt(exportMit([summe])), 2);
  assert.equal(serienGesamt(exportMit([histogramm, gaugeMetrik("g", 3), summe])), 16);
});

test("Serienrechnung: zusaetzliche Gauge-Punkte lassen die Grenze von 150 reissen", () => {
  const histogramm = { name: "h", histogram: { dataPoints: Array.from({ length: 10 }, () => ({ explicitBounds: new Array(8).fill(1) })) } };
  assert.ok(serienGesamt(exportMit([histogramm])) < SERIEN_BUDGET_JE_INSTANZ);
  assert.ok(serienGesamt(exportMit([histogramm, gaugeMetrik("hermes.db.pool.open", 41)])) > SERIEN_BUDGET_JE_INSTANZ);
});

test("Messwerte: alle Serien des Exports (Histogramme, Gauges, Summen) bleiben unter 150 je Instanz", async () => {
  const empfaenger = await startEmpfaenger();
  const srv = await startServer({
    env: {
      METRIKEN_OTLP_URL: empfaenger.url,
      METRIKEN_OTLP_BENUTZER: "123456",
      METRIKEN_OTLP_TOKEN: TOKEN,
      METRIKEN_INTERVALL_MS: "50",
      RENDER_INSTANCE_ID: "instanz-test",
    },
  });
  try {
    const pfade = ["/healthz", "/api/plans", "/.well-known/security.txt", "/api/calls/call_1", "/api/calls/call_2/cancel"];
    for (const pfad of pfade) await abrufMitFrist(`${srv.localUrl}${pfad}`);
    for (let nr = 0; nr < FREMDE_PFADE; nr += 1) {
      await abrufMitFrist(`${srv.localUrl}/voice/+49151${nr}/x${nr}`, { method: nr % 2 ? "GET" : "POST" });
    }
    const export_ = await warteAufExport(empfaenger, (e) => gaugePunkte(e).length > 0 && serienGesamt(e) > 0);
    assert.ok(gaugePunkte(export_).length > 0, "mindestens ein Gauge-Punkt wird gezaehlt");
    const serien = serienGesamt(export_);
    assert.ok(serien < SERIEN_BUDGET_JE_INSTANZ, `${serien} Serien, Budget ${SERIEN_BUDGET_JE_INSTANZ}`);
  } finally {
    await srv.stop();
    await empfaenger.stop();
  }
});
