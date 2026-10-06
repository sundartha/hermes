import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import {
  defaultSettings,
  demoCalendar,
  PROVIDER,
  NUMBER_STATUS,
  KYC_LEVEL,
  PROVISIONING_JOB_STATUS,
  USAGE_EVENT_KIND,
} from "../src/store/defaults.js";
import { aggregateMeterEvents } from "../src/billing/meter.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";
import { PRICES, tokensOf } from "./_prices.js";

const TENANT_B = "tenant_b";
const APP_ROLE = "app_user";

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("Owner-only-pg: frischer Zustand byte-identisch (Bestands-Invariante haelt)", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  assert.deepEqual(s.settings[BOOTSTRAP_TENANT_ID], defaultSettings());
  assert.deepEqual(store.getCalendar(BOOTSTRAP_TENANT_ID), demoCalendar());
  assert.equal(s.tenants.length, 1);
  assert.equal(s.tenants[0].id, BOOTSTRAP_TENANT_ID);
  assert.ok(!s.tenants[0].ownerName, "frischer Owner-Tenant traegt keinen ownerName (P2b)");
});

test("Zwei-Tenant-Round-Trip: settings/calendar/usage/numbers/owner_name/idp_subject getrennt persistiert", async () => {
  const { store, db } = await makePgTestStore();
  const s = store.load();

  ops.registerTenant(s, TENANT_B, { firstName: "Maria" });
  s.tenants.find((t) => t.id === TENANT_B).idpSubject = "sub-maria";
  ops.setKycLevel(s, TENANT_B, KYC_LEVEL.CARD);
  ops.setTenantStripe(s, TENANT_B, {
    customerId: "cus_b",
    paymentMethodId: "pm_b",
    paymentMethodType: "card",
  });

  const iso1 = "2030-02-01T10:00:00.000Z";
  const iso2 = "2030-02-01T11:00:00.000Z";
  ops.settingsFor(s, TENANT_B).agentName = "B-Agent";
  ops.addCalendarEvent(s, { tenantId: TENANT_B, title: "B-Termin", startIso: iso1, endIso: iso2 });
  ops.trackUsage(s, TENANT_B, tokensOf(1_000_000, 0), PRICES);
  s.numbers.push({
    id: "num_b",
    e164: "+49999000111",
    tenantId: TENANT_B,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: null,
  });

  const cb = ops.createCall(s, {
    direction: "inbound",
    from: "+49",
    to: "+49999000111",
    tenantId: TENANT_B,
  });
  ops.addActionItem(s, cb.id, "B-Item");
  ops.addNotification(s, "B-Notif", "x", cb.id);

  const co = ops.createCall(s, {
    direction: "outbound",
    from: "+49",
    to: "+49",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  ops.addActionItem(s, co.id, "Owner-Item");

  await store.save();
  const r = await reopen(db);
  const rs = r.load();

  assert.equal(rs.settings[TENANT_B].agentName, "B-Agent");
  assert.equal(rs.settings[BOOTSTRAP_TENANT_ID].agentName, defaultSettings().agentName);
  assert.deepEqual(
    r.getCalendar(TENANT_B).map((e) => e.title),
    ["B-Termin"],
  );
  assert.deepEqual(r.getCalendar(BOOTSTRAP_TENANT_ID), demoCalendar());
  assert.equal(rs.usage[TENANT_B].inputTokens, 1_000_000);
  assert.equal(rs.usage[BOOTSTRAP_TENANT_ID].inputTokens, 0);
  assert.equal(r.findTenantByNumber("+49999000111"), TENANT_B);
  assert.equal(rs.tenants.find((t) => t.id === TENANT_B).ownerName, "Maria");
  assert.equal(rs.tenants.find((t) => t.id === TENANT_B).idpSubject, "sub-maria");
  assert.equal(
    rs.tenants.find((t) => t.id === TENANT_B).kycLevel,
    KYC_LEVEL.CARD,
    "kyc_level round-trippt",
  );
  assert.equal(
    rs.tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID).kycLevel,
    KYC_LEVEL.ID_VERIFIED,
    "Owner via Boot-Seed auf id_verified geheilt (round-trippt)",
  );
  assert.deepEqual(
    r.tenantStripe(TENANT_B),
    { customerId: "cus_b", paymentMethodId: "pm_b", paymentMethodType: "card" },
    "stripe-Referenzen round-trippen",
  );
  assert.equal("stripeCustomerId" in rs.tenants.find((t) => t.id === BOOTSTRAP_TENANT_ID), false);
  assert.ok(r.getCall(cb.id), "B-Call vorhanden");
  assert.equal(r.getCall(cb.id).tenantId, TENANT_B);
  assert.ok(r.getCall(co.id), "Owner-Call separat vorhanden");
  assert.equal(r.getCall(co.id).tenantId, BOOTSTRAP_TENANT_ID);
  assert.ok(rs.actionItems.some((a) => a.callId === cb.id && a.text === "B-Item"));
  assert.ok(rs.actionItems.some((a) => a.callId === co.id && a.text === "Owner-Item"));
  assert.ok(rs.notifications.some((n) => n.callId === cb.id && n.title === "B-Notif"));

  assert.equal("undefined" in rs.settings, false);
  assert.equal("undefined" in rs.usage, false);
});

test("P2b: setTenantIdentityIfAbsent persistiert ownerName auf einem bestehenden Tenant (pg-Round-Trip)", async () => {
  const { store, db } = await makePgTestStore();
  ops.registerTenant(store.load(), "t_web", {});
  await store.save();
  const changed = ops.setTenantIdentityIfAbsent(store.load(), "t_web", {
    firstName: "Web",
    lastName: "User",
  });
  assert.equal(changed, true, "echte Mutation -> Flush");
  await store.save();
  const r = await reopen(db);
  assert.equal(
    r.tenantContext("t_web").ownerName,
    "Web User",
    "ownerName round-trippt durch Postgres -> Outbound-Identitaets-Gate passiert",
  );
});

test("RLS-WITH-CHECK: Insert mit fremder tenant_id unter gesetzter GUC wird geblockt", async () => {
  const { store, db } = await makePgTestStore();
  store.load();
  await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [TENANT_B]);
  await db.exec(
    `CREATE ROLE ${APP_ROLE} NOLOGIN;
     GRANT SELECT, INSERT, UPDATE, DELETE ON call TO ${APP_ROLE};
     GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};`,
  );

  await assert.rejects(async () => {
    await db.query(`SET ROLE ${APP_ROLE}`);
    await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [BOOTSTRAP_TENANT_ID]);
    try {
      await db.query(
        `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at)
           VALUES ('call_evil', $1, 'tok', 'inbound', 'active', now()::text)`,
        [TENANT_B],
      );
    } finally {
      await db.query(`RESET ROLE`);
    }
  }, /row-level security|policy/i);
});

