import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  makeDefaultState,
  recordUsageEvent,
  markMeterEventsSent,
  flushableMeterEvents,
  METER_FLUSH_SKIP,
} from "../src/store/state-ops.js";
import { flushMeters } from "../src/billing/meter.js";
import { USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { fakeBilling } from "./helpers.js";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore, BOOTSTRAP_TENANT_ID } from "./pg-helpers.js";

const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";

const EPOCH = "2026-08-04T00:00:00.000Z";
const VOR_EPOCH = "2026-07-10T09:00:00.000Z";
const AUF_EPOCH = "2026-08-04T00:00:00.000Z";
const NACH_EPOCH = "2026-08-05T12:34:56.789Z";
const EINE_MS_VOR_EPOCH = "2026-08-03T23:59:59.999Z";

function seedVorUndNachEpoch(s) {
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 2,
    costCents: 100,
    occurredAt: VOR_EPOCH,
  });
  recordUsageEvent(s, {
    tenantId: TENANT_B,
    callId: "c2",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 3,
    costCents: 150,
    occurredAt: VOR_EPOCH,
  });
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c3",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 5,
    costCents: 250,
    occurredAt: NACH_EPOCH,
  });
}

test("KV-P0-1: flushMeters meldet ausschliesslich Ereignisse NACH dem Stichtag", async () => {
  const s = makeDefaultState();
  seedVorUndNachEpoch(s);
  const billing = fakeBilling();

  const result = await flushMeters(s, { billing, flushEpochIso: EPOCH });
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 2, "die beiden VOR-Zeilen werden zurueckgehalten");
  assert.equal(result.skipReason, null);
  assert.equal(billing.log.length, 1, "genau EIN reportMeter-Aufruf");

  const [, args] = billing.log[0];
  assert.equal(args.quantity, 5, "nur die NACH_EPOCH-Zeile zaehlt ins Aggregat");
  assert.equal(args.costCents, 250);

  const vorZeilen = s.usageEvents.filter((e) => e.occurredAt === VOR_EPOCH);
  assert.equal(vorZeilen.length, 2);
  for (const e of vorZeilen)
    assert.equal(e.stripeMeterSent, false, "VOR-Zeilen bleiben unerreicht, nicht 'erledigt'");
});

test("KV-P0-2: ohne gesetzten Flush-Stichtag geht KEIN Ereignis raus (fail-closed)", async () => {
  const s = makeDefaultState();
  seedVorUndNachEpoch(s);
  const billing = fakeBilling();

  const result = await flushMeters(s, { billing });
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 3, "alle drei Zeilen zurueckgehalten");
  assert.equal(result.skipReason, METER_FLUSH_SKIP.NO_EPOCH);
  assert.equal(billing.log.length, 0, "Stripe wird nie kontaktiert");
  for (const e of s.usageEvents)
    assert.equal(e.stripeMeterSent, false, "kein Event wird als gesendet markiert");
});

test("KV-P0-3: Grenzfall - ein Ereignis GENAU auf dem Stichtag wird gemeldet (>= ist inklusiv)", async () => {
  const s = makeDefaultState();
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 1,
    costCents: 10,
    occurredAt: AUF_EPOCH,
  });
  const billing = fakeBilling();
  const result = await flushMeters(s, { billing, flushEpochIso: EPOCH });
  assert.equal(result.sent, 1, "ein Ereignis exakt auf dem Stichtag wird gemeldet");
  assert.equal(result.skipped, 0);
  assert.equal(billing.log.length, 1);

  const s2 = makeDefaultState();
  recordUsageEvent(s2, {
    tenantId: TENANT_A,
    callId: "c2",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 1,
    costCents: 10,
    occurredAt: EINE_MS_VOR_EPOCH,
  });
  const billing2 = fakeBilling();
  const result2 = await flushMeters(s2, { billing: billing2, flushEpochIso: EPOCH });
  assert.equal(result2.sent, 0, "eine Millisekunde davor wird zurueckgehalten");
  assert.equal(result2.skipped, 1);
  assert.equal(billing2.log.length, 0);
});

