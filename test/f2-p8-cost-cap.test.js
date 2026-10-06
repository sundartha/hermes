import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  makeDefaultState,
  registerTenant,
  recordUsageEvent,
  dailySmsCount,
} from "../src/store/state-ops.js";
import { makePgStore } from "../src/store/pg.js";
import { USAGE_EVENT_KIND, NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { planSummarySms } from "../src/sms-summary.js";
import { makePgTestStore } from "./pg-helpers.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const A = "tenant_a";
const B = "tenant_b";
const FAR_PAST = "2000-01-01T00:00:00.000Z";
const FAR_FUTURE = "2999-01-01T00:00:00.000Z";

test("dailySmsCount zaehlt NUR SMS-Events DES Tenants (nicht voice_minute, nicht fremder Tenant)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  registerTenant(s, B);
  recordUsageEvent(s, { tenantId: A, kind: USAGE_EVENT_KIND.SMS, quantity: 1, costCents: 0 });
  recordUsageEvent(s, { tenantId: A, kind: USAGE_EVENT_KIND.SMS, quantity: 1, costCents: 0 });
  recordUsageEvent(s, {
    tenantId: A,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 2,
    costCents: 0,
  });
  recordUsageEvent(s, { tenantId: B, kind: USAGE_EVENT_KIND.SMS, quantity: 1, costCents: 0 });
  assert.equal(dailySmsCount(s, A, FAR_PAST), 2, "nur A's SMS, nicht voice_minute, nicht B");
  assert.equal(dailySmsCount(s, B, FAR_PAST), 1, "pro Tenant, nicht global");
});

test("dailySmsCount: Events vor sinceIso zaehlen nicht (rollierendes Fenster)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  s.usageEvents.push({
    id: "ue_old",
    tenantId: A,
    callId: null,
    kind: USAGE_EVENT_KIND.SMS,
    quantity: 1,
    costCents: 0,
    occurredAt: FAR_PAST,
    stripeMeterSent: false,
  });
  recordUsageEvent(s, { tenantId: A, kind: USAGE_EVENT_KIND.SMS, quantity: 1, costCents: 0 });
  assert.equal(dailySmsCount(s, A, FAR_PAST), 2, "Fenster ab FAR_PAST: beide");
  assert.equal(dailySmsCount(s, A, FAR_FUTURE), 0, "Fenster ab FAR_FUTURE: keiner");
});

test("dailySmsCount: Tenant ohne SMS -> 0 (Grenzfall, nie undefined)", () => {
  const s = makeDefaultState();
  registerTenant(s, A);
  assert.equal(dailySmsCount(s, A, FAR_PAST), 0);
});

function planStore({
  smsCount = 0,
  sender = "+4915100000001",
  to = "+491701234567",
  optIn = true,
} = {}) {
  const numbers = sender
    ? [{ tenantId: A, e164: sender, status: NUMBER_STATUS.ACTIVE, provider: PROVIDER.TELNYX }]
    : [];
  return {
    tenantPrivateNumber: () => to,
    load: () => ({ numbers }),
    tenantContext: () => ({ settings: { smsSummaryOptIn: optIn } }),
    dailySmsCount: () => smsCount,
  };
}
const call = { id: "call_a", tenantId: A, provider: PROVIDER.TELNYX };
const cfg = (dailySmsCap = 20) => withConfigNamespaces({ sendSmsSummary: true, dailySmsCap });

test("planSummarySms: Cap NICHT erreicht (count < cap) -> send=true", () => {
  const plan = planSummarySms(planStore({ smsCount: 19 }), cfg(20), call);
  assert.equal(plan.send, true);
  assert.equal(plan.reason, null);
});

test("planSummarySms: Cap erreicht (count == cap) -> send=false, reason=daily_cap (still, kein Fehler)", () => {
  const plan = planSummarySms(planStore({ smsCount: 20 }), cfg(20), call);
  assert.equal(plan.send, false);
  assert.equal(plan.reason, "daily_cap");
});

test("planSummarySms: Cap ueberschritten (count > cap) -> send=false, reason=daily_cap", () => {
  const plan = planSummarySms(planStore({ smsCount: 25 }), cfg(20), call);
  assert.equal(plan.send, false);
  assert.equal(plan.reason, "daily_cap");
});

test("planSummarySms: dailySmsCap=0 (Not-Aus) -> jede SMS gesperrt", () => {
  const plan = planSummarySms(planStore({ smsCount: 0 }), cfg(0), call);
  assert.equal(plan.send, false);
  assert.equal(plan.reason, "daily_cap");
});

test("planSummarySms: config ohne dailySmsCap -> wirft laut (fail-closed statt fail-open)", () => {
  assert.throws(
    () => planSummarySms(planStore({ smsCount: 19 }), withConfigNamespaces({ sendSmsSummary: true }), call),
    /dailySmsCap/,
  );
});

test("planSummarySms: smsCount=25 + config ohne Cap -> Guard schliesst die alte fail-open-Luecke", () => {
  assert.throws(
    () => planSummarySms(planStore({ smsCount: 25 }), withConfigNamespaces({ sendSmsSummary: true }), call),
    /dailySmsCap/,
  );
});

test("planSummarySms: config.dailySmsCap=NaN -> wirft laut (Number.isFinite faengt NaN, nicht nur typeof)", () => {
  assert.throws(
    () => planSummarySms(planStore({ smsCount: 25 }), cfg(NaN), call),
    /dailySmsCap/,
  );
});

test("planSummarySms: config.dailySmsCap=Infinity -> wirft laut (Number.isFinite faengt Infinity)", () => {
  assert.throws(
    () => planSummarySms(planStore({ smsCount: 25 }), cfg(Infinity), call),
    /dailySmsCap/,
  );
});

async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

test("pglite: recordUsageEvent(SMS) persistiert -> dailySmsCount sieht ihn nach Re-Hydrierung (Cap restart-fest)", async () => {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  store.recordUsageEvent({
    tenantId: store.load().tenants[0].id,
    kind: USAGE_EVENT_KIND.SMS,
    quantity: 1,
    costCents: 7,
  });
  await store.save();
  const ownerId = store.load().tenants[0].id;

  const reopened = await reopen(db);
  assert.equal(reopened.dailySmsCount(ownerId, FAR_PAST), 1, "SMS-Beleg ueberlebt den Restart");
  assert.equal(reopened.dailySmsCount(ownerId, FAR_FUTURE), 0, "Fenster-Grenze bleibt korrekt");
});

test("pglite: dailySmsCount ist auf der Fassade exportiert (Re-Export-Landmine)", async () => {
  const { store } = await makePgTestStore();
  assert.equal(typeof store.dailySmsCount, "function", "pg.dailySmsCount fehlt in der Fassade");
});
