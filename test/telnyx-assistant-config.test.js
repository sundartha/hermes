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
  assert.equal(cfg.external_llm.base_url + "/chat/completions", "https://hermes.example" + SHIM_ROUTE);
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
test("afix-p1 (T-neu 11): telephony_settings traegt GENAU user_idle_reply_secs=4", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.deepEqual(cfg.telephony_settings, { user_idle_reply_secs: 4 });
});

test("buildAssistantConfig: Barge-in (interruption_settings) ist an", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.equal(cfg.interruption_settings.enable, true);
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
