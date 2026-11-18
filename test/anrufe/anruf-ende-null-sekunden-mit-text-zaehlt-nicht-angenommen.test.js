import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";
import { startEmpfaenger } from "../gemeinsam/otlp-empfaenger.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const WARTE_FRIST_MS = 8000;
const MS_JE_S = 1000;
const HTTP_OK = 200;
const ENDE = "hermes.call.ended";
const EL_ENV = {
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_API_KEY: "el-ende-schluessel",
  METRIKEN_OTLP_TOKEN: TOKEN,
  METRIKEN_INTERVALL_MS: "50",
};

const labelsVon = (punkt) => Object.fromEntries(punkt.attributes.map((a) => [a.key, a.value.stringValue]));
const metrikenVon = (export_) => export_.resourceMetrics.flatMap((r) => r.scopeMetrics).flatMap((s) => s.metrics);
const punkteVon = (metrik) => metrik.sum.dataPoints;
const endeSummen = (export_) =>
  metrikenVon(export_)
    .filter((m) => m.name === ENDE && m.sum)
    .flatMap(punkteVon)
    .map((p) => ({ labels: labelsVon(p), wert: Number(p.asInt ?? p.asDouble) }));

function warteAufEnde(empfaenger) {
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(WARTE_FRIST_MS).addEventListener("abort", () => reject(new Error("kein passender Export")));
    const pruefen = () => {
      const treffer = empfaenger.exporte.map(endeSummen).findLast((punkte) => punkte.length > 0);
      if (treffer) resolve(treffer);
      else empfaenger.wartende.push(pruefen);
    };
    pruefen();
  });
}

test("Anruf-Ende: 0 s Anbieterdauer mit gesprochenem Text bleibt completed, zaehlt aber als failed no-answer", async () => {
  const gespraech = {
    conversation_id: "conv_text",
    status: "done",
    transcript: [{ role: "agent", message: "Hallo, hier ist die KI." }],
    analysis: null,
    metadata: { call_duration_secs: 0, error: null },
  };
  const anbieter = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(gespraech));
  });
  await new Promise((resolve) => anbieter.listen(0, "127.0.0.1", resolve));
  const empfaenger = await startEmpfaenger();
  const vorher = new Date(Date.now() - 5 * MS_JE_S).toISOString();
  const srv = await startServer({
    env: {
      ...EL_ENV,
      ELEVENLABS_API_BASE: `http://127.0.0.1:${anbieter.address().port}`,
      METRIKEN_OTLP_URL: empfaenger.url,
      FRISTEN_TAKT_MS: "40",
    },
    seed: seedState({
      calls: [
        seedCall({
          id: "text",
          provider: "telnyx",
          startedAt: vorher,
          answeredAt: vorher,
          fristAbfrageAt: vorher,
          maxDurationS: 3600,
          elevenlabsConversationId: "conv_text",
        }),
      ],
    }),
  });
  try {
    await waitForStoreState(srv, (s) => s.calls.find((c) => c.id === "text")?.status !== "active");
    const punkte = await warteAufEnde(empfaenger);
    assert.deepEqual(punkte, [{ labels: { direction: "outbound", ergebnis: "failed", grund: "no-answer" }, wert: 1 }]);
  } finally {
    await srv.stop();
    await empfaenger.stop();
    await new Promise((resolve) => anbieter.close(resolve));
  }
});
