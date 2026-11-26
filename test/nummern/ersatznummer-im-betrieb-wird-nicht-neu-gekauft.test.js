import { test } from "node:test";
import assert from "node:assert/strict";

const { makePgTestStore } = await import("../pg-helpers.js");
const { speicherBereiche } = await import("../../src/store.js");

const DECKE = 50;

async function mitAngefragterErsatznummer(tenantId, endung) {
  const { store } = await makePgTestStore();
  const state = store.load();
  const altId = `num_${tenantId}`;
  state.tenants.push({ id: tenantId, status: "active" });
  state.numbers.push({
    id: altId,
    tenantId,
    e164: `+49157555001${endung}`,
    provider: "telnyx",
    status: "active",
    providerNumberId: `pnum_${tenantId}`,
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  const nummern = speicherBereiche(store).nummern;
  const erster = await nummern.ersatzNummerAnfordern({ oldNumberId: altId, maxNumbers: DECKE });
  assert.equal(erster.wert.purchase, true);
  return { nummern, altId, ersatz: erster.wert.number };
}

test("ersatzNummerAnfordern: eine schon aktive Ersatznummer wird nicht noch einmal gekauft", async () => {
  const { nummern, altId, ersatz } = await mitAngefragterErsatznummer("t_ersatz_aktiv", "05");
  ersatz.status = "active";

  const zweiter = await nummern.ersatzNummerAnfordern({ oldNumberId: altId, maxNumbers: DECKE });

  assert.equal(zweiter.ok, true);
  assert.equal(zweiter.wert.purchase, false);
  assert.equal(ersatz.status, "active");
});

test("ersatzNummerAnfordern: eine gesperrte Ersatznummer wird nicht noch einmal gekauft", async () => {
  const { nummern, altId, ersatz } = await mitAngefragterErsatznummer("t_ersatz_gesperrt", "06");
  ersatz.status = "suspended";

  const zweiter = await nummern.ersatzNummerAnfordern({ oldNumberId: altId, maxNumbers: DECKE });

  assert.equal(zweiter.ok, true);
  assert.equal(zweiter.wert.purchase, false);
  assert.equal(ersatz.status, "suspended");
});
