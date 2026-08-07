// F2 P8 - Kosten-Schutz fuer die Summary-SMS (Toll-Fraud H1): pro Send ein
// USAGE_EVENT_KIND.SMS-Beleg + Tages-Cap pro Tenant. Drei Ebenen, alle offline
// (kein Netz, kein Server-Boot; pglite = Postgres-in-WASM, F.I.R.S.T.):
//   1. state-ops dailySmsCount: zaehlt NUR SMS-Events DES Tenants IM 24h-Fenster.
//   2. planSummarySms: Cap erreicht -> send=false, reason="daily_cap" (still, kein Fehler).
//   3. pglite-Round-Trip: ein SMS-Beleg ueberlebt die Re-Hydrierung -> der Cap-Zaehler
//      bleibt nach einem Prozess-Restart korrekt (das Fenster ist persistenz-getragen).
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

// ---- 1. dailySmsCount (state-ops, reine Query) ----

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
  // Ein alter Beleg (ausserhalb des Fensters) + ein frischer (recordUsageEvent stempelt now).
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

// ---- 2. planSummarySms: Cap-Entscheidung ----

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

// PA-10: die Toll-Fraud-Tageskappe ist fail-closed. planSummarySms verlaesst sich NICHT
// mehr auf einen stillen Fallback (frueher "config.dailySmsCap ?? 20") - ein config OHNE
// dailySmsCap darf die Kappe nicht still umgehen (die alte Luecke: "count >= undefined"
// ist immer false -> jede SMS durchgelassen). Statt fail-open scheitert die Funktion jetzt
// LAUT, bevor eine Sende-Entscheidung ohne gueltige Kappe faellt.
test("planSummarySms: config ohne dailySmsCap -> wirft laut (fail-closed statt fail-open)", () => {
  assert.throws(
    () => planSummarySms(planStore({ smsCount: 19 }), withConfigNamespaces({ sendSmsSummary: true }), call),
    /dailySmsCap/,
  );
});

test("planSummarySms: smsCount=25 + config ohne Cap -> Guard schliesst die alte fail-open-Luecke", () => {
  // Ohne Guard/Fallback waere "25 >= undefined" false -> send=true trotz 25 gesendeter SMS
  // (Toll-Fraud). Der Guard verhindert genau diesen stillen Send, indem er laut scheitert.
  assert.throws(
    () => planSummarySms(planStore({ smsCount: 25 }), withConfigNamespaces({ sendSmsSummary: true }), call),
    /dailySmsCap/,
  );
});

// Review-Blocker Runde 1 (G26/G3): typeof config.dailySmsCap !== "number" laesst NaN UND
// Infinity durch (typeof NaN === "number", typeof Infinity === "number"). Ohne
// Number.isFinite waere "count >= NaN" bzw. "count >= Infinity" immer false -> die
// Tageskappe faellt still auf send=true zurueck, exakt dieselbe Fail-open-Luecke wie beim
// fehlenden Key. Beide Werte muessen den Guard genauso auslaesen wie ein fehlender Key.
test("planSummarySms: config.dailySmsCap=NaN -> wirft laut (Number.isFinite faengt NaN, nicht nur typeof)", () => {
  assert.throws(
    () => planSummarySms(planStore({ smsCount: 25 }), cfg(NaN), call),
    /dailySmsCap/,
  );
});

test("planSummarySms: config.dailySmsCap=Infinity -> wirft laut (Number.isFinite faengt Infinity)", () => {
  // Ohne Guard-Fix waere "25 >= Infinity" false -> send=true trotz 25 gesendeter SMS.
  assert.throws(
    () => planSummarySms(planStore({ smsCount: 25 }), cfg(Infinity), call),
    /dailySmsCap/,
  );
});

// ---- 3. pglite-Round-Trip: SMS-Beleg + Cap-Zaehler ueberleben den Restart ----

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
