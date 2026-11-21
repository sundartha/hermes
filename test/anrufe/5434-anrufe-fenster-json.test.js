import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_ENV, tempDataDir } from "../helpers.js";

const MANDANT = "t_5434_json";
const ENDE_MS = Date.parse("2026-11-19T12:00:00.000Z");
const iso = (minuten) => new Date(ENDE_MS - minuten * 60 * 1000).toISOString();

Object.assign(process.env, BASE_ENV, { DATA_DIR: tempDataDir(), STORE_BACKEND: "json" });

const store = await import("../../src/store.js");
await store.oeffneSpeicher();

const neu = (endedAt) => {
  const call = store.createCall({ direction: "outbound", from: "+4930555000436", to: "+4915112345435", goal: "Test", tenantId: MANDANT, provider: "telnyx" });
  if (endedAt) call.endedAt = endedAt;
  return call;
};

test("5434-J1: Im JSON-Speicher filtert anrufeDesMandanten mit seit nach endedAt, ohne seit liefert es alle", async () => {
  const alt = neu(iso(61));
  const grenze = neu(iso(60));
  const offen = neu();
  assert.deepEqual((await store.anrufeDesMandanten(MANDANT, iso(60))).map((call) => call.id), [grenze.id]);
  assert.deepEqual((await store.anrufeDesMandanten(MANDANT)).map((call) => call.id).toSorted(), [alt.id, grenze.id, offen.id].toSorted());
});
