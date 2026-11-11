import {
  emptyUsage,
  PROVIDER,
  USAGE_EVENT_KIND,
  MICRO_CENTS_PER_CENT,
  CENTS_PER_EUR,
  TOKENS_PER_M_TOK,
  MODEL_PRICE_RATE_FIELDS,
  USAGE_CORRUPT_REASON,
  isBookableCents,
  isCorrectionCents,
  PROVIDER_RATE_SCALE,
} from "../defaults.js";
import { yearMonthKey, previousMonthStart } from "../../utils/month.js";
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

function worstCasePrice(prices) {
  const rates = Object.values(prices);
  if (!rates.length)
    throw new Error("modelPricesUsd ist leer - keine Preisquelle fuer den Budget-Guard (Regel 1)");
  const worst = {};
  for (const field of MODEL_PRICE_RATE_FIELDS)
    worst[field] = rates.reduce((max, price) => (price[field] > max ? price[field] : max), 0);
  return worst;
}

function priceForModel(model, prices) {
  return Object.hasOwn(prices, model) ? prices[model] : worstCasePrice(prices);
}

export function tokenCostUsd(tokens, cfg) {
  const price = priceForModel(tokens.model, cfg.modelPricesUsd);
  return (
    (tokens.inputUncachedTokens / TOKENS_PER_M_TOK) * price.inPerMTok +
    (tokens.inputCacheWriteTokens / TOKENS_PER_M_TOK) * price.cacheWritePerMTok +
    (tokens.inputCacheReadTokens / TOKENS_PER_M_TOK) * price.cacheReadPerMTok +
    (tokens.outputTokens / TOKENS_PER_M_TOK) * price.outPerMTok
  );
}

export function tokenCostMicroCents(tokens, cfg) {
  return Math.round(tokenCostUsd(tokens, cfg) * cfg.usdToEur * CENTS_PER_EUR * MICRO_CENTS_PER_CENT);
}

export function discardCorruptWrite(usage, kante, wert) {
  console.error(`[usage] grund=${USAGE_CORRUPT_REASON} verworfen kante=${kante} wert=${wert}`);
  return usage;
}

export function denyCorruptUsage(kante, feld, wert) {
  console.error(`[budget] grund=${USAGE_CORRUPT_REASON} kante=${kante} feld=${feld} wert=${wert}`);
  return true;
}

function turnIncrementsBookable(tokens, microInc) {
  return (
    isBookableCents(tokens.inputUncachedTokens) &&
    isBookableCents(tokens.inputCacheWriteTokens) &&
    isBookableCents(tokens.inputCacheReadTokens) &&
    isBookableCents(tokens.outputTokens) &&
    isBookableCents(microInc)
  );
}

