// P6b3: append-only usage_event-Ledger + Stripe-Meter-Aggregation/Flush. Prueft die
// INVARIANTEN (4) Aggregation je kind, (5) Flush-Idempotenz (stripe_meter_sent),
// (6) cost_cents Ganzzahl + kind-Validierung - rein ueber state-ops + billing/meter
// + fakeBilling (kein Netz, kein Server, kein pglite). usage_event ist die Meter-
// Quelle, NICHT das Budget-Gate (getrennte Quelle, kein Doppelzaehlen).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, recordUsageEvent, pendingMeterEvents } from "../src/store/state-ops.js";
import { aggregatePendingMeters, flushMeters } from "../src/billing/meter.js";
import { USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { fakeBilling } from "./helpers.js";

const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";

test("INV(6): recordUsageEvent speichert Cents als Ganzzahl + setzt Defaults", () => {
  const s = makeDefaultState();
  const ev = recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "call_1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 3,
    costCents: 150,
  });
  assert.match(ev.id, /^ue_/);
  assert.equal(ev.costCents, 150);
  assert.equal(Number.isInteger(ev.costCents), true, "costCents Ganzzahl");
  assert.equal(ev.stripeMeterSent, false, "frisch ungesendet");
  assert.equal(typeof ev.occurredAt, "string");
});

test("INV(6b): recordUsageEvent wirft bei unbekanntem kind (fail-closed)", () => {
  const s = makeDefaultState();
  assert.throws(
    () => recordUsageEvent(s, { tenantId: TENANT_A, kind: "fantasie", quantity: 1, costCents: 0 }),
    /unbekanntes kind/,
  );
  assert.equal(s.usageEvents.length, 0, "kein Event bei ungueltigem kind");
});

test("recordUsageEvent: callId optional (number_month-Meter ohne Call -> null)", () => {
  const s = makeDefaultState();
  const ev = recordUsageEvent(s, {
    tenantId: TENANT_A,
    kind: USAGE_EVENT_KIND.NUMBER_MONTH,
    quantity: 1,
    costCents: 500,
  });
  assert.equal(ev.callId, null);
});

test("INV(4): aggregatePendingMeters summiert je (tenant,kind), Tenants getrennt", () => {
  const s = makeDefaultState();
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 2,
    costCents: 100,
  });
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c2",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 3,
    costCents: 150,
  });
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c3",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 1,
    costCents: 50,
  });
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: 1000,
    costCents: 7,
  });
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c2",
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: 2000,
    costCents: 14,
  });
  recordUsageEvent(s, {
    tenantId: TENANT_B,
    callId: "c9",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 5,
    costCents: 250,
  });

  const aggs = aggregatePendingMeters(s);
  assert.equal(aggs.length, 3, "3 Aggregate: A/voice, A/ai_token, B/voice");

  const aVoice = aggs.find(
    (a) => a.tenantId === TENANT_A && a.kind === USAGE_EVENT_KIND.VOICE_MINUTE,
  );
  assert.equal(aVoice.quantity, 6, "A voice quantity summiert (2+3+1)");
  assert.equal(aVoice.costCents, 300, "A voice costCents summiert (100+150+50)");
  assert.equal(aVoice.eventIds.length, 3);

  const aTok = aggs.find((a) => a.tenantId === TENANT_A && a.kind === USAGE_EVENT_KIND.AI_TOKEN);
  assert.equal(aTok.quantity, 3000);
  assert.equal(aTok.costCents, 21);

  const bVoice = aggs.find((a) => a.tenantId === TENANT_B);
  assert.equal(bVoice.quantity, 5, "B getrennt vom A-Aggregat");
});

test("INV(5): flushMeters meldet je Aggregat EINMAL + ist idempotent (zweiter Flush 0x)", async () => {
  const s = makeDefaultState();
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 2,
    costCents: 100,
  });
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: 500,
    costCents: 4,
  });
  const billing = fakeBilling();

  const first = await flushMeters(s, { billing });
  assert.deepEqual(first, { sent: 2, failed: 0 });
  assert.equal(billing.log.length, 2, "EIN reportMeter je Aggregat");
  assert.equal(pendingMeterEvents(s).length, 0, "alle Events als gesendet markiert");

  const second = await flushMeters(s, { billing });
  assert.deepEqual(second, { sent: 0, failed: 0 }, "zweiter Flush sendet nichts");
  assert.equal(billing.log.length, 2, "billing.log unveraendert (kein Doppelversand)");
});

test("INV(5b): wirft reportMeter fuer EIN Aggregat -> dessen Events bleiben pending, andere gesendet", async () => {
  const s = makeDefaultState();
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 2,
    costCents: 100,
  });
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    quantity: 500,
    costCents: 4,
  });
  // billing wirft NUR fuer ai_token-Meter, voice_minute geht durch.
  const billing = fakeBilling({
    async reportMeter(args) {
      billing.log.push(["reportMeter", args]);
      if (args.kind === USAGE_EVENT_KIND.AI_TOKEN) throw new Error("simulierter Stripe-Fehler");
    },
  });

  const r1 = await flushMeters(s, { billing });
  assert.equal(r1.sent, 1, "ein Aggregat (voice) gesendet");
  assert.equal(r1.failed, 1, "ein Aggregat (ai_token) gescheitert");
  const stillPending = pendingMeterEvents(s);
  assert.equal(stillPending.length, 1, "nur das ai_token-Event bleibt pending");
  assert.equal(stillPending[0].kind, USAGE_EVENT_KIND.AI_TOKEN);

  // Retry: jetzt nimmt das Default-fakeBilling (wirft nicht) das pending-Event nach.
  const r2 = await flushMeters(s, { billing: fakeBilling() });
  assert.equal(r2.sent, 1, "Retry holt das vorher gescheiterte Aggregat nach");
  assert.equal(pendingMeterEvents(s).length, 0);
});

test("INV(5c): idempotencyKey stabil je Aggregat (meter_<tenant>_<kind>_<minEventId>)", async () => {
  const s = makeDefaultState();
  const e1 = recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 2,
    costCents: 100,
  });
  const e2 = recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c2",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 3,
    costCents: 150,
  });
  const billing = fakeBilling();
  await flushMeters(s, { billing });
  const [, args] = billing.log[0];
  const minId = [e1.id, e2.id].sort()[0];
  assert.equal(args.idempotencyKey, `meter_${TENANT_A}_${USAGE_EVENT_KIND.VOICE_MINUTE}_${minId}`);
  assert.equal(args.tenantRef, TENANT_A);
  assert.equal(args.quantity, 5);
  assert.equal(args.costCents, 250);
});
