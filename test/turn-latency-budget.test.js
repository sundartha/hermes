// GAP-22 (tasks/i18n-tests/11-luecken-und-e2e.md): das Turn-Budget aus config.js (LLM-
// Retries + Backoff) rechnet sich gegen den Provider-Webhook-Hardcut (Twilio/Telnyx kappen
// einen unbeantworteten Webhook nach 15 s), UND enthaelt jetzt zusaetzlich die Play-TTS-
// Synthese sowie eine Netzreserve (src/turn-budget.js, EINE Quelle). Reine Rechnung
// (kein Latenz-Timing, kein Server-Spawn noetig - s. Workflow-Auftrag: "GAP-22 rechnet
// das Budget nach ... es ist KEINE Latenzmessung").
//
// DATA_DIR VOR dem ersten config-Import (Repo-Regel).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "./helpers.js";
import { PROVIDER_WEBHOOK_HARDCUT_MS, turnBudgetMs } from "../src/turn-budget.js";

let config;
before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({}));
  // Determinismus-Pflicht (Lehre test-base-env-drift): dieser Test wandert in die
  // Regressionssuite und src/config.js liest per dotenv eine lokale .env. "" -> der
  // dokumentierte Fallback greift, der Test misst damit die AUSGELIEFERTE Konfiguration.
  for (const k of ["LLM_REQUEST_TIMEOUT_MS", "LLM_MAX_RETRIES", "LLM_BACKOFF_MS", "ELEVENLABS_SYNTH_TIMEOUT_MS"])
    process.env[k] = "";
  ({ config } = await import("../src/config.js"));
});

test("Turn-Budget plus Play-TTS-Synthese bleibt unter dem 15-s-Provider-Hardcut (GAP-22)", () => {
  const totalMs = turnBudgetMs({
    requestTimeoutMs: config.llm.llmRequestTimeoutMs,
    maxRetries: config.llm.llmMaxRetries,
    backoffMs: config.llm.llmBackoffMs,
    synthTimeoutMs: config.voice.elevenLabsPlayTts.synthTimeoutMs,
  });
  assert.ok(
    totalMs < PROVIDER_WEBHOOK_HARDCUT_MS,
    `Turn-Budget (inkl. Play-TTS-Synthese + Netzreserve) = ${totalMs}ms erreicht/ueberschreitet ` +
      `den Provider-Hardcut von ${PROVIDER_WEBHOOK_HARDCUT_MS}ms`,
  );
});
