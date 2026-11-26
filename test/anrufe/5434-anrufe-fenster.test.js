import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID, makePgStore, makePgTestStore } from "../pg-helpers.js";

const MS_JE_MINUTE = 60 * 1000;
const ENDE_MS = Date.parse("2026-11-19T12:00:00.000Z");
const NICHT_GESTARTET = "not-placed";
const iso = (minutenVorher) => new Date(ENDE_MS - minutenVorher * MS_JE_MINUTE).toISOString();

async function zweiInstanzen() {
  const { store: b, runner } = await makePgTestStore();
  const a = makePgStore(runner);
  await a.init();
  return { a, b };
}

async function legeAn(store, ueber) {
  const call = store.createCall({ direction: "outbound", from: "+4930555000435", to: "+4915112345434", goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  Object.assign(call, ueber);
  await store.persistCall(call.id);
  return call;
}

const frueher = (minuten) => ({ failureReason: NICHT_GESTARTET, endedAt: iso(minuten) });

test("5434-3: anrufeDesMandanten mit seit liest nur Anrufe ab seit aus der Datenbank, ohne seit alle", async () => {
  const { a, b } = await zweiInstanzen();
  const alt = await legeAn(a, frueher(61));
  const grenze = await legeAn(a, frueher(60));
  const neu = await legeAn(a, frueher(10));
  const offen = await legeAn(a, {});
  const mitSeit = (await b.anrufeDesMandanten(BOOTSTRAP_TENANT_ID, iso(60))).map((call) => call.id);
  assert.deepEqual(mitSeit.toSorted(), [grenze.id, neu.id].toSorted());
  const ohneSeit = (await b.anrufeDesMandanten(BOOTSTRAP_TENANT_ID)).map((call) => call.id);
  assert.deepEqual(ohneSeit.toSorted(), [alt.id, grenze.id, neu.id, offen.id].toSorted());
});

test("5434-4: Der eigene Spiegel wird mit seit ebenso gefiltert", async () => {
  const { b } = await zweiInstanzen();
  const alt = b.createCall({ direction: "outbound", from: "+4930555000435", to: "+4915112345434", goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  alt.endedAt = iso(61);
  const neu = b.createCall({ direction: "outbound", from: "+4930555000435", to: "+4915112345434", goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  neu.endedAt = iso(5);
  const offen = b.createCall({ direction: "outbound", from: "+4930555000435", to: "+4915112345434", goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  const ids = (await b.anrufeDesMandanten(BOOTSTRAP_TENANT_ID, iso(60))).map((call) => call.id);
  assert.deepEqual(ids, [neu.id]);
  assert.equal((await b.anrufeDesMandanten(BOOTSTRAP_TENANT_ID)).length, 3);
  assert.ok(alt.id && offen.id);
});

test("5434-6: Ein nur im eigenen Spiegel liegender Anruf mit endedAt genau am Fensterbeginn zaehlt mit", async () => {
  const { b } = await zweiInstanzen();
  const grenze = b.createCall({ direction: "outbound", from: "+4930555000435", to: "+4915112345434", goal: "Test", tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx" });
  grenze.endedAt = iso(60);
  const ids = (await b.anrufeDesMandanten(BOOTSTRAP_TENANT_ID, iso(60))).map((call) => call.id);
  assert.deepEqual(ids, [grenze.id]);
});
