// P7: Offline-Unit-Test der reinen Telnyx-Assistant-Config-Bau-Funktion.
// Importiert NUR buildAssistantConfig/missingRequired - kein Netz, kein Secret, kein
// process.exit (der isMain-Guard im Skript verhindert main() beim Import; Praezedenz
// test/pay4-smoke-guard.test.js importiert isTestKey aus smoke-stripe-payment.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAssistantConfig,
  missingRequired,
  SHIM_ROUTE,
  assistantRequest,
} from "../scripts/telnyx-assistant-provision.mjs";

const ARGS = {
  publicUrl: "https://hermes.example",
  voiceId: "voice_xyz",
  voiceModel: "Default",
  apiKeyRef: "elevenlabs_prod",
  model: "claude-haiku-4-5",
  llmApiKeyRef: "shim_secret_ref",
};

test("buildAssistantConfig: greeting ist leer (Assistant spricht nie zuerst)", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.equal(cfg.greeting, "");
});

test("buildAssistantConfig: reales Custom-LLM-Schema (base_url/model/llm_api_key_ref/forward_metadata)", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.equal(cfg.external_llm.base_url, "https://hermes.example/v1");
  assert.equal("api_base" in cfg.external_llm, false, "kein Doku-Stand-Feld aus dem Vor-Fix");
  assert.equal(cfg.external_llm.model, "claude-haiku-4-5");
  assert.equal(cfg.external_llm.llm_api_key_ref, "shim_secret_ref");
  assert.equal(cfg.external_llm.forward_metadata, true);
  // KEIN top-level model neben external_llm (Telnyx 10015 "Cannot provide both").
  assert.equal("model" in cfg, false, "kein top-level model neben external_llm");
});

test("buildAssistantConfig: base_url + SHIM_ROUTE-Suffix == SHIM_ROUTE (Drift-Test-Invariante)", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.equal(
    cfg.external_llm.base_url + "/chat/completions",
    "https://hermes.example" + SHIM_ROUTE,
  );
});

test("buildAssistantConfig: Ela-Voice-Referenz aus voiceModel + voiceId, apiKeyRef durchgereicht", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.equal(cfg.voice_settings.voice, "ElevenLabs.Default.voice_xyz");
  assert.equal(cfg.voice_settings.api_key_ref, "elevenlabs_prod");
  // afix-p1 Kontrast: das ASSISTANT-voice_settings ist FLACH (Telnyx-Spec: required
  // ["voice"], kein type) - anders als die per `type` diskriminierte Union im Call-
  // Control-speak-Body (voice.js/speakVoiceFields).
  assert.equal("type" in cfg.voice_settings, false);
});

// afix-p1 (T-neu 11): Idle-Nudge-Provisioning. GENAU EIN Feld im telephony_settings-Objekt
// (Deep-Merge-Absicht festgenagelt) - time_limit_secs/recording_settings/etc. sollen den
// Update-POST unberuehrt ueberleben.
// AL-P5: Wert 4 -> 2 (Eroeffnung kuerzen). Der Pin bleibt bewusst ein deepEqual: die
// Invariante ist "GENAU EIN Feld im telephony_settings-Objekt" (Deep-Merge-Absicht) - sie
// darf durch die Wertaenderung nicht verwaessert werden.
test("afix-p1 (T-neu 11): telephony_settings traegt GENAU user_idle_reply_secs=2", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.deepEqual(cfg.telephony_settings, { user_idle_reply_secs: 2 });
});

test("buildAssistantConfig: Barge-in (interruption_settings) ist an", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.equal(cfg.interruption_settings.enable, true);
});

// K1 (PLAN-CONVERSATION-OPTIMIZATION.md): Regressionsbremse gegen versehentliches Abschalten
// von Barge-in. enable MUSS true bleiben, unabhaengig vom Threshold-Tuning-Wert daneben.
// VOICE-24 (tasks/i18n-tests/03-telefonie-render.md): Barge-in im Assistant-Pfad AN - der
// Kontrast zu VOICE-23 (Budget-Engine ohne Barge-in). buildAssistantConfig nimmt kein
// Sprach-Argument; ein "sprachunabhaengig"-Test waere vakuum, deshalb nur dieser Verweis.
test("K1: interruption_settings.enable bleibt true UND interrupt_prediction_threshold=0.4", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.equal(
    cfg.interruption_settings.enable,
    true,
    "Barge-in ist Launch-Pflicht, darf nie aus sein",
  );
  assert.equal(cfg.interruption_settings.interrupt_prediction_threshold, 0.4);
});

