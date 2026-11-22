import { z } from "zod";
import { config } from "./config.ts";
import { LOG_PREFIX } from "./utils/messzeilen-marke.ts";

export { LOG_PREFIX };

const MAX_TRACKED_CALLS = 10000;

const METRICS_KONFIG = z.object({ metrics: z.object({ metricsEnabled: z.boolean() }) });

const LLM_OPTIONAL_FIELDS = Object.freeze([
  "callId",
  "input_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "output_tokens",
] as const);

type Log = (kind: string, payload: object) => void;

interface MetricsOptions {
  enabled?: boolean;
  log?: Log;
  now?: () => number;
  maxTrackedCalls?: number;
}

type LlmOptionalFeld = (typeof LLM_OPTIONAL_FIELDS)[number];

type LlmCallEingabe = {
  outcome: unknown;
  attempts: unknown;
  latencyMs: unknown;
  breakerState: unknown;
} & Partial<Record<LlmOptionalFeld, unknown>>;

interface TurnEingabe {
  callId: unknown;
  direction: unknown;
  roundtrips: unknown;
  tools: unknown;
}

const defaultLog: Log = (kind, payload) => {
  console.log(`${LOG_PREFIX} ${kind} ${JSON.stringify(payload)}`);
};

interface Metrics {
  llmCall: (eingabe: LlmCallEingabe) => void;
  logTurn: (eingabe: TurnEingabe) => void;
  recordTurnRendered: (callId: unknown) => void;
  logTurnGap: (callId: unknown) => void;
  logSpeechResult: (eingabe: { callId: unknown; chars: unknown }) => void;
  logCallDenied: (eingabe: { grund: unknown; country: unknown; language: unknown }) => void;
  logCallCapacity: (eingabe: { detail: unknown }) => void;
}

export function createMetrics({
  enabled = METRICS_KONFIG.parse(config).metrics.metricsEnabled,
  log = defaultLog,
  now = Date.now,
  maxTrackedCalls = MAX_TRACKED_CALLS,
}: MetricsOptions = {}): Metrics {
  const lastRenderAt = new Map<unknown, number>();

  function llmCall({
    outcome,
    attempts,
    latencyMs,
    breakerState,
    ...optional
  }: LlmCallEingabe): void {
    if (!enabled) return;
    const payload: Record<string, unknown> = { outcome, attempts, latencyMs, breakerState };
    for (const field of LLM_OPTIONAL_FIELDS) {
      if (optional[field] !== undefined) payload[field] = optional[field];
    }
    log("llm", payload);
  }

  function logTurn({ callId, direction, roundtrips, tools }: TurnEingabe): void {
    if (!enabled) return;
    log("turn", { callId, direction, roundtrips, tools });
  }

  function recordTurnRendered(callId: unknown): void {
    if (!enabled) return;
    if (lastRenderAt.has(callId)) lastRenderAt.delete(callId);
    else if (lastRenderAt.size >= maxTrackedCalls)
      lastRenderAt.delete(lastRenderAt.keys().next().value);
    lastRenderAt.set(callId, now());
  }

  function logTurnGap(callId: unknown): void {
    if (!enabled) return;
    const prev = lastRenderAt.get(callId);
    if (prev === undefined) return;
    log("stt_gap", { callId, gapMs: now() - prev });
  }

  function logSpeechResult({ callId, chars }: { callId: unknown; chars: unknown }): void {
    if (!enabled) return;
    log("speech_result", { callId, chars });
  }

  function logCallDenied({ grund, country, language }: { grund: unknown; country: unknown; language: unknown }): void {
    if (!enabled) return;
    log("call_denied", { grund, country, language });
  }

  function logCallCapacity({ detail }: { detail: unknown }): void {
    if (!enabled) return;
    log("call_capacity", { detail });
  }

  return {
    llmCall,
    logTurn,
    recordTurnRendered,
    logTurnGap,
    logSpeechResult,
    logCallDenied,
    logCallCapacity,
  };
}

export const metrics = createMetrics();
