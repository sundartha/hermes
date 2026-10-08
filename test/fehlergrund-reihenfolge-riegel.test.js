import test from "node:test";
import assert from "node:assert/strict";
import { terminateAndBillCall, persistEndWithReason } from "../src/telephony/call-termination.js";
import { endFailedCallWithReason } from "../src/routes/api-calls.js";

const PROVIDER_STATUS_403 = 403;

test("R1 Mechanismus-Pin (Positiv-Kontrolle): persistEnd laeuft vor bill", async () => {
  const order = [];
  await terminateAndBillCall({
    persistEnd: () => order.push("persist"),
    hangUp: null,
    bill: () => order.push("bill"),
  });
  assert.deepEqual(order, ["persist", "bill"]);
});

test("R2 Produktions-Thunk: endFailedCallWithReason schreibt den Grund VOR dem Endstatus", () => {
  const seen = [];
  const store = {
    recordFailureReason: (id, reason) => seen.push(`reason:${reason}`),
    endCallRecord: (id, status) => seen.push(`end:${status}`),
  };
  endFailedCallWithReason(store, "call_x", PROVIDER_STATUS_403)();
  assert.deepEqual(seen, ["reason:not-placed:start-403", "end:failed"]);
});

test("R3 Laufzeit je Naht: persistEndWithReason ruft recordFailureReason VOR endCall", () => {
  const seen = [];
  const store = { recordFailureReason: (id, reason) => seen.push(`reason:${reason}`) };
  const thunk = persistEndWithReason({
    store,
    callId: "call_y",
    reason: "not-placed:invite-403-D51",
    endCall: () => seen.push("end"),
  });
  thunk();
  assert.deepEqual(seen, ["reason:not-placed:invite-403-D51", "end"]);
});
