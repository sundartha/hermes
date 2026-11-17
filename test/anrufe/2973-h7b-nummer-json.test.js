import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_ENV, tempDataDir } from "../helpers.js";

const NUMMER = "+4915799990771";
const GEGENSTELLE = "+4915112349971";

Object.assign(process.env, BASE_ENV, { DATA_DIR: tempDataDir(), STORE_BACKEND: "json" });

const store = await import("../../src/store.js");
await store.oeffneSpeicher();

test("H7b-J1: im JSON-Speicher sperrt ein aktiver Anruf die Nummer, jede andere bleibt frei", async () => {
  store.createCall({ direction: "outbound", from: NUMMER, to: GEGENSTELLE, goal: "Test", tenantId: "t_h7b_json", provider: "telnyx" });
  assert.equal(await store.numberHasActiveCall(NUMMER), true);
  assert.equal(await store.numberHasActiveCall("+4915799990772"), false);
});
