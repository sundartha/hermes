import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";
import { startEmpfaenger } from "../gemeinsam/otlp-empfaenger.js";
import { OTLP_MESSWERTE_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const FRIST_MS = 8000;
const MS_JE_S = 1000;
const HTTP_OK = 200;
const LAUFZEIT_S = 50;
const DAUER_S = 42;
const ANNAHME = "hermes.call.answer_time";
const ANRUF_ID = "anr_s14_eindeutig";

const metrikenVon = (export_) =>
  export_.resourceMetrics.flatMap((r) => r.scopeMetrics).flatMap((s) => s.metrics);

const annahmepunkte = (export_) =>
  metrikenVon(export_)
    .filter((m) => m.name === ANNAHME && m.histogram)
    .flatMap((m) => m.histogram.dataPoints);

function warteAufAnnahme(empfaenger) {
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(FRIST_MS).addEventListener("abort", () =>
      reject(new Error("kein Export mit Annahmezeit")),
    );
    const pruefen = () => {
      const punkte = empfaenger.exporte.map(annahmepunkte).findLast((p) => p.length > 0) ?? [];
      if (punkte.length > 0) resolve(punkte);
      else empfaenger.wartende.push(pruefen);
    };
    pruefen();
  });
}

test("EL-Ende S14b: Export mit Annahmezeit enthaelt weder Anruf-ID, Mandanten-ID, Nummern noch conversation_id des angelegten Anrufs", async () => {
  const anruf = seedCall({
    id: ANRUF_ID,
    provider: "telnyx",
    startedAt: new Date(Date.now() - LAUFZEIT_S * MS_JE_S).toISOString(),
    answeredAt: new Date(Date.now() - LAUFZEIT_S * MS_JE_S).toISOString(),
    maxDurationS: 3600,
    fristAbfrageAt: new Date(Date.now() - LAUFZEIT_S * MS_JE_S).toISOString(),
    elevenlabsConversationId: `conv_${ANRUF_ID}`,
  });
  const anbieter = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        conversation_id: anruf.elevenlabsConversationId,
        status: "done",
        transcript: [],
        analysis: null,
        metadata: { call_duration_secs: DAUER_S, error: null },
      }),
    );
  });
  await new Promise((resolve) => anbieter.listen(0, "127.0.0.1", resolve));
  const empfaenger = await startEmpfaenger();
  const srv = await startServer({
    env: {
      ELEVENLABS_OUTBOUND_ENABLED: "true",
      ELEVENLABS_API_KEY: "el-ende-schluessel",
      METRIKEN_OTLP_TOKEN: OTLP_MESSWERTE_TOKEN,
      METRIKEN_INTERVALL_MS: "50",
      FRISTEN_TAKT_MS: "40",
      ELEVENLABS_API_BASE: `http://127.0.0.1:${anbieter.address().port}`,
      METRIKEN_OTLP_URL: empfaenger.url,
    },
    seed: seedState({ calls: [anruf] }),
  });
  try {
    await waitForStoreState(
      srv,
      (s) => s.calls.find((c) => c.id === ANRUF_ID)?.status !== "active",
    );
    const annahme = await warteAufAnnahme(empfaenger);
    assert.equal(annahme.length, 1);
    assert.equal(Number(annahme[0].count), 1);
    const text = JSON.stringify(empfaenger.exporte);
    const kennungen = [
      anruf.id,
      anruf.tenantId,
      anruf.to,
      anruf.from,
      anruf.elevenlabsConversationId,
    ];
    assert.deepEqual(kennungen, [
      ANRUF_ID,
      BOOTSTRAP_TENANT_ID,
      "+4915112345678",
      "+15005550006",
      `conv_${ANRUF_ID}`,
    ]);
    for (const kennung of kennungen)
      assert.ok(!text.includes(kennung), `Export enthaelt ${kennung}`);
  } finally {
    await srv.stop();
    await empfaenger.stop();
    await new Promise((resolve) => anbieter.close(resolve));
  }
});
