import {
  flushableMeterEvents,
  METER_FLUSH_SKIP,
  markMeterEventsSent,
  voiceMinutesUsedSince,
  planMinutesExceeded,
} from "../store/state-ops.js";
import { findPlan } from "../plans.js";
import { resolvePeriodStartIso } from "./period.js";
import { includedMinutesFor } from "./plan-caps.js";

export function aggregateMeterEvents(events) {
  const byTenant = new Map();
  for (const e of events) {
    if (!byTenant.has(e.tenantId)) byTenant.set(e.tenantId, new Map());
    const byKind = byTenant.get(e.tenantId);
    let agg = byKind.get(e.kind);
    if (!agg) {
      agg = { tenantId: e.tenantId, kind: e.kind, quantity: 0, costCents: 0, eventIds: [] };
      byKind.set(e.kind, agg);
    }
    agg.quantity += e.quantity;
    agg.costCents += e.costCents;
    agg.eventIds.push(e.id);
  }
  return [...byTenant.values()].flatMap((byKind) => [...byKind.values()]);
}

function meterIdempotencyKey({ tenantId, kind, eventIds }) {
  const minId = [...eventIds].sort()[0];
  return `meter_${tenantId}_${kind}_${minId}`;
}

export async function flushMeters(s, { billing, flushEpochIso }) {
  const { events, skipped, skipReason } = flushableMeterEvents(s, { flushEpochIso });
  if (skipReason === METER_FLUSH_SKIP.NO_EPOCH)
    console.warn(
      `[meter] kein Flush-Stichtag (BILLING_FLUSH_EPOCH) - nichts gemeldet, ${skipped} Zeile(n) zurueckgehalten.`,
    );
  let sent = 0;
  let failed = 0;
  for (const agg of aggregateMeterEvents(events)) {
    try {
      await billing.reportMeter({
        tenantRef: agg.tenantId,
        kind: agg.kind,
        quantity: agg.quantity,
        costCents: agg.costCents,
        idempotencyKey: meterIdempotencyKey(agg),
      });
      markMeterEventsSent(s, agg.eventIds);
      sent++;
    } catch (err) {
      failed++;
      console.error("[meter] reportMeter fehlgeschlagen:", err.message);
    }
  }
  return { sent, failed, skipped, skipReason };
}

export function quotaView(
  s,
  { tenantId, planSlug, currentPeriodStart, currentPeriodEnd, periodCreditRevoked },
) {
  const plan = planSlug ? findPlan(planSlug) : null;
  if (!plan) return null;
  const includedMinutes = includedMinutesFor({ plan, subscription: { periodCreditRevoked } });
  const periodStartIso = resolvePeriodStartIso({ currentPeriodStart, currentPeriodEnd });
  const exhausted = planMinutesExceeded(s, tenantId, { includedMinutes, periodStartIso });
  const usedMinutes = periodStartIso ? voiceMinutesUsedSince(s, tenantId, periodStartIso) : 0;
  const remainingMinutes = exhausted ? 0 : Math.max(0, includedMinutes - usedMinutes);
  return { includedMinutes, usedMinutes, remainingMinutes, exhausted };
}

export function tenantQuotaView(store, tenantId) {
  const { planSlug, currentPeriodStart, currentPeriodEnd, periodCreditRevoked } =
    store.tenantSubscription(tenantId);
  return quotaView(store.load(), {
    tenantId,
    planSlug,
    currentPeriodStart,
    currentPeriodEnd,
    periodCreditRevoked,
  });
}

const FULL_PERCENT = 100;

export function planUsagePercent(quota) {
  if (!quota) return null;
  if (quota.exhausted) return FULL_PERCENT;
  return Math.floor((quota.usedMinutes / quota.includedMinutes) * FULL_PERCENT);
}
