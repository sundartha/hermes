// Stripe-Metering-Flush (P6b3): aggregiert den append-only usage_event-Ledger je
// tenant+kind und meldet EIN Meter-Event pro (Tenant,kind) an den Billing-Port
// (billing.reportMeter), dann markiert er die gemeldeten Events stripe_meter_sent.
// Reine Fn ueber s + injiziertes deps.billing (DIP, wie provisionNumber): KEIN
// store.save() (Aufrufer persistiert), KEIN config-Zugriff (Parameter hereingereicht),
// KEIN Stripe-Objekt (nur kind/quantity/cost ueber den Port). Idempotent:
// bereits gesendete Events (stripeMeterSent) werden NIE erneut gemeldet.
import { pendingMeterEvents, markMeterEventsSent } from "../store/state-ops.js";

// Aggregiert die NOCH NICHT gesendeten usage_event-Zeilen je (tenantId, kind):
// summiert quantity + costCents, sammelt die Event-ids (in stabiler Reihenfolge).
// Liefert eine Liste [{ tenantId, kind, quantity, costCents, eventIds }]. Reine
// Query (kein save). Gruppiert ueber eine GESCHACHTELTE Map (tenantId -> kind ->
// Aggregat): so gibt es keinen String-Delimiter und damit keine Kollision zwischen
// beliebigen tenantId- und kind-Strings.
export function aggregatePendingMeters(s) {
  const byTenant = new Map();
  for (const e of pendingMeterEvents(s)) {
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

// Stabiler Idempotency-Key je Aggregat: meter_<tenant>_<kind>_<kleinste-eventId>.
// Stripe-Retry meldet damit nie doppelt (analog hold_/order_ in P6b1).
function meterIdempotencyKey({ tenantId, kind, eventIds }) {
  const minId = [...eventIds].sort()[0];
  return `meter_${tenantId}_${kind}_${minId}`;
}

// Sendet je Aggregat EIN reportMeter und markiert dessen Events sent. Idempotent:
// stripeMeterSent verhindert die Doppel-Meldung beim zweiten Flush. billing kann
// werfen -> dieses Aggregat bleibt UNgesendet (Events bleiben pending, naechster
// Flush holt sie nach); andere Aggregate werden NICHT blockiert (Best-Effort je
// Tenant/kind, Reihenfolge stabil). Liefert { sent, failed } fuers Audit (KEINE
// Event-Inhalte, kein Secret).
export async function flushMeters(s, { billing }) {
  let sent = 0;
  let failed = 0;
  for (const agg of aggregatePendingMeters(s)) {
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
  return { sent, failed };
}