function makeNumberRow(overrides) {
  return {
    id: "num",
    e164: "+49900000000",
    tenantId: TENANT_B,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: null,
    paymentIntentId: null,
    country: null,
    language: null,
    providerAgentPhoneNumberId: null,
    ...overrides,
  };
}

test("T-PA6-1 number: volle Lifecycle-Spalten round-trippen (Golden-Master)", async () => {
  const { store, db } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_B, { firstName: "Maria" });
  const full = makeNumberRow({
    id: "num_b_full",
    e164: "+49999000222",
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "prov-xyz",
    paymentIntentId: "pi_b",
    country: "FR",
    language: "fr",
  });
  s.numbers.push(full);

  await store.save();
  const r = await reopen(db);
  const rs = r.load();

  assert.deepEqual(
    rs.numbers.find((n) => n.id === "num_b_full"),
    full,
    "volle Lifecycle-Spalten (provider_number_id/payment_intent_id/country/language) round-trippen",
  );
});

test("number: monthly_cost_cents round-trippt (Provider-Preis, P4)", async () => {
  const { store, db } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_B, { firstName: "Maria" });
  s.numbers.push(
    makeNumberRow({ id: "num_b_cost", e164: "+49999000555", monthlyCostCents: 92 }),
  );

  await store.save();
  const rs = (await reopen(db)).load();

  assert.equal(rs.numbers.find((n) => n.id === "num_b_cost").monthlyCostCents, 92);
});

test("T-PA6-2 provisioning_job: Cross-Tenant own-Filter + volle Spalten round-trippen", async () => {
  const { store, db } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_B, { firstName: "Maria" });
  s.numbers.push(makeNumberRow({ id: "num_owner", e164: "+49999000333", tenantId: BOOTSTRAP_TENANT_ID }));
  s.numbers.push(makeNumberRow({ id: "num_b", e164: "+49999000444" }));

  const jobOwner = ops.recordProvisioningJob(s, {
    numberId: "num_owner",
    tenantId: BOOTSTRAP_TENANT_ID,
    idempotencyKey: "idem-o",
  });
  const jobB = ops.recordProvisioningJob(s, {
    numberId: "num_b",
    tenantId: TENANT_B,
    idempotencyKey: "idem-b",
  });
  ops.markProvisioningJob(s, jobB.id, PROVISIONING_JOB_STATUS.FAILED, "boom");

  await store.save();
  const r = await reopen(db);
  const rs = r.load();

  assert.deepEqual(
    rs.provisioningJobs.filter((j) => j.tenantId === TENANT_B).map((j) => j.id),
    [jobB.id],
  );
  assert.ok(
    rs.provisioningJobs
      .filter((j) => j.tenantId === BOOTSTRAP_TENANT_ID)
      .every((j) => j.id !== jobB.id),
    "kein B-Job unter Owner-tenantId",
  );

  const rehydrated = rs.provisioningJobs.find((j) => j.id === jobB.id);
  assert.equal(rehydrated.status, PROVISIONING_JOB_STATUS.FAILED);
  assert.equal(rehydrated.attempts, 1);
  assert.equal(rehydrated.lastError, "boom");
  assert.equal(rehydrated.createdAt, jobB.createdAt);
  assert.equal(rehydrated.numberId, "num_b");
  assert.equal(rehydrated.idempotencyKey, "idem-b");

  assert.ok(jobOwner.id, "Owner-Job angelegt (Setup-Kontrolle fuer den Cross-Tenant-Vergleich)");
});

