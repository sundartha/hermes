// STT-A1: reine Vergleichslogik der Drift-Probe (sttDriftFindings), kein HTTP. Der
// vierte Ort der STT-Wahl (Telnyx-Assistant-Objekt) hat sonst kein Netz (der
// Provisionierer fasst `transcription` bewusst nicht an).
//
// DIE FIXTURE-FORM STAMMT AUS EINEM ECHTEN GET, NICHT AUS DEM CODE. Genau hier lag der
// erste Defekt: Code UND Test nahmen die Einstellungen flach auf `transcription` an,
// tatsaechlich liegen sie unter `transcription.settings`. Beide Seiten waren gleich
// falsch, also war der Test blind (Bestandslehre: eine Pruefung, die ihre beiden Seiten
// aus derselben Quelle zieht, prueft nur sich selbst). Belegform, GET /v2/ai/assistants/<id>
// am 2026-08-06 (Momentaufnahme assistant-snapshot-2026-08-06-nach-nova3.json, gitignored):
//
//   transcription: { model, language, api_key_ref, region,
//                    settings: { smart_format, numerals, eot_threshold, eot_timeout_ms,
//                                eager_eot_threshold, keyterm,
//                                end_of_turn_confidence_threshold, min_turn_silence,
//                                max_turn_silence, interim_results,
//                                enable_endpoint_detection, max_endpoint_delay_ms } }
//
// Telnyx liefert ALLE settings-Schluessel aus, ungesetzte als null - deshalb testet
// "null wird nicht gemeldet" einen echten Live-Zustand, keinen Sonderfall.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sttDriftFindings } from "../scripts/telnyx-stt-drift.mjs";

const NOVA3 = "deepgram/nova-3";
const FLUX = "deepgram/flux";

// Live-Form, gekuerzt auf die im Test benutzten Schluessel.
function assistantTranscription(model, settings = {}) {
  return { model, language: "de", api_key_ref: null, region: null, settings };
}

test("model stimmt, keine gesetzte Einstellung -> keine Befunde", () => {
  const findings = sttDriftFindings({
    expectedModel: NOVA3,
    transcription: assistantTranscription(NOVA3),
  });
  assert.equal(findings.length, 0);
});

test("model abweichend -> genau ein fatal:true, nennt Ist und Soll", () => {
  const findings = sttDriftFindings({
    expectedModel: NOVA3,
    transcription: assistantTranscription(FLUX),
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

// DER LIVE-BEFUND vom 2026-08-06: beide Werte stehen flux-only an einem nova-3-Objekt.
// Dieser Test ist rot, sobald jemand die Verschachtelung wieder flach annimmt.
test("flux-only-Felder unter settings an einem nova-3-Objekt -> zwei fatal:false", () => {
  const findings = sttDriftFindings({
    expectedModel: NOVA3,
    transcription: assistantTranscription(NOVA3, { eot_threshold: 0.9, eot_timeout_ms: 5000 }),
  });
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.fatal === false));
  const messages = findings.map((f) => f.message).join(" ");
  assert.match(messages, /eot_threshold/);
  assert.match(messages, /eot_timeout_ms/);
});

test("flache Einstellungen (die FRUEHERE Fehlannahme) ergeben keinen Befund", () => {
  // Gegenprobe zur Verschachtelung: laege die Logik wieder auf transcription statt auf
  // transcription.settings, waere dieser Test rot - er ist der Waechter der Ebene.
  const findings = sttDriftFindings({
    expectedModel: NOVA3,
    transcription: { model: NOVA3, eot_threshold: 0.9, eot_timeout_ms: 5000 },
  });
  assert.equal(findings.length, 0);
});

test("ungesetzte Einstellungen (null) werden nicht gemeldet", () => {
  const findings = sttDriftFindings({
    expectedModel: NOVA3,
    transcription: assistantTranscription(NOVA3, {
      eot_threshold: null,
      eager_eot_threshold: null,
      keyterm: null,
      min_turn_silence: null,
    }),
  });
  assert.equal(findings.length, 0);
});

test("keyterm gilt laut Spec fuer nova-3 -> kein Befund", () => {
  const findings = sttDriftFindings({
    expectedModel: NOVA3,
    transcription: assistantTranscription(NOVA3, { keyterm: "Hermes" }),
  });
  assert.equal(findings.length, 0);
});

test("soniox-only-Felder an einem nova-3-Objekt -> gemeldet", () => {
  const findings = sttDriftFindings({
    expectedModel: NOVA3,
    transcription: assistantTranscription(NOVA3, { interim_results: true }),
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /interim_results/);
  assert.match(findings[0].message, /soniox\/stt-rt-v4/);
});

// smart_format/numerals tragen in der OpenAPI-Spec KEINE Modell-Einschraenkung; die
// "Deepgram ausser flux"-Aussage steht nur auf der Doku-Seite und gilt dort dem PORTAL.
// Sie als inert zu melden waere eine unbelegte Behauptung - die Probe schweigt dazu.
test("smart_format wird NICHT als inert gemeldet - die Spec kennt dafuer keine Grenze", () => {
  const findings = sttDriftFindings({
    expectedModel: FLUX,
    transcription: assistantTranscription(FLUX, { smart_format: true, numerals: true }),
  });
  assert.equal(findings.length, 0);
});
