// P7: Offline-Unit-Test der reinen Telnyx-Assistant-Config-Bau-Funktion.
// Importiert NUR buildAssistantConfig/missingRequired - kein Netz, kein Secret, kein
// process.exit (der isMain-Guard im Skript verhindert main() beim Import; Praezedenz
// test/pay4-smoke-guard.test.js importiert isTestKey aus smoke-stripe-payment.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAssistantConfig, missingRequired, SHIM_ROUTE } from "../scripts/telnyx-assistant-provision.mjs";

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