test("T-PA6-3 usage_event: Cross-Tenant own-Filter + volle Spalten round-trippen", async () => {
  const { store, db } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_B, { firstName: "Maria" });

  const ownerEvent = ops.recordUsageEvent(s, {
    tenantId: BOOTSTRAP_TENANT_ID,
    callId: null,
    kind: USAGE_EVENT_KIND.NUMBER_MONTH,
    quantity: 1,
    costCents: 500,
  });
  const bEvent1 = ops.recordUsageEvent(s, {
    tenantId: TENANT_B,
    callId: null,
    kind: USAGE_EVENT_KIND.NUMBER_MONTH,
    quantity: 1,
    costCents: 500,
  });
  const bEvent2 = ops.recordUsageEvent(s, {
    tenantId: TENANT_B,
    callId: null,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 7,
    costCents: 42,
  });
  ops.markMeterEventsSent(s, [bEvent1.id]);

  await store.save();
  const r = await reopen(db);
  const rs = r.load();

  assert.deepEqual(
    rs.usageEvents
      .filter((e) => e.tenantId === TENANT_B)
      .map((e) => e.id)
      .sort(),
    [bEvent1.id, bEvent2.id].sort(),
  );
  assert.deepEqual(
    rs.usageEvents.filter((e) => e.tenantId === BOOTSTRAP_TENANT_ID).map((e) => e.id),
    [ownerEvent.id],
  );

  const r1 = rs.usageEvents.find((e) => e.id === bEvent1.id);
  assert.equal(r1.costCents, 500);
  assert.equal(r1.quantity, 1);
  assert.equal(r1.stripeMeterSent, true, "markMeterEventsSent round-trippt");
  const r2 = rs.usageEvents.find((e) => e.id === bEvent2.id);
  assert.equal(r2.costCents, 42);
  assert.equal(r2.quantity, 7);
  assert.equal(r2.stripeMeterSent, false);
});

test("T-PA6-4 usage_event Downstream: planMinutesExceeded + aggregateMeterEvents lesen die round-getrippten Zeilen", async () => {
  const { store, db } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_B, { firstName: "Maria" });

  const sentEvent = ops.recordUsageEvent(s, {
    tenantId: TENANT_B,
    callId: null,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 5,
    costCents: 30,
  });
  ops.recordUsageEvent(s, {
    tenantId: TENANT_B,
    callId: null,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 7,
    costCents: 42,
  });
  ops.markMeterEventsSent(s, [sentEvent.id]);

  await store.save();
  const r = await reopen(db);
  const rs = r.load();

  assert.equal(
    ops.planMinutesExceeded(rs, TENANT_B, {
      includedMinutes: 10,
      periodStartIso: "2000-01-01T00:00:00.000Z",
    }),
    true,
    "12 verbrauchte Minuten >= 10 Kontingent -> exceeded",
  );
  assert.equal(
    ops.planMinutesExceeded(rs, TENANT_B, {
      includedMinutes: 100,
      periodStartIso: "2000-01-01T00:00:00.000Z",
    }),
    false,
    "12 verbrauchte Minuten < 100 Kontingent -> nicht exceeded",
  );

  const bMeters = aggregateMeterEvents(ops.pendingMeterEvents(rs)).filter(
    (m) => m.tenantId === TENANT_B,
  );
  assert.equal(bMeters.length, 1);
  assert.equal(bMeters[0].kind, USAGE_EVENT_KIND.VOICE_MINUTE);
  assert.equal(bMeters[0].quantity, 7, "nur das ungesendete Event zaehlt ins Aggregat");
});

test("T-PA6-5 number: leere keep-Liste (deleteMissing empty-branch) prunt genau den Tenant", async () => {
  const { store, db } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT_B, { firstName: "Maria" });
  s.numbers.push(makeNumberRow({ id: "num_b", e164: "+49999000555" }));
  s.numbers.push(makeNumberRow({ id: "num_owner", e164: "+49999000666", tenantId: BOOTSTRAP_TENANT_ID }));
  await store.save();

  const s2 = store.load();
  const i = s2.numbers.findIndex((n) => n.id === "num_b");
  s2.numbers.splice(i, 1);
  await store.save();

  const countB = (await db.query(`SELECT count(*)::int AS c FROM number WHERE tenant_id=$1`, [TENANT_B]))
    .rows[0].c;
  const countOwner = (
    await db.query(`SELECT count(*)::int AS c FROM number WHERE tenant_id=$1`, [BOOTSTRAP_TENANT_ID])
  ).rows[0].c;
  assert.equal(countB, 0, "B-Nummern vollstaendig geprunt (leere keep-Liste -> Voll-Prune-Zweig)");
  assert.ok(countOwner > 0, "Owner-Nummern unberuehrt vom B-Flush");
});
