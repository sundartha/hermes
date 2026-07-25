// GAP-22 (tasks/i18n-tests/11-luecken-und-e2e.md): das Turn-Budget aus config.js (LLM-
// Retries + Backoff) rechnet sich gegen den Provider-Webhook-Hardcut (Twilio/Telnyx kappen
// einen unbeantworteten Webhook nach 15 s), enthaelt aber weder die Play-TTS-Synthese noch
// eine Netzreserve. Reine Rechnung (kein Latenz-Timing, kein Server-Spawn noetig - s.
// Workflow-Auftrag: "GAP-22 rechnet das Budget nach ... es ist KEINE Latenzmessung").
//
// DATA_DIR VOR dem ersten config-Import (Repo-Regel).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir, seedState } from "./helpers.js";

// Provider-Webhook-Hardcut: EIN dokumentierter externer Vertragswert (Twilio kappt einen
// unbeantworteten Webhook nach 15 s, s. src/config.js:145 Kommentar "Twilio kappt nach
// 15 s hart") - kein Produktionswert, reiner Test-Anker fuer diese Rechnung.
const PROVIDER_WEBHOOK_HARDCUT_MS = 15000;

let config;
before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({}));
  ({ config } = await import("../src/config.js"));
});

test("GAP-22 (SOLL rot): Turn-Budget (LLM-Retries+Backoff) PLUS Play-TTS-Synthese bleibt unter dem 15s-Provider-Hardcut", () => {
  const llmBudgetMs =
    (config.llm.llmMaxRetries + 1) * config.llm.llmRequestTimeoutMs + 2 * config.llm.llmBackoffMs;
  const synthMs = config.voice.elevenLabsPlayTts.synthTimeoutMs;
  const totalMs = llmBudgetMs + synthMs;
  assert.ok(
    totalMs < PROVIDER_WEBHOOK_HARDCUT_MS,
    `Turn-Budget (${llmBudgetMs}ms) + Play-TTS-Synthese (${synthMs}ms) = ${totalMs}ms erreicht/ueberschreitet ` +
      `den Provider-Hardcut von ${PROVIDER_WEBHOOK_HARDCUT_MS}ms (Launch-Blocker: der dokumentierte ` +
      `Rechenweg in config.js enthaelt weder Synthese noch Netzreserve)`,
  );
});
