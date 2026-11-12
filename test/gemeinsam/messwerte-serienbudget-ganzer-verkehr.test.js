import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { startServer } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "./erfundene-geheimnisse.js";

const SERIEN_BUDGET_JE_INSTANZ = 150;
const SERIEN_JE_HISTOGRAMM_OHNE_GRENZEN = 3;
const WARTE_FRIST_MS = 8000;
const FREMDE_PFADE = 40;
const DATENPUNKT_ARTEN = ["histogram", "gauge", "sum"];

function startEmpfaenger() {
  const empfangen = [];
  const wartende = [];
  const empfaenger = http.createServer((req, res) => {
    const teile = [];
    req.on("data", (teil) => teile.push(teil));
    req.on("end", () => {
      empfangen.push(JSON.parse(Buffer.concat(teile).toString("utf8")));
      for (const wartender of wartende.splice(0)) wartender();
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  return new Promise((resolve) => {
    empfaenger.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${empfaenger.address().port}/otlp`;
      resolve({ url, empfangen, wartende, stop: () => new Promise((fertig) => empfaenger.close(fertig)) });
    });
  });
}

function warteAufExport(empfaenger, pruefung) {
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(WARTE_FRIST_MS).addEventListener("abort", () => reject(new Error("kein passender Export empfangen")));
    const pruefen = () => {
      const treffer = empfaenger.empfangen.findLast(pruefung);
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


const histogrammPunkte = (export_) => metrikenVon(export_).flatMap((m) => m.histogram?.dataPoints ?? []);
const anfragenGezaehlt = (export_) => histogrammPunkte(export_).reduce((summe, p) => summe + Number(p.count), 0);

test("Messwerte: Serien werden erst gezaehlt, wenn der Export den ganzen Verkehr enthaelt", async () => {
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
    const gesendet = pfade.length + FREMDE_PFADE;
    const export_ = await warteAufExport(empfaenger, (e) => gaugePunkte(e).length > 0 && anfragenGezaehlt(e) >= gesendet);
    assert.ok(anfragenGezaehlt(export_) >= gesendet, "der Export enthaelt alle gesendeten Anfragen");
    assert.ok(gaugePunkte(export_).length > 0, "mindestens ein Gauge-Punkt wird gezaehlt");
    const serien = serienGesamt(export_);
    assert.ok(serien < SERIEN_BUDGET_JE_INSTANZ, `${serien} Serien, Budget ${SERIEN_BUDGET_JE_INSTANZ}`);
  } finally {
    await srv.stop();
    await empfaenger.stop();
  }
});
