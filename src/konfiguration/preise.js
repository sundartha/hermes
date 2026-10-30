export const FX_MICRO_PER_UNIT = 1_000_000;

export const EXCHANGE_RATE_DEFAULTS = Object.freeze({
  usdToEur: 0.92,
});

const ANTHROPIC_PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing.md";
const DEEPSEEK_PRICING_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing";

export const MODEL_PRICE_SCHEDULES = Object.freeze({
  "claude-haiku-4-5": [
    {
      validFrom: "2026-08-08",
      inPerMTok: 1.0,
      cacheWritePerMTok: 1.25,
      cacheReadPerMTok: 0.1,
      outPerMTok: 5.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
  ],
  "claude-sonnet-5": [
    {
      validFrom: "2026-08-08",
      inPerMTok: 2.0,
      cacheWritePerMTok: 2.5,
      cacheReadPerMTok: 0.2,
      outPerMTok: 10.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
    {
      validFrom: "2026-09-01",
      inPerMTok: 3.0,
      cacheWritePerMTok: 3.75,
      cacheReadPerMTok: 0.3,
      outPerMTok: 15.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
  ],
  "deepseek-v4-pro": [
    {
      validFrom: "2026-08-07",
      inPerMTok: 0.435,
      cacheWritePerMTok: 0.435,
      cacheReadPerMTok: 0.003625,
      outPerMTok: 0.87,
      asOf: "2026-08-07",
      source: DEEPSEEK_PRICING_SOURCE,
    },
  ],
});

const ISO_DATE_LENGTH = 10;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function todayIsoDate() {
  return new Date().toISOString().slice(0, ISO_DATE_LENGTH);
}

function assertScheduleEntry(rateFields, modelId, entry) {
  if (!ISO_DATE_PATTERN.test(entry?.validFrom ?? ""))
    throw new Error(`modelPricesUsd: Staffel '${modelId}' ohne gueltiges validFrom (YYYY-MM-DD)`);
  for (const field of rateFields) {
    const rate = entry[field];
    if (!Number.isFinite(rate) || rate < 0)
      throw new Error(
        `modelPricesUsd: Staffel '${modelId}' ab ${entry.validFrom} hat keine gueltige Rate ` +
          `${field} (${rate}) - vier Raten sind Pflicht`,
      );
  }
}

function activeSchedule(entries, todayIso) {
  return entries
    .filter((entry) => entry.validFrom <= todayIso)
    .reduce(
      (latest, entry) => (latest === null || entry.validFrom > latest.validFrom ? entry : latest),
      null,
    );
}

function nextValidFrom(entries, todayIso) {
  const future = entries
    .filter((entry) => entry.validFrom > todayIso)
    .map((entry) => entry.validFrom);
  return future.length ? future.reduce((min, date) => (date < min ? date : min)) : null;
}

export function modellpreiseAufloesen(rateFields, schedules, todayIso) {
  const modelIds = Object.keys(schedules);
  if (!modelIds.length)
    throw new Error(
      "modelPricesUsd: keine Preisstaffel hinterlegt - keine Preisquelle fuer den Budget-Guard (Regel 1)",
    );
  const resolved = {};
  for (const modelId of modelIds) {
    const entries = schedules[modelId];
    for (const entry of entries) assertScheduleEntry(rateFields, modelId, entry);
    const active = activeSchedule(entries, todayIso);
    if (!active)
      throw new Error(
        `modelPricesUsd: Modell '${modelId}' hat am ${todayIso} keine gueltige Preisstaffel ` +
          "(kein validFrom liegt in der Vergangenheit)",
      );
    resolved[modelId] = { ...active, nextValidFrom: nextValidFrom(entries, todayIso) };
  }
  return resolved;
}