// K2 (PLAN-CONVERSATION-OPTIMIZATION.md) ist durch den Owner-Testanruf falsifiziert: das
// Buero-Ambiente lag hoerbar unter der Stimme und passt nicht zu einem persoenlichen
// Assistenten. background_audio traegt weiterhin genau die drei Felder der predefined_media-
// Variante, value steht aber auf "silence" (= laut Spec "disables background audio").
// Der explizite Block ist Absicht und KEIN Ueberbleibsel: der Update-POST ist ein Deep-Merge,
// ein weggelassenes Feld wuerde das live gesetzte "office" stehen lassen (s. Provisioner).
test("K2: voice_settings.background_audio ist predefined_media/silence/0.3", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.deepEqual(cfg.voice_settings.background_audio, {
    type: "predefined_media",
    value: "silence",
    volume: 0.3,
  });
});

test("buildAssistantConfig: instructions gesetzt (Telnyx-Pflichtfeld), aber ohne Disclosure/Klartext-Key (Regel 2)", () => {
  const cfg = buildAssistantConfig(ARGS);
  // Telnyx verlangt non-empty instructions (HTTP 400 10004 sonst); im BYO-Betrieb inert.
  assert.equal(typeof cfg.instructions, "string");
  assert.ok(cfg.instructions.length > 0, "Telnyx-Pflichtfeld muss non-empty sein");
  assert.equal("system_prompt" in cfg, false);
  const serialized = JSON.stringify(cfg);
  // Regel 2: die Offenlegung darf NICHT statisch in der Config stehen (kein Disclosure-Fragment).
  assert.equal(serialized.includes("Auftrag"), false);
  assert.equal(serialized.includes("sk_"), false); // kein Klartext-Key-Muster
});

test("buildAssistantConfig: deterministisch (gleiche Args -> byte-identische Config)", () => {
  assert.deepEqual(buildAssistantConfig(ARGS), buildAssistantConfig(ARGS));
});

// T1/P11: der fail-closed-Gate aus main() (REQUIRED-Filter) als eigene Pruef-Funktion
// getestet - genau die Logik, die das RUNBOOK als "smokePass=false ... fail-closed, nie
// faelschlich gruen" bewirbt.
test("missingRequired: alle Pflichtwerte gesetzt -> leere Liste", () => {
  const required = [
    ["TELNYX_API_KEY", "key_abc"],
    ["PUBLIC_URL", "https://hermes.example"],
  ];
  assert.deepEqual(missingRequired(required), []);
});

test("missingRequired: genau ein Pflichtwert fehlt -> dessen Name in der Liste", () => {
  const required = [
    ["TELNYX_API_KEY", "key_abc"],
    ["PUBLIC_URL", ""],
    ["TELNYX_ELEVENLABS_VOICE_ID", "voice_xyz"],
  ];
  assert.deepEqual(missingRequired(required), ["PUBLIC_URL"]);
});

// AL-P3: nagelt Verschachtelung UND Werte fest - ein flaches Objekt haette Telnyx
// stillschweigend ignoriert (undokumentiertes Feld, kein Fehler-Status beim Drop).
test("AL-P3: start_speaking_plan haengt unter interruption_settings, Endpointing eine Ebene tiefer", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.deepEqual(cfg.interruption_settings.start_speaking_plan, {
    wait_seconds: 0.4,
    transcription_endpointing_plan: {
      on_punctuation_seconds: 0.1,
      on_no_punctuation_seconds: 0.8,
      on_number_seconds: 0.5,
    },
  });
});

// AL-P3: Regressionsschutz fuer "Barge-in bleibt unangetastet" - kein Feld verloren,
// keins dazuerfunden, wenn start_speaking_plan als Schwesterfeld dazukommt.
test("AL-P3: interruption_settings traegt genau enable, interrupt_prediction_threshold, start_speaking_plan", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.deepEqual(Object.keys(cfg.interruption_settings).sort(), [
    "enable",
    "interrupt_prediction_threshold",
    "start_speaking_plan",
  ]);
});

// AL-P3: verankert die Vorpruefungs-Entscheidung GEGEN den Guard-Umzug (PLAN-ASSISTANT-LEAP.md
// Phase 3) - sobald jemand transcription sendet, wird fieldsLostOnUpdate falsch-positiv, und
// dieser Test schlaegt vorher an.
test("AL-P3: transcription wird NICHT gesendet (PRESERVED_SAFETY_FIELDS.transcription bleibt gueltig)", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.equal("transcription" in cfg, false);
});

// afix-p1 (T-neu 12, BUGFIX-Regression): der Update-Request ist POST, NIE PUT - ein PUT
// existiert unter /v2/ai/assistants/{id} laut Telnyx-OpenAPI-Spec nicht (HTTP 404). Ohne
// diesen Fix war das Re-Provisioning (bestehende assistant_id) strukturell tot.
test("afix-p1 (T-neu 12): assistantRequest ist IMMER POST (Update-PUT existiert nicht, HTTP 404)", () => {
  const update = assistantRequest("asst_1");
  assert.equal(update.method, "POST");
  assert.notEqual(update.method, "PUT");
  assert.ok(update.url.endsWith("/v2/ai/assistants/asst_1"));

  const create = assistantRequest("");
  assert.equal(create.method, "POST");
  assert.ok(create.url.endsWith("/v2/ai/assistants"));
});
