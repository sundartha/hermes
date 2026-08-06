// STT-A1: reine Vergleichslogik der Drift-Probe (sttDriftFindings), kein HTTP. Der
// vierte Ort der STT-Wahl (Telnyx-Assistant-Objekt) hat sonst kein Netz (der
// Provisionierer fasst `transcription` bewusst nicht an).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sttDriftFindings } from "../scripts/telnyx-stt-drift.mjs";

const NOVA3 = "deepgram/nova-3";
const FLUX = "deepgram/flux";

test("model stimmt, keine weiteren Schluessel -> keine Befunde", () => {
  const findings = sttDriftFindings({ expectedModel: NOVA3, transcription: { model: NOVA3 } });
  assert.equal(findings.length, 0);
});

test("model abweichend -> genau ein fatal:true, nennt Ist und Soll", () => {
  const findings = sttDriftFindings({
    expectedModel: NOVA3,
    transcription: { model: FLUX },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, true);
  assert.match(findings[0].message, new RegExp(FLUX.replace("/", "\\/")));
  assert.match(findings[0].message, new RegExp(NOVA3.replace("/", "\\/")));
});

test("transcription fehlt -> fatal:true, nennt den englisch-only Default", () => {
  const findings = sttDriftFindings({ expectedModel: NOVA3, transcription: undefined });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, true);
  assert.match(findings[0].message, /englisch-only/);
});

test("flux-only-Felder an einem nova-3-Objekt -> zwei fatal:false, kein fatales", () => {
  const findings = sttDriftFindings({
    expectedModel: NOVA3,
    transcription: { model: NOVA3, eot_threshold: 0.9, eot_timeout_ms: 5000 },
  });
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.fatal === false));
  const messages = findings.map((f) => f.message).join(" ");
  assert.match(messages, /eot_threshold/);
  assert.match(messages, /eot_timeout_ms/);
});

test("keyterm gilt fuer nova-3 -> kein Befund", () => {
  const findings = sttDriftFindings({
    expectedModel: NOVA3,
    transcription: { model: NOVA3, keyterm: ["Hermes"] },
  });
  assert.equal(findings.length, 0);
});

test("smart_format gilt fuer Deepgram ausser flux -> ein fatal:false an einem flux-Objekt", () => {
  const findings = sttDriftFindings({
    expectedModel: FLUX,
    transcription: { model: FLUX, smart_format: true },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, false);
  assert.match(findings[0].message, /smart_format/);
});
