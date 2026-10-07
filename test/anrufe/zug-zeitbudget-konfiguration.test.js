import assert from "node:assert/strict";
import { test, before } from "node:test";
import { tempDataDir, seedState } from "../helpers.js";
import { PROVIDER_WEBHOOK_HARDCUT_MS, turnBudgetMs } from "../../src/turn-budget.js";

let config;
before(async () => {
  process.env.DATA_DIR = tempDataDir(seedState({}));
  process.env.LLM_REQUEST_TIMEOUT_MS = "";
  process.env.LLM_MAX_RETRIES = "";
  process.env.LLM_BACKOFF_MS = "";
  process.env.ELEVENLABS_SYNTH_TIMEOUT_MS = "";
  ({ config } = await import("../../src/config.js"));
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
