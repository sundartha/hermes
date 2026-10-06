import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  seedState,
  seedCall,
  waitForStoreState,
  DOMESTIC_TEST_NUMBER,
} from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const ANSWERED_AT = "2026-01-01T00:00:00.000Z";
const ENDED_AT = "2026-01-01T00:05:00.000Z";
const BILLED_MINUTES = 5;
const DOMESTIC_TARIFF_CENTS = 20;
const DEFAULT_TARIFF_CENTS = 300;
const DOMESTIC_TO = "+4915112345678";
const CALL_ID = "bill_once";
const HTTP_OK = 200;

const TARIFF_ENV = {
  VOICE_TARIFF_DOMESTIC_CENTS: String(DOMESTIC_TARIFF_CENTS),
  VOICE_TARIFF_DEFAULT_CENTS: String(DEFAULT_TARIFF_CENTS),
};

const postStatus = (srv, callId, fields) =>
  fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

function abschlussMeldungen(store, callId) {
  return store.notifications.filter((notification) => notification.callId === callId).length;
}

async function completeCall(srv, callId) {
  const meldungenVorher = abschlussMeldungen(srv.readStore(), callId);
  const res = await postStatus(srv, callId, { CallStatus: "completed" });
  assert.equal(res.status, HTTP_OK);
  await waitForStoreState(srv, (store) => abschlussMeldungen(store, callId) > meldungenVorher);
}

function ownerCostCents(srv) {
  const { usage } = srv.readStore();
  return usage[BOOTSTRAP_TENANT_ID].costCents;
}

test("finishCall bucht Voice-Minuten genau einmal ueber einen Prozess-Neustart hinweg", async () => {
  const seed = seedState({
    calls: [
      seedCall({
        id: CALL_ID,
        direction: "outbound",
        to: DOMESTIC_TO,
        from: DOMESTIC_TEST_NUMBER.e164,
        status: "completed",
        answeredAt: ANSWERED_AT,
        endedAt: ENDED_AT,
      }),
    ],
  });

  const srv1 = await startServer({ env: TARIFF_ENV, seed });
  const expectedCostCents = BILLED_MINUTES * DOMESTIC_TARIFF_CENTS;
  let dataDir;
  try {
    await completeCall(srv1, CALL_ID);
    assert.equal(ownerCostCents(srv1), expectedCostCents, "erste Buchung: Minuten x Inlandstarif");
    const persisted = srv1.readStore().calls.find((call) => call.id === CALL_ID);
    assert.equal(
      Object.prototype.hasOwnProperty.call(persisted, "_finished"),
      false,
      "_finished ist strukturell ephemer und landet nie auf Platte",
    );
    assert.ok(persisted.billedAt, "billedAt ist der persistierte, prozessuebergreifende Marker");
    dataDir = srv1.dataDir;
  } finally {
    await srv1.stop();
  }

  const srv2 = await startServer({ env: TARIFF_ENV, dataDir });
  try {
    await completeCall(srv2, CALL_ID);
    assert.equal(
      ownerCostCents(srv2),
      expectedCostCents,
      "zweiter /voice/status-Callback nach Restart bucht NICHT erneut (bleibt X, nicht 2X)",
    );
  } finally {
    await srv2.stop();
  }
});
