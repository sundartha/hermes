import { config } from "./config.js";

const LOG_PREFIX = "[metrics]";
const MAX_TRACKED_CALLS = 10000;

const LLM_OPTIONAL_FIELDS = Object.freeze([
  "callId",
  "input_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "output_tokens",
]);

const defaultLog = (kind, payload) =>
  console.log(`${LOG_PREFIX} ${kind} ${JSON.stringify(payload)}`);

export function createMetrics({
  enabled = config.metrics.metricsEnabled,
  log = defaultLog,
  now = Date.now,
  maxTrackedCalls = MAX_TRACKED_CALLS,
} = {}) {
  const lastRenderAt = new Map();

  function llmCall({ outcome, attempts, latencyMs, breakerState, ...optional }) {
    if (!enabled) return;
    const payload = { outcome, attempts, latencyMs, breakerState };
    for (const field of LLM_OPTIONAL_FIELDS) {
      if (optional[field] !== undefined) payload[field] = optional[field];
    }
    log("llm", payload);
  }

  function logTurn({ callId, direction, roundtrips, tools }) {
    if (!enabled) return;
    log("turn", { callId, direction, roundtrips, tools });
  }

  function recordTurnRendered(callId) {
    if (!enabled) return;
    if (lastRenderAt.has(callId)) lastRenderAt.delete(callId);
    else if (lastRenderAt.size >= maxTrackedCalls)
      lastRenderAt.delete(lastRenderAt.keys().next().value);
    lastRenderAt.set(callId, now());
  }

  function logTurnGap(callId) {
    if (!enabled) return;
    const prev = lastRenderAt.get(callId);
    if (prev === undefined) return;
    log("stt_gap", { callId, gapMs: now() - prev });
  }

  function logSpeechResult({ callId, chars }) {
    if (!enabled) return;
    log("speech_result", { callId, chars });
  }

  function logCallDenied({ grund, country, language }) {
    if (!enabled) return;
    log("call_denied", { grund, country, language });
  }

  function logSenderFallback({ grund }) {
    if (!enabled) return;
    log("sender_fallback", { grund });
  }

  return {
    llmCall,
    logTurn,
    recordTurnRendered,
    logTurnGap,
    logSpeechResult,
    logCallDenied,
    logSenderFallback,
  };
}

export const metrics = createMetrics();
