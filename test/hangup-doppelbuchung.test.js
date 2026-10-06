import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { makeCallFinish } from "../src/telephony/call-finish.js";
import { billThunk } from "../src/telephony/call-termination.js";
import { makeMetering, voiceMinutesOf, callTariffCentsPerMin } from "../src/billing/metering.js";
import { USAGE_EVENT_KIND } from "../src/store/defaults.js";

const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";
const DOMESTIC_FROM = "+4915112345678";
const DOMESTIC_TO = "+4915199999999";

async function oeffneStore(db) {
  const runner = {
    withClient: (fn) =>
      fn({ query: (sql, params) => db.query(sql, params), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

function throwing(label) {
  return () => {
    throw new Error(`${label} haette im Fruehe-Return-Zweig nicht laufen duerfen`);
  };
}

function verdrahteFinishCall(pgStore) {
  const store = { ...pgStore, withStoreLock: async (fn) => fn() };
  const callFinish = makeCallFinish({
    store,
    config: { billing: { paymentEnabled: true, smsCostCents: 0 }, privacy: {} },
    metering: makeMetering({ store }),
    messaging: throwing("messaging"),
    summarizeCall: throwing("summarizeCall"),
    planSummarySms: throwing("planSummarySms"),
    audit: throwing("audit"),
  });
  return { store, finishCall: callFinish.finishCall };
}

function seedeBeendetenCall(store) {
  const call = store.createCall({
    direction: "outbound",
    from: DOMESTIC_FROM,
    to: DOMESTIC_TO,
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  call.answeredAt = ANSWERED_AT;
  store.setCallEndedAt(call.id, "completed", ENDED_AT);
  return call;
}

function erwarteteBuchungCents(call) {
  const cents = voiceMinutesOf(call) * callTariffCentsPerMin(call);
  assert.ok(cents > 0, "Messvoraussetzung: eine Buchung muss von null unterscheidbar sein");
  return cents;
}

function buchungsachsen(store, callId) {
  const state = store.load();
  return {
    budgetCents: store.usageOf(BOOTSTRAP_TENANT_ID).costCents,
    meterBelege: state.usageEvents.filter(
      (beleg) => beleg.callId === callId && beleg.kind === USAGE_EVENT_KIND.VOICE_MINUTE,
    ).length,
  };
}

const auflegeEreignis = (store, finishCall, callId) => billThunk(finishCall, store, callId);

test("Positiv-Kontrolle: EIN Auflege-Ereignis bucht auf beiden Wegen genau einmal", async () => {
  const store0 = await oeffneStore(new PGlite());
  const { store, finishCall } = verdrahteFinishCall(store0);
  const call = seedeBeendetenCall(store);

  await auflegeEreignis(store, finishCall, call.id)();

  assert.deepEqual(buchungsachsen(store, call.id), {
    budgetCents: erwarteteBuchungCents(call),
    meterBelege: 1,
  });
  assert.ok(store.getCall(call.id).billedAt, "der Bucht-Riegel steht nach der Buchung");
});

test("(a) sequenziell: dasselbe Auflege-Ereignis zweimal nacheinander bucht nicht doppelt", async () => {
  const store0 = await oeffneStore(new PGlite());
  const { store, finishCall } = verdrahteFinishCall(store0);
  const call = seedeBeendetenCall(store);
  const einmal = { budgetCents: erwarteteBuchungCents(call), meterBelege: 1 };

  await auflegeEreignis(store, finishCall, call.id)();
  await auflegeEreignis(store, finishCall, call.id)();

  assert.deepEqual(buchungsachsen(store, call.id), einmal);
});

test("(b) nebenlaeufig: zwei gleichzeitige Auflege-Ereignisse buchen nicht doppelt", async () => {
  const store0 = await oeffneStore(new PGlite());
  const { store, finishCall } = verdrahteFinishCall(store0);
  const call = seedeBeendetenCall(store);
  const einmal = { budgetCents: erwarteteBuchungCents(call), meterBelege: 1 };

  await Promise.all([
    auflegeEreignis(store, finishCall, call.id)(),
    auflegeEreignis(store, finishCall, call.id)(),
  ]);

  assert.deepEqual(buchungsachsen(store, call.id), einmal);
});

test("(c) ueber Prozessgrenzen: nach einem Neustart bucht dasselbe Auflege-Ereignis nicht erneut", async () => {
  const db = new PGlite();
  const ersterProzess = verdrahteFinishCall(await oeffneStore(db));
  const call = seedeBeendetenCall(ersterProzess.store);
  const einmal = { budgetCents: erwarteteBuchungCents(call), meterBelege: 1 };

  await auflegeEreignis(ersterProzess.store, ersterProzess.finishCall, call.id)();
  await ersterProzess.store.save();

  const zweiterProzess = verdrahteFinishCall(await oeffneStore(db));
  assert.equal(
    zweiterProzess.store.getCall(call.id)._finished,
    undefined,
    "der In-Prozess-Marker ueberlebt den Neustart nicht - nur billedAt kann hier riegeln",
  );

  await auflegeEreignis(zweiterProzess.store, zweiterProzess.finishCall, call.id)();

  assert.deepEqual(buchungsachsen(zweiterProzess.store, call.id), einmal);
});
