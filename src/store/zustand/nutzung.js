import { emptyUsage, PROVIDER, USAGE_EVENT_KIND, MICRO_CENTS_PER_CENT } from "../defaults.js";
import { newId } from "./grundlagen.js";

export function usageFor(state, tenantId) {
  return (state.usage[tenantId] ||= emptyUsage());
}

export function usageOf(state, tenantId) {
  return usageFor(state, tenantId);
}

export function globalUsageTotals(state) {
  let inputTokens = 0,
    outputTokens = 0,
    calls = 0,
    microTotal = 0;
  for (const bucket of Object.values(state.usage)) {
    inputTokens += bucket.inputTokens;
    outputTokens += bucket.outputTokens;
    calls += bucket.calls;
    microTotal += bucket.costCents * MICRO_CENTS_PER_CENT + (bucket.costMicroCentsRem || 0);
  }
  return {
    inputTokens,
    outputTokens,
    calls,
    costCents: Math.floor(microTotal / MICRO_CENTS_PER_CENT),
    costMicroCentsRem: microTotal % MICRO_CENTS_PER_CENT,
  };
}

export function inputTokensOf(tokens) {
  return tokens.inputUncachedTokens + tokens.inputCacheWriteTokens + tokens.inputCacheReadTokens;
}

export function recordUsageEvent(
  state,
  {
    tenantId,
    callId = null,
    numberId = null,
    kind,
    quantity,
    costCents,
    costMicroCents = null,
    occurredAt = new Date().toISOString(),
  },
) {
  if (!Object.values(USAGE_EVENT_KIND).includes(kind))
    throw new Error(`recordUsageEvent: unbekanntes kind '${kind}'`);
  const event = {
    id: newId("ue"),
    tenantId,
    callId,
    numberId,
    kind,
    quantity,
    costCents,
    costMicroCents,
    occurredAt,
    stripeMeterSent: false,
  };
  state.usageEvents.push(event);
  return event;
}

export function dailySmsCount(state, tenantId, sinceIso) {
  return state.usageEvents.filter(
    (usageEvent) => usageEvent.kind === USAGE_EVENT_KIND.SMS && usageEvent.tenantId === tenantId && usageEvent.occurredAt >= sinceIso,
  ).length;
}

export function voiceMinutesUsedSince(state, tenantId, sinceIso) {
  return state.usageEvents
    .filter(
      (usageEvent) =>
        usageEvent.kind === USAGE_EVENT_KIND.VOICE_MINUTE &&
        usageEvent.tenantId === tenantId &&
        usageEvent.occurredAt >= sinceIso,
    )
    .reduce((sum, usageEvent) => sum + usageEvent.quantity, 0);
}

export function planMinutesExceeded(state, tenantId, { includedMinutes, periodStartIso } = {}) {
  if (!periodStartIso || !Number.isFinite(includedMinutes)) return true;
  return voiceMinutesUsedSince(state, tenantId, periodStartIso) >= includedMinutes;
}

export function pendingMeterEvents(state) {
  return state.usageEvents.filter((usageEvent) => !usageEvent.stripeMeterSent);
}

export const METER_FLUSH_SKIP = Object.freeze({ NO_EPOCH: "no_flush_epoch" });

export function markMeterEventsSent(state, eventIds) {
  const ids = new Set(eventIds);
  let sentCount = 0;
  for (const usageEvent of state.usageEvents) {
    if (ids.has(usageEvent.id) && !usageEvent.stripeMeterSent) {
      usageEvent.stripeMeterSent = true;
      sentCount++;
    }
  }
  return sentCount;
}

export function callCostEvidence(state, callId) {
  return state.callCostEvidence
    .filter((zeile) => zeile.callId === callId)
    .sort((links, rechts) => links.traeger.localeCompare(rechts.traeger));
}

export const PLATFORM_TTS_COST_CENTER_ID = "platform:play-tts";

export function ttsQuotaExhausted({ characters, quota }) {
  return quota > 0 && characters >= quota;
}

export function actualCostMicroCentsForMonth(state, monthKey) {
  return state.calls
    .filter(
      (call) =>
        call.provider === PROVIDER.TELNYX &&
        call.costTruedAt !== null &&
        Number.isSafeInteger(call.actualCostMicroCents) &&
        call.actualCostMicroCents >= 0 &&
        call.estimatedCostSpendMonthKey === monthKey,
    )
    .reduce((sum, call) => sum + call.actualCostMicroCents, 0);
}

export function recordTenantTtsCharacters(state, tenantId, chars) {
  if (!Number.isSafeInteger(chars) || chars <= 0) return { changed: false };
  usageFor(state, tenantId).ttsCharacters += chars;
  return { changed: true };
}
