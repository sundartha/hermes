import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { startEmpfaenger } from "../gemeinsam/otlp-empfaenger.js";
import { OTLP_MESSWERTE_TOKEN as TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const WARTE_FRIST_MS = 8000;
const MS_JE_S = 1000;
const HTTP_OK = 200;
const ENDE = "hermes.call.ended";
const DAUER = "hermes.call.duration";
const ANNAHME = "hermes.call.answer_time";
const EL_ENV = {
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_API_KEY: "el-ende-schluessel",
  METRIKEN_OTLP_TOKEN: TOKEN,
  METRIKEN_INTERVALL_MS: "50",
};
const FEHLER_403 = {
  code: 403,
  reason: "unexpected status from INVITE response: sip status: 403: Unverified origination number D51 (SIP 403)",
};

const metrikenVon = (export_) => export_.resourceMetrics.flatMap((r) => r.scopeMetrics).flatMap((s) => s.metrics);
const labelsVon = (punkt) => Object.fromEntries(punkt.attributes.map((a) => [a.key, a.value.stringValue]));

const summenVon = (export_, name) =>
  metrikenVon(export_)
    .filter((m) => m.name === name && m.sum)
    .flatMap((m) => m.sum.dataPoints)
    .map((p) => ({ labels: labelsVon(p), wert: Number(p.asInt ?? p.asDouble) }));

const histogrammeVon = (export_, name) =>
  metrikenVon(export_)
    .filter((m) => m.name === name && m.histogram)
    .flatMap((m) => m.histogram.dataPoints)
    .map((p) => ({
      labels: labelsVon(p),
      summe: p.sum,
      anzahl: Number(p.count),
      grenzen: p.explicitBounds,
      eimer: p.bucketCounts.map(Number),
    }));

const bisGrenze = (punkt, sekunden) => {
  const ende = punkt.grenzen.findIndex((grenze) => grenze >= sekunden);
  return punkt.eimer.slice(0, ende + 1).reduce((a, b) => a + b, 0);
};

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

const warteAufEnde = (empfaenger) => warteAuf(empfaenger, (e) => summenVon(e, ENDE));

async function starteAnbieter(gespraeche) {
  const server = http.createServer((req, res) => {
    const id = decodeURIComponent(req.url.split("/").pop().split("?")[0]);
    const gespraech = gespraeche[id];
    res.writeHead(gespraech ? HTTP_OK : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(gespraech ?? {}));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function mitAnbieter({ gespraeche, anrufe }, lauf) {
  const anbieter = await starteAnbieter(gespraeche);
  const empfaenger = await startEmpfaenger();
  const srv = await startServer({
    env: { ...EL_ENV, ELEVENLABS_API_BASE: anbieter.url, METRIKEN_OTLP_URL: empfaenger.url },
    seed: seedState({ calls: anrufe }),
  });
  try {
    return await lauf({ srv, empfaenger });
  } finally {
    await srv.stop();
    await empfaenger.stop();
    await anbieter.close();
  }
}

const vorSekunden = (s) => new Date(Date.now() - s * MS_JE_S).toISOString();

const elAnruf = (id, laufzeitS, zusatz = {}) =>
  seedCall({
    id,
    provider: "telnyx",
    startedAt: vorSekunden(laufzeitS),
    answeredAt: vorSekunden(laufzeitS),
    maxDurationS: 3600,
    elevenlabsConversationId: `conv_${id}`,
    ...zusatz,
  });

const gespraech = (id, status, metadata) => ({ conversation_id: `conv_${id}`, status, transcript: [], analysis: null, metadata });

const beendet = (srv, id) => waitForStoreState(srv, (s) => s.calls.find((c) => c.id === id)?.status !== "active");

test("EL-Ende S7: ein vom Anbieter als beendet gemeldeter Anruf mit 0 s Dauer zaehlt als failed no-answer, nie als completed", async () => {
  const gespraeche = { conv_nie: gespraech("nie", "done", { call_duration_secs: 0, error: null }) };
  await mitAnbieter({ gespraeche, anrufe: [elAnruf("nie", 5)] }, async ({ srv, empfaenger }) => {
    await beendet(srv, "nie");
    const punkte = await warteAufEnde(empfaenger);
    assert.deepEqual(punkte, [{ labels: { direction: "outbound", ergebnis: "failed", grund: "no-answer" }, wert: 1 }]);
    assert.ok(!punkte.some((p) => p.labels.ergebnis === "completed"));
  });
});

test("EL-Ende S25: done mit sip status 403 ohne Dauer zaehlt als failed not-placed", async () => {
  const gespraeche = { conv_abgelehnt: gespraech("abgelehnt", "done", { error: FEHLER_403 }) };
  await mitAnbieter({ gespraeche, anrufe: [elAnruf("abgelehnt", 5)] }, async ({ srv, empfaenger }) => {
    await beendet(srv, "abgelehnt");
    const punkte = await warteAufEnde(empfaenger);
    assert.deepEqual(punkte, [{ labels: { direction: "outbound", ergebnis: "failed", grund: "not-placed" }, wert: 1 }]);
  });
});

test("EL-Ende S12/S13: Dauer 42 s und 600 s landen in den Eimern", async () => {
  const gespraeche = {
    conv_kurz: gespraech("kurz", "done", { call_duration_secs: 42, error: null }),
    conv_lang: gespraech("lang", "done", { call_duration_secs: 600, error: null }),
  };
  const anrufe = [elAnruf("kurz", 50), elAnruf("lang", 605)];
  await mitAnbieter({ gespraeche, anrufe }, async ({ srv, empfaenger }) => {
    await beendet(srv, "kurz");
    await beendet(srv, "lang");
    const dauer = await warteAuf(empfaenger, (e) => {
      const punkte = histogrammeVon(e, DAUER);
      return punkte.length === 1 && punkte[0].anzahl === 2 ? punkte : [];
    });
    assert.deepEqual(dauer[0].labels, { direction: "outbound" });
    assert.ok(Math.abs(dauer[0].summe - 642) < 1, `Summe ${dauer[0].summe}`);
    assert.equal(bisGrenze(dauer[0], 60), 1);
    assert.equal(bisGrenze(dauer[0], 600), 2);
  });
});

test("EL-Ende S14: Anruf vor 50 s angelegt, Anbieterdauer 42 s: genau eine Annahmezeit zwischen 8 und 10 s", async () => {
  const gespraeche = { conv_ein: gespraech("ein", "done", { call_duration_secs: 42, error: null }) };
  await mitAnbieter({ gespraeche, anrufe: [elAnruf("ein", 50)] }, async ({ srv, empfaenger }) => {
    await beendet(srv, "ein");
    const [annahme] = await warteAuf(empfaenger, (e) => histogrammeVon(e, ANNAHME));
    assert.equal(annahme.anzahl, 1);
    assert.ok(annahme.summe >= 8 && annahme.summe < 10, `Summe ${annahme.summe}`);
    const text = JSON.stringify(empfaenger.exporte);
    for (const verboten of ["+4915112345678", "conv_ein", "call_test1"]) assert.ok(!text.includes(verboten));
  });
});

test("EL-Ende S15: 0 s Dauer liefert weder Dauer noch Annahmezeit", async () => {
  const gespraeche = { conv_null: gespraech("null", "done", { call_duration_secs: 0, error: null }) };
  await mitAnbieter({ gespraeche, anrufe: [elAnruf("null", 5)] }, async ({ srv, empfaenger }) => {
    await beendet(srv, "null");
    await warteAufEnde(empfaenger);
    const nachEnde = empfaenger.exporte.length;
    await warteAuf(empfaenger, () => (empfaenger.exporte.length >= nachEnde + 2 ? [true] : []));
    assert.ok(empfaenger.exporte.every((e) => histogrammeVon(e, DAUER).length === 0 && histogrammeVon(e, ANNAHME).length === 0));
  });
});

test("EL-Ende S16: laufendes Gespraech ohne Dauer, dann cancel_call: keine Dauer, keine Annahmezeit", async () => {
  const gespraeche = { conv_lauf: gespraech("lauf", "in-progress", { error: null }) };
  await mitAnbieter({ gespraeche, anrufe: [elAnruf("lauf", 5, { answeredAt: null })] }, async ({ srv, empfaenger }) => {
    const abbruch = await abrufMitFrist(`${srv.localUrl}/api/calls/lauf/cancel`, {
      method: "POST",
      headers: { "X-Internal-Tenant": BOOTSTRAP_TENANT_ID },
    });
    assert.equal(abbruch.status, HTTP_OK);
    await warteAufEnde(empfaenger);
    const nachEnde = empfaenger.exporte.length;
    await warteAuf(empfaenger, () => (empfaenger.exporte.length >= nachEnde + 2 ? [true] : []));
    assert.ok(empfaenger.exporte.every((e) => histogrammeVon(e, DAUER).length === 0 && histogrammeVon(e, ANNAHME).length === 0));
  });
});