test("KV-P0-4: nicht-kanonischer aber gueltiger Stichtag wird VOR dem Vergleich kanonisiert", async () => {
  const s = makeDefaultState();
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 1,
    costCents: 10,
    occurredAt: AUF_EPOCH,
  });
  recordUsageEvent(s, {
    tenantId: TENANT_B,
    callId: "c2",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 9,
    costCents: 900,
    occurredAt: VOR_EPOCH,
  });
  const billing = fakeBilling();
  const result = await flushMeters(s, { billing, flushEpochIso: "2026-08-04T02:00:00+02:00" });
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 1, "die VOR_EPOCH-Zeile (Tenant B) bleibt zurueck");
  assert.equal(billing.log.length, 1);
  const [, args] = billing.log[0];
  assert.equal(args.tenantRef, TENANT_A, "nur die AUF_EPOCH-Zeile (Tenant A) wird gemeldet");
  assert.equal(args.costCents, 10);
});

test("KV-P0-5: Muell-Stichtag meldet NICHTS (nicht 'alles')", async () => {
  const MUELL_WERTE = ["morgen", "1999-hello", "", "kein-datum"];
  for (const wert of MUELL_WERTE) {
    const s = makeDefaultState();
    recordUsageEvent(s, {
      tenantId: TENANT_A,
      callId: "c1",
      kind: USAGE_EVENT_KIND.VOICE_MINUTE,
      quantity: 1,
      costCents: 10,
      occurredAt: NACH_EPOCH,
    });
    const billing = fakeBilling();
    const result = await flushMeters(s, { billing, flushEpochIso: wert });
    assert.equal(result.sent, 0, `Wert ${JSON.stringify(wert)} darf nichts melden`);
    assert.equal(result.skipReason, METER_FLUSH_SKIP.NO_EPOCH, `Wert ${JSON.stringify(wert)}`);
    assert.equal(billing.log.length, 0, `Wert ${JSON.stringify(wert)}`);
  }
});

test("KV-P0-6: flushableMeterEvents ignoriert bereits gemeldete Zeilen weiterhin", () => {
  const s = makeDefaultState();
  const gesendet = recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 1,
    costCents: 10,
    occurredAt: NACH_EPOCH,
  });
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c2",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 2,
    costCents: 20,
    occurredAt: NACH_EPOCH,
  });
  markMeterEventsSent(s, [gesendet.id]);

  const { events, skipped, skipReason } = flushableMeterEvents(s, { flushEpochIso: EPOCH });
  assert.equal(events.length, 1, "die bereits gesendete Zeile ist gar nicht erst pending");
  assert.equal(skipped, 0, "der Stichtag ersetzt das Idempotenz-Schloss nicht, er kommt dazu");
  assert.equal(skipReason, null);
});

test("KV-P0-7: nicht-String-Stichtag ist fail-closed (new Date(null) ist gueltig!)", () => {
  const s = makeDefaultState();
  recordUsageEvent(s, {
    tenantId: TENANT_A,
    callId: "c1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 1,
    costCents: 10,
    occurredAt: NACH_EPOCH,
  });

  for (const wert of [null, undefined, 0, true, new Date(0)]) {
    const { events, skipped, skipReason } = flushableMeterEvents(s, { flushEpochIso: wert });
    assert.equal(events.length, 0, `Wert ${String(wert)} darf nichts durchlassen`);
    assert.equal(skipped, 1, `Wert ${String(wert)}`);
    assert.equal(skipReason, METER_FLUSH_SKIP.NO_EPOCH, `Wert ${String(wert)}`);
  }
});

