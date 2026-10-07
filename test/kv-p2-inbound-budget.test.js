import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  seedState,
  seedCall,
  waitForLog,
  waitForStoreState,
  DOMESTIC_TEST_NUMBER,
} from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  makeDefaultState,
  createCall,
  getCall,
  usageOf,
  addVoiceUsageCostCents,
  recordCallEstimatedCostCents,
  stampBudgetPeriod,
} from "../src/store/state-ops.js";

const INBOUND_CENTS = 7;
const DOMESTIC_CENTS = 20;
const DEFAULT_CENTS = 30;
const SHORT_CALL_MINUTES = 2;
const HTTP_OK = 200;
const NOW_ISO = "2026-07-30T12:00:00.000Z";
const NOW_SPEND_MONTH_KEY = "2026-07";
const PERIOD_START_ISO = "2026-07-01T00:00:00.000Z";

const TENANT = "tenant_kv_p2";
const OWN_DID = "+15005550006";
const CALLER = "+4915112345678";

let makeMetering;

before(async () => {
  process.env.VOICE_TARIFF_INBOUND_CENTS = String(INBOUND_CENTS);
  process.env.VOICE_TARIFF_DOMESTIC_CENTS = String(DOMESTIC_CENTS);
  process.env.VOICE_TARIFF_DEFAULT_CENTS = String(DEFAULT_CENTS);
  ({ makeMetering } = await import("../src/billing/metering.js"));
});

function realMeteringStore(state) {
  return {
    addVoiceUsageCostCents: (tenantId, costCents) =>
      addVoiceUsageCostCents(state, tenantId, costCents, NOW_ISO),
    recordCallEstimatedCostCents: (callId, input) =>
      recordCallEstimatedCostCents(state, callId, input),
  };
}

function makeInboundCall(state, { tenantId = TENANT, answeredAt, endedAt } = {}) {
  const call = createCall(state, {
    direction: "inbound",
    from: CALLER,
    to: OWN_DID,
    tenantId,
  });
  call.answeredAt = answeredAt ?? null;
  call.endedAt = endedAt ?? null;
  return call;
}

test("KV-P2-1: ein beendeter Inbound-Call mit 2 Minuten erhoeht spendMonthCostCents und costCents um 2 x Inbound-Satz", () => {
  const state = makeDefaultState();
  const call = makeInboundCall(state, {
    answeredAt: "2026-07-30T11:58:00.000Z",
    endedAt: "2026-07-30T12:00:00.000Z",
  });
  const { reconcileVoiceBudget } = makeMetering({ store: realMeteringStore(state) });

  reconcileVoiceBudget(call);

  const bucket = usageOf(state, TENANT);
  assert.equal(bucket.spendMonthCostCents, SHORT_CALL_MINUTES * INBOUND_CENTS);
  assert.equal(bucket.costCents, SHORT_CALL_MINUTES * INBOUND_CENTS, "Lebenszeit-Achse zieht mit");
  assert.notEqual(
    SHORT_CALL_MINUTES * INBOUND_CENTS,
    SHORT_CALL_MINUTES * DEFAULT_CENTS,
    "Fixture-Anspruch: der alte Pfad haette 2 x 30 = 60 gebucht",
  );
});

test("KV-P2-2: estimated_cost_cents und beide Achsen-Anker sind an der Inbound-call-Zeile gesetzt", () => {
  const state = makeDefaultState();
  const call = makeInboundCall(state, {
    answeredAt: "2026-07-30T11:59:00.000Z",
    endedAt: "2026-07-30T12:00:00.000Z",
  });
  stampBudgetPeriod(state, TENANT, PERIOD_START_ISO);
  const { reconcileVoiceBudget } = makeMetering({ store: realMeteringStore(state) });

  reconcileVoiceBudget(call);

  const row = getCall(state, call.id);
  assert.equal(row.estimatedCostCents, 1 * INBOUND_CENTS);
  assert.equal(row.estimatedCostSpendMonthKey, NOW_SPEND_MONTH_KEY, "= chargeAnchorsOfUsage NACH der Buchung");
  assert.equal(row.estimatedCostPeriodKey, PERIOD_START_ISO);
});

test("KV-P2-3: ein nie beantworteter Inbound-Call bucht nichts", () => {
  const state = makeDefaultState();
  const call = makeInboundCall(state, { answeredAt: null, endedAt: "2026-07-30T12:00:00.000Z" });
  const { reconcileVoiceBudget } = makeMetering({ store: realMeteringStore(state) });

  reconcileVoiceBudget(call);

  assert.equal(usageOf(state, TENANT).costCents, 0);
  assert.equal(
    getCall(state, call.id).estimatedCostCents,
    null,
    "kein Null-Estimate - KV-P3 haette sonst einen Bezugspunkt ohne Buchung",
  );
});

