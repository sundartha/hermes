// P7: Offline-Unit-Test der reinen Telnyx-Assistant-Config-Bau-Funktion.
// Importiert NUR buildAssistantConfig - kein Netz, kein Secret, kein process.exit
// (der isMain-Guard im Skript verhindert main() beim Import; Praezedenz
// test/pay4-smoke-guard.test.js importiert isTestKey aus smoke-stripe-payment.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAssistantConfig } from "../scripts/telnyx-assistant-provision.mjs";

const ARGS = {
  publicUrl: "https://hermes.example",
  voiceId: "voice_xyz",
  voiceModel: "Default",
  apiKeyRef: "elevenlabs_prod",
};

test("buildAssistantConfig: greeting ist leer (Assistant spricht nie zuerst)", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.equal(cfg.greeting, "");
});

test("buildAssistantConfig: Custom-LLM-URL zeigt auf den Shim ohne Doppel-Slash", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.equal(cfg.external_llm.api_base, "https://hermes.example/v1/chat/completions");
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

test("buildAssistantConfig: kein freies Prompt-Feld, keine Disclosure/kein Klartext-Key in der Config", () => {
  const cfg = buildAssistantConfig(ARGS);
  assert.equal("instructions" in cfg, false);
  assert.equal("system_prompt" in cfg, false);
  const serialized = JSON.stringify(cfg);
  assert.equal(serialized.includes("Auftrag"), false); // kein Disclosure-Textfragment
  assert.equal(serialized.includes("sk_"), false); // kein Klartext-Key-Muster
});

test("buildAssistantConfig: deterministisch (gleiche Args -> byte-identische Config)", () => {
  assert.deepEqual(buildAssistantConfig(ARGS), buildAssistantConfig(ARGS));
});