test("KV-P0-8: pg-Backend filtert nach Re-Hydrierung identisch (Zwei-Backend-Beleg)", async () => {
  const { store, runner } = await makePgTestStore();
  const s = store.load();
  recordUsageEvent(s, {
    tenantId: BOOTSTRAP_TENANT_ID,
    callId: "c1",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 3,
    costCents: 100,
    occurredAt: VOR_EPOCH,
  });
  recordUsageEvent(s, {
    tenantId: BOOTSTRAP_TENANT_ID,
    callId: "c2",
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 5,
    costCents: 200,
    occurredAt: NACH_EPOCH,
  });
  await store.save();

  const reopened = makePgStore(runner);
  await reopened.init();
  const rs = reopened.load();
  assert.equal(
    typeof rs.usageEvents.find((e) => e.callId === "c1").occurredAt,
    "string",
    "occurred_at kommt als String zurueck, nie als Date (sonst waere der Vergleich still falsch)",
  );

  const billing = fakeBilling();
  const result = await flushMeters(rs, { billing, flushEpochIso: EPOCH });
  assert.equal(result.sent, 1, "nur die NACH_EPOCH-Zeile wird gemeldet");
  assert.equal(result.skipped, 1, "die VOR_EPOCH-Zeile bleibt zurueck");

  const billing2 = fakeBilling();
  const result2 = await flushMeters(rs, { billing: billing2 });
  assert.equal(result2.sent, 0);
  assert.equal(result2.skipped, 1);
  assert.equal(result2.skipReason, METER_FLUSH_SKIP.NO_EPOCH);
});

test("KV-P0-9: config.js kanonisiert einen gueltigen Stichtag und verweigert einen ungueltigen fail-closed", async () => {
  const saved = process.env.BILLING_FLUSH_EPOCH;
  try {
    delete process.env.BILLING_FLUSH_EPOCH;
    const leer = await import("../src/config.js?kv-p0-9a");
    assert.equal(leer.config.billing.flushEpochIso, null);
    assert.ok(
      !leer.configFatalErrors().some((e) => e.includes("BILLING_FLUSH_EPOCH")),
      "leer ist der ausgelieferte Ruhezustand, kein Fatal",
    );

    process.env.BILLING_FLUSH_EPOCH = "2026-08-04T02:00:00+02:00";
    const offset = await import("../src/config.js?kv-p0-9b");
    assert.equal(offset.config.billing.flushEpochIso, "2026-08-04T00:00:00.000Z");

    process.env.BILLING_FLUSH_EPOCH = "0";
    const nullJahr = await import("../src/config.js?kv-p0-9c1");
    assert.equal(nullJahr.config.billing.flushEpochIso, null);
    assert.ok(nullJahr.configFatalErrors().some((e) => e.includes("BILLING_FLUSH_EPOCH")));

    process.env.BILLING_FLUSH_EPOCH = "2026-08-04T00:00:00";
    const ohneZone = await import("../src/config.js?kv-p0-9c2");
    assert.equal(ohneZone.config.billing.flushEpochIso, null);
    assert.ok(ohneZone.configFatalErrors().some((e) => e.includes("BILLING_FLUSH_EPOCH")));
  } finally {
    if (saved === undefined) delete process.env.BILLING_FLUSH_EPOCH;
    else process.env.BILLING_FLUSH_EPOCH = saved;
  }
});

test("KV-P0-10: BILLING_FLUSH_EPOCH ist in .env.example/render.yaml dokumentiert und in test/helpers.js BASE_ENV gepinnt", () => {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

  const envExample = fs.readFileSync(path.join(repoRoot, ".env.example"), "utf8");
  assert.ok(
    /^BILLING_FLUSH_EPOCH=$/m.test(envExample),
    "BILLING_FLUSH_EPOCH fehlt (oder ist nicht leer) in .env.example",
  );

  const renderYaml = fs.readFileSync(path.join(repoRoot, "render.yaml"), "utf8");
  assert.ok(/key:\s*BILLING_FLUSH_EPOCH/.test(renderYaml), "BILLING_FLUSH_EPOCH fehlt in render.yaml");

  const helpers = fs.readFileSync(path.join(repoRoot, "test", "helpers.js"), "utf8");
  assert.ok(
    /BILLING_FLUSH_EPOCH:\s*""/.test(helpers),
    "BILLING_FLUSH_EPOCH nicht in test/helpers.js BASE_ENV auf '' gepinnt",
  );
});
