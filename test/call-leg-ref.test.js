import { test } from "node:test";
import assert from "node:assert/strict";
import { legRefOfCall } from "../src/billing/call-leg-ref.js";

test("legRefOfCall: twilioSid hat Vorrang vor callControlId und sipCallId", () => {
  assert.equal(legRefOfCall({ twilioSid: "CA1", callControlId: "v3:1", sipCallId: "otb_1" }), "CA1");
});

test("legRefOfCall: callControlId, wenn kein twilioSid vorliegt", () => {
  assert.equal(legRefOfCall({ callControlId: "v3:1", sipCallId: "otb_1" }), "v3:1");
});

test("legRefOfCall: sipCallId als dritte Alternative (KV2-5, EL-Anrufe)", () => {
  assert.equal(legRefOfCall({ sipCallId: "otb_1" }), "otb_1");
});

test("legRefOfCall: null, wenn keiner der drei Werte vorliegt", () => {
  assert.equal(legRefOfCall({}), null);
});