test("KV-P2-3 (T5-Grenzfall): unbrauchbares answeredAt normalisiert auf 0 Minuten, keine Buchung, kein NaN", () => {
  const state = makeDefaultState();
  const call = makeInboundCall(state, {
    answeredAt: "kaputt",
    endedAt: "2026-07-30T12:00:00.000Z",
  });
  const { reconcileVoiceBudget } = makeMetering({ store: realMeteringStore(state) });

  reconcileVoiceBudget(call);

  assert.equal(usageOf(state, TENANT).costCents, 0);
  assert.notEqual(usageOf(state, TENANT).costCents, NaN);
});

const CALL_ID = "kv_p2_bill_once";
const BILLED_MINUTES = 5;
const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";
const SPAWN_TARIFF_ENV = { VOICE_TARIFF_INBOUND_CENTS: String(INBOUND_CENTS) };

const postStatus = (srv, callId, fields) =>
  fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

async function postCompleted(srv, callId) {
  const res = await postStatus(srv, callId, { CallStatus: "completed" });
  assert.equal(res.status, HTTP_OK);
}

function abschlussMeldungen(store, callId) {
  return store.notifications.filter((notification) => notification.callId === callId).length;
}

async function completeCall(srv, callId) {
  const meldungenVorher = abschlussMeldungen(srv.readStore(), callId);
  await postCompleted(srv, callId);
  await waitForStoreState(srv, (store) => abschlussMeldungen(store, callId) > meldungenVorher);
}

async function repeatCompletedInSameProcess(srv, callId) {
  await postCompleted(srv, callId);
  await waitForLog(srv, new RegExp(`\\[voice/status\\][^\\n]*"callId":"${callId}"`));
}

function ownerCostCents(srv) {
  const { usage } = srv.readStore();
  return usage[BOOTSTRAP_TENANT_ID].costCents;
}

test("KV-P2-4: genau EINE Buchung je Inbound-Call, auch ueber einen Prozess-Neustart hinweg", async () => {
  const seed = seedState({
    calls: [
      seedCall({
        id: CALL_ID,
        direction: "inbound",
        from: DOMESTIC_TEST_NUMBER.e164,
        status: "completed",
        answeredAt: ANSWERED_AT,
        endedAt: ENDED_AT,
      }),
    ],
  });

  const srv1 = await startServer({ env: SPAWN_TARIFF_ENV, seed });
  const expectedCostCents = BILLED_MINUTES * INBOUND_CENTS;
  let dataDir;
  try {
    await completeCall(srv1, CALL_ID);
    assert.equal(ownerCostCents(srv1), expectedCostCents, "erste Buchung: Minuten x Inbound-Satz");

    await repeatCompletedInSameProcess(srv1, CALL_ID);
    assert.equal(ownerCostCents(srv1), expectedCostCents, "zweiter Callback im selben Prozess bucht nicht erneut");

    const persisted = srv1.readStore().calls.find((call) => call.id === CALL_ID);
    assert.equal(persisted.billedAt !== null && persisted.billedAt !== undefined, true, "billedAt ist persistiert");
    dataDir = srv1.dataDir;
  } finally {
    await srv1.stop();
  }

  const srv2 = await startServer({ env: SPAWN_TARIFF_ENV, dataDir });
  try {
    await completeCall(srv2, CALL_ID);
    assert.equal(
      ownerCostCents(srv2),
      expectedCostCents,
      "dritter Callback nach Neustart bucht NICHT erneut (bleibt x, nicht 2x)",
    );
    const persisted = srv2.readStore().calls.find((call) => call.id === CALL_ID);
    assert.equal(persisted.billedAt !== null && persisted.billedAt !== undefined, true, "billedAt ueberlebt den Neustart");
  } finally {
    await srv2.stop();
  }
});

const CODE_FALLBACK_INBOUND_CENTS = 6;
test("FAIL-RICHTUNG: VOICE_TARIFF_INBOUND_CENTS unset/leer bucht mit dem Code-Fallback 6, nie 0", async () => {
  const seed = seedState({
    calls: [
      seedCall({
        id: "kv_p2_fallback",
        direction: "inbound",
        from: DOMESTIC_TEST_NUMBER.e164,
        status: "completed",
        answeredAt: ANSWERED_AT,
        endedAt: ENDED_AT,
      }),
    ],
  });
  const srv = await startServer({ env: { VOICE_TARIFF_INBOUND_CENTS: "" }, seed });
  try {
    await completeCall(srv, "kv_p2_fallback");
    assert.equal(
      ownerCostCents(srv),
      BILLED_MINUTES * CODE_FALLBACK_INBOUND_CENTS,
      "unset/leer bucht den Code-Fallback (6), nie 0",
    );
    assert.notEqual(ownerCostCents(srv), 0, "kein stilles 0-Buchen bei fehlendem Wert");
  } finally {
    await srv.stop();
  }
});
