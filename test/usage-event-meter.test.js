import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  numbersDueForMonthMeter,
  recordUsageEvent,
  pendingMeterEvents,
} from "../src/store/state-ops.js";
import { aggregateMeterEvents, flushMeters } from "../src/billing/meter.js";
import { NUMBER_STATUS, USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { fakeBilling } from "./helpers.js";

const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";
const NUMBER_ID_A = "num_a";
const NUMBER_ID_B = "num_b";
const MIETE_CENTS = 92;
const JANUAR = "2026-01-15T09:00:00.000Z";
const FEBRUAR = "2026-02-15T09:00:00.000Z";
const FLUSH_EPOCH_WEIT_VOR_FIXTURES = "2000-01-01T00:00:00.000Z";

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

test("recordUsageEvent: numberId optional (Default null, voice_minute traegt keine Nummer)", () => {
  const s = makeDefaultState();
  const ohne = recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "call_1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 1,
    costCents: 10,
  });
  const mit = recordUsageEvent(s, {
    tenantId: TENANT_A,
    numberId: NUMBER_ID_A,
    kind: USAGE_EVENT_KIND.NUMBER_MONTH,
    quantity: 1,
    costCents: MIETE_CENTS,
  });
  assert.equal(ohne.numberId, null, "kein undefined-Drift");
  assert.equal(mit.numberId, NUMBER_ID_A);
});

test("recordUsageEvent: occurredAt vom Aufrufer wird uebernommen (Default bleibt die Uhr)", () => {
  const s = makeDefaultState();
  const vorher = new Date().toISOString();
  const gestempelt = recordUsageEvent(s, {
    tenantId: TENANT_A,
    numberId: NUMBER_ID_A,
    kind: USAGE_EVENT_KIND.NUMBER_MONTH,
    quantity: 1,
    costCents: MIETE_CENTS,
    occurredAt: JANUAR,
  });
  const default_ = recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "call_1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 1,
    costCents: 10,
  });
  assert.equal(gestempelt.occurredAt, JANUAR, "der Aufrufer reicht seine Uhr durch");
  assert.ok(default_.occurredAt >= vorher, "ohne Argument stempelt weiterhin new Date()");
});

function seedNumber(s, { id, tenantId = TENANT_A, status = NUMBER_STATUS.ACTIVE }) {
  s.numbers.push({ id, tenantId, status, e164: null, country: "DE" });
  return id;
}

function faelligeIds(s, opts) {
  return numbersDueForMonthMeter(s, opts).map((n) => n.id);
}

test("numbersDueForMonthMeter: nur ACTIVE (requested/failed/released nicht faellig)", () => {
  const s = makeDefaultState();
  seedNumber(s, { id: NUMBER_ID_A });
  for (const status of [NUMBER_STATUS.REQUESTED, NUMBER_STATUS.FAILED, NUMBER_STATUS.RELEASED])
    seedNumber(s, { id: `num_${status}`, status });

  assert.deepEqual(faelligeIds(s, { nowIso: JANUAR }), [NUMBER_ID_A]);
});

test("numbersDueForMonthMeter: tenantId filtert; null liefert alle", () => {
  const s = makeDefaultState();
  seedNumber(s, { id: NUMBER_ID_A });
  seedNumber(s, { id: NUMBER_ID_B, tenantId: TENANT_B });

  assert.deepEqual(faelligeIds(s, { nowIso: JANUAR, tenantId: TENANT_B }), [NUMBER_ID_B]);
  assert.deepEqual(faelligeIds(s, { nowIso: JANUAR }), [NUMBER_ID_A, NUMBER_ID_B]);
});

test("numbersDueForMonthMeter: Beleg im VORmonat -> wieder faellig; Beleg im selben Monat -> nicht", () => {
  const s = makeDefaultState();
  seedNumber(s, { id: NUMBER_ID_A });
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    numberId: NUMBER_ID_A,
    kind: USAGE_EVENT_KIND.NUMBER_MONTH,
    quantity: 1,
    costCents: MIETE_CENTS,
    occurredAt: JANUAR,
  });

  assert.deepEqual(faelligeIds(s, { nowIso: JANUAR }), [], "im Januar bereits gebucht");
  assert.deepEqual(faelligeIds(s, { nowIso: FEBRUAR }), [NUMBER_ID_A], "im Februar wieder faellig");
});

test("numbersDueForMonthMeter: unlesbare Uhr -> leer (fail-closed, bucht nichts)", () => {
  const s = makeDefaultState();
  seedNumber(s, { id: NUMBER_ID_A });

  assert.deepEqual(faelligeIds(s, { nowIso: "kein-datum" }), []);
});

test("numbersDueForMonthMeter: Beleg OHNE numberId sperrt keine Nummer (Bestands-Beleg)", () => {
  const s = makeDefaultState();
  seedNumber(s, { id: NUMBER_ID_A });
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    kind: USAGE_EVENT_KIND.NUMBER_MONTH,
    quantity: 1,
    costCents: MIETE_CENTS,
    occurredAt: JANUAR,
  });

  assert.deepEqual(faelligeIds(s, { nowIso: JANUAR }), [NUMBER_ID_A]);
});

test("INV(4): aggregateMeterEvents summiert je (tenant,kind), Tenants getrennt", () => {
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

  const aggs = aggregateMeterEvents(pendingMeterEvents(s));
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

  const first = await flushMeters(s, { billing, flushEpochIso: FLUSH_EPOCH_WEIT_VOR_FIXTURES });
  assert.deepEqual(first, { sent: 2, failed: 0, skipped: 0, skipReason: null });
  assert.equal(billing.log.length, 2, "EIN reportMeter je Aggregat");
  assert.equal(pendingMeterEvents(s).length, 0, "alle Events als gesendet markiert");

  const second = await flushMeters(s, { billing, flushEpochIso: FLUSH_EPOCH_WEIT_VOR_FIXTURES });
  assert.deepEqual(
    second,
    { sent: 0, failed: 0, skipped: 0, skipReason: null },
    "zweiter Flush sendet nichts",
  );
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
  const billing = fakeBilling({
    async reportMeter(args) {
      billing.log.push(["reportMeter", args]);
      if (args.kind === USAGE_EVENT_KIND.AI_TOKEN) throw new Error("simulierter Stripe-Fehler");
    },
  });

  const r1 = await flushMeters(s, { billing, flushEpochIso: FLUSH_EPOCH_WEIT_VOR_FIXTURES });
  assert.equal(r1.sent, 1, "ein Aggregat (voice) gesendet");
  assert.equal(r1.failed, 1, "ein Aggregat (ai_token) gescheitert");
  assert.equal(r1.skipped, 0);
  const stillPending = pendingMeterEvents(s);
  assert.equal(stillPending.length, 1, "nur das ai_token-Event bleibt pending");
  assert.equal(stillPending[0].kind, USAGE_EVENT_KIND.AI_TOKEN);

  const r2 = await flushMeters(s, {
    billing: fakeBilling(),
    flushEpochIso: FLUSH_EPOCH_WEIT_VOR_FIXTURES,
  });
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
  await flushMeters(s, { billing, flushEpochIso: FLUSH_EPOCH_WEIT_VOR_FIXTURES });
  const [, args] = billing.log[0];
  const minId = [e1.id, e2.id].sort()[0];
  assert.equal(args.idempotencyKey, `meter_${TENANT_A}_${USAGE_EVENT_KIND.VOICE_MINUTE}_${minId}`);
  assert.equal(args.tenantRef, TENANT_A);
  assert.equal(args.quantity, 5);
  assert.equal(args.costCents, 250);
});
