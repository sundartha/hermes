import { test } from "node:test";
import assert from "node:assert/strict";

const { makePgTestStore } = await import("../pg-helpers.js");

test("clearNumberElInboundTrunkBeleg: allein gesetztes Belegt-am-Feld wird erkannt und entfernt", async () => {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({ id: "t_belegt_allein", status: "active" });
  const nummer = {
    id: "num_belegt_allein",
    tenantId: "t_belegt_allein",
    e164: "+4915755500104",
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_belegt_allein",
    country: "DE",
    language: "de",
    paymentIntentId: null,
    elInboundTrunkBelegtAt: "2026-01-01T00:00:00.000Z",
  };
  state.numbers.push(nummer);

  const ergebnis = await store.clearNumberElInboundTrunkBeleg(nummer.id);

  assert.equal(ergebnis.changed, true);
  assert.equal("elInboundTrunkBelegtAt" in nummer, false);
});
