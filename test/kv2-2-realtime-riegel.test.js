// KV2-2 (h): der Boot-Riegel gegen den Realtime-Flip ohne Kostentraeger-Einsammler
// (openai_realtime). Abnahmekriterium (h) aus tasks/kostenv2/spec-kv2-2.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { latentCostPathFindings, LATENT_COST_PATH_FINDING } from "../src/boot-guard.js";
import { hatEinsammler, KOSTENART } from "../src/billing/kostenarten.js";
import { startServerExpectExit, startServer } from "./helpers.js";

const HTTP_OK = 200;
const ERWARTETE_BEFUNDANZAHL = 2;

test("KV2-2-h1: VOICE_ENGINE=budget (alle drei Argumente false) erzeugt den Befund NICHT", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: false,
    realtimeEngineSelected: false,
    realtimeMidCallBudgetCheck: false,
    realtimeCarrierHasCollector: false,
  });
  assert.deepEqual(findings, []);
});

test("KV2-2-h2: realtimeEngineSelected + kein Einsammler -> genau ein fataler Befund mit Handlung", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: false,
    realtimeEngineSelected: true,
    realtimeMidCallBudgetCheck: true,
    realtimeCarrierHasCollector: false,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, LATENT_COST_PATH_FINDING.REALTIME_CARRIER_UNCOLLECTED);
  assert.equal(findings[0].fatal, true);
  assert.match(findings[0].message, /openai_realtime/);
  assert.match(findings[0].message, /Handlung:/);
});

test("KV2-2-h3 (Sache, nicht Schalter): dieselbe Lage, aber ein Einsammler existiert -> kein Befund", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: false,
    realtimeEngineSelected: true,
    realtimeMidCallBudgetCheck: true,
    realtimeCarrierHasCollector: true,
  });
  assert.deepEqual(findings, [], "der Riegel haengt am Kostenpfad, nicht am Schalternamen");
});

test("KV2-2-h4 (zwei Labels, 4.8): beides fehlt -> zwei Befunde mit verschiedenen Codes, nur einer fatal", () => {
  const findings = latentCostPathFindings({
    playTtsEnabled: false,
    realtimeEngineSelected: true,
    realtimeMidCallBudgetCheck: false,
    realtimeCarrierHasCollector: false,
  });
  assert.equal(findings.length, ERWARTETE_BEFUNDANZAHL);
  const codes = findings.map((finding) => finding.code).sort();
  assert.deepEqual(codes, [
    LATENT_COST_PATH_FINDING.REALTIME_CARRIER_UNCOLLECTED,
    LATENT_COST_PATH_FINDING.REALTIME_NO_MIDCALL_BUDGET,
  ].sort());
  const midcall = findings.find(
    (finding) => finding.code === LATENT_COST_PATH_FINDING.REALTIME_NO_MIDCALL_BUDGET,
  );
  assert.equal(midcall.fatal, false, "REALTIME_NO_MIDCALL_BUDGET bleibt WARN");
});

test("KV2-2-h5 (Verdrahtung): VOICE_ENGINE=realtime am gespawnten Server -> exit(1), keine Gateway-Zeile", async () => {
  const { code, output } = await startServerExpectExit({ env: { VOICE_ENGINE: "realtime" } });
  assert.equal(code, 1);
  assert.match(output, /\[boot\] Start abgebrochen/);
  assert.match(output, /openai_realtime/);
  assert.doesNotMatch(output, /Gateway laeuft/);
});

test("KV2-2-h6 (Gegenprobe): Budget-Engine (Default) bootet sauber, kein realtime_carrier_uncollected", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, HTTP_OK);
    assert.doesNotMatch(srv.stdout, /realtime_carrier_uncollected/);
  } finally {
    await srv.stop();
  }
});

test("KV2-2-h7: die Registry-Ableitung selbst - hatEinsammler(openai_realtime)===false, hatEinsammler(telnyx_sip)===true", () => {
  assert.equal(hatEinsammler(KOSTENART.OPENAI_REALTIME), false);
  assert.equal(hatEinsammler(KOSTENART.TELNYX_SIP), true);
});