export function parseValidDate(nowIso) {
  const at = new Date(nowIso);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function spendMonthKeyOf(nowIso) {
  const at = parseValidDate(nowIso);
  return at ? yearMonthKey(at) : null;
}

export function previousMonthKeyOf(nowIso) {
  const at = parseValidDate(nowIso);
  if (at === null) return null;
  return yearMonthKey(previousMonthStart(at));
}

export function laterMonotonicKey(storedKey, nowKey) {
  if (!nowKey) return storedKey ?? null;
  if (!storedKey) return nowKey;
  return storedKey > nowKey ? storedKey : nowKey;
}

function authoritativeSpendMonthKey(storedKey, nowKey) {
  return laterMonotonicKey(storedKey, nowKey);
}

export function spendMonthUsageCents(bucket, nowIso) {
  if (!spendMonthCounterCurrent(bucket, nowIso)) return 0;
  return Math.max(0, bucket.spendMonthCostCents);
}

export function spendMonthCounterCurrent(bucket, nowIso) {
  return spendMonthWindowKey(bucket, nowIso) === bucket.spendMonthKey;
}

export function spendMonthWindowKey(bucket, nowIso) {
  return authoritativeSpendMonthKey(bucket.spendMonthKey, spendMonthKeyOf(nowIso));
}

export function bookCents(state, { tenantId, cents, nowIso }) {
  const usage = usageFor(state, tenantId);
  usage.costCents += cents;
  const key = authoritativeSpendMonthKey(usage.spendMonthKey, spendMonthKeyOf(nowIso));
  if (key === null) return;
  usage.spendMonthCostCents = key === usage.spendMonthKey ? usage.spendMonthCostCents + cents : cents;
  usage.spendMonthKey = key;
}

export function carryMicroRemainder(remMicro, incrementMicro, divisor) {
  const totalMicro = remMicro + incrementMicro;
  return { carryCents: Math.floor(totalMicro / divisor), remMicro: totalMicro % divisor };
}

export function tokenNutzungBuchen(state, { tenantId, tokens, cfg, nowIso }) {
  const usage = usageFor(state, tenantId);
  const microInc = tokenCostMicroCents(tokens, cfg);
  if (!turnIncrementsBookable(tokens, microInc))
    return discardCorruptWrite(usage, `trackUsage tenant:${tenantId}`, microInc);
  usage.inputTokens += inputTokensOf(tokens);
  usage.outputTokens += tokens.outputTokens;
  const { carryCents, remMicro } = carryMicroRemainder(usage.costMicroCentsRem, microInc, MICRO_CENTS_PER_CENT);
  bookCents(state, { tenantId, cents: carryCents, nowIso });
  usage.costMicroCentsRem = remMicro;
  return usage;
}

export function kostenCentsBuchen(state, { tenantId, costCents, nowIso, quelle }) {
  const usage = usageFor(state, tenantId);
  if (!isBookableCents(costCents))
    return discardCorruptWrite(usage, `${quelle} tenant:${tenantId}`, costCents);
  bookCents(state, { tenantId, cents: costCents, nowIso });
  return usage;
}

export const NO_CHARGE_ANCHORS = Object.freeze({ spendMonthKey: null, periodKey: null });

const CORRECTION_DIVISOR = MICRO_CENTS_PER_CENT * PROVIDER_RATE_SCALE;

export function convertProviderMicroToBucketCents({ remMicro, actualCostMicroCents, providerToBucketRateMicro }) {
  const safeRemMicro =
    Number.isSafeInteger(remMicro) && remMicro >= 0 && remMicro < CORRECTION_DIVISOR ? remMicro : 0;
  const { carryCents, remMicro: carriedRem } = carryMicroRemainder(
    safeRemMicro,
    actualCostMicroCents * providerToBucketRateMicro,
    CORRECTION_DIVISOR,
  );
  return { bucketCents: carryCents, remMicro: carriedRem };
}

function creditHitsSpendMonth(bucket, spendMonthKey, nowIso) {
  return (
    spendMonthKey !== null &&
    spendMonthKey === bucket.spendMonthKey &&
    spendMonthCounterCurrent(bucket, nowIso)
  );
}

function creditHitsBudgetPeriod(bucket, periodKey) {
  return periodKey === bucket.budgetPeriodKey;
}

function applyCreditCents(state, { tenantId, deltaCents, chargeAnchors, nowIso }) {
  const usage = usageFor(state, tenantId);
  const vorher = usage.costCents;
  usage.costCents = Math.max(0, vorher + deltaCents);
  const wirksam = usage.costCents - vorher;
  if (creditHitsSpendMonth(usage, chargeAnchors.spendMonthKey, nowIso))
    usage.spendMonthCostCents += wirksam;
  if (!creditHitsBudgetPeriod(usage, chargeAnchors.periodKey))
    usage.budgetPeriodBaselineCents = Math.max(0, usage.budgetPeriodBaselineCents + wirksam);
}

export function bookCostCorrectionCents(state, { tenantId, deltaCents, chargeAnchors, nowIso }) {
  const usage = usageFor(state, tenantId);
  if (!isCorrectionCents(deltaCents))
    return { usage: discardCorruptWrite(usage, `bookCostCorrectionCents tenant:${tenantId}`, deltaCents), booked: false };
  if (deltaCents > 0) bookCents(state, { tenantId, cents: deltaCents, nowIso });
  else if (deltaCents < 0) applyCreditCents(state, { tenantId, deltaCents, chargeAnchors, nowIso });
  return { usage, booked: true };
}

export function kostenKorrekturBuchen(
  state,
  { tenantId, nowIso, korrektur: { actualCostMicroCents, estimatedCostCents, providerToBucketRateMicro, dataComplete,
    chargeAnchors = NO_CHARGE_ANCHORS } },
) {
  const usage = usageFor(state, tenantId);
  const { bucketCents, remMicro } = convertProviderMicroToBucketCents({
    remMicro: usage.costCorrectionMicroCentsRem,
    actualCostMicroCents,
    providerToBucketRateMicro,
  });
  const deltaCents = bucketCents - estimatedCostCents;
  if (deltaCents < 0 && !dataComplete) return { usage, booked: false, deltaCents };
  const booked = bookCostCorrectionCents(state, { tenantId, deltaCents, chargeAnchors, nowIso });
  if (!booked.booked) return { usage, booked: false, deltaCents };
  usage.costCorrectionMicroCentsRem = remMicro;
  return { usage, booked: true, deltaCents };
}
