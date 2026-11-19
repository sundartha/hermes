import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_ENV, tempDataDir } from "../helpers.js";

const MANDANT = "t_h7c2b4b3_json";
const ANDERER = "t_h7c2b4b3_json_anderer";
const KONVERSATION = "conv_h7c2b4b3_json";

Object.assign(process.env, BASE_ENV, { DATA_DIR: tempDataDir(), STORE_BACKEND: "json" });

const store = await import("../../src/store.js");
await store.oeffneSpeicher();

const neu = (tenantId) =>
  store.createCall({ direction: "outbound", from: "+4930555000431", to: "+4915112349944", goal: "Test", tenantId, provider: "telnyx" });

test("H7c2b4b3-J1: Im JSON-Speicher findet anderesAnrufMitKonversation nur andere Anrufe mit der Kennung", async () => {
  const eigen = neu(MANDANT);
  eigen.elevenlabsConversationId = KONVERSATION;
  assert.equal(await store.anderesAnrufMitKonversation(eigen.id, KONVERSATION), false);
  const andere = neu(ANDERER);
  assert.equal(await store.anderesAnrufMitKonversation(andere.id, KONVERSATION), true);
  assert.equal(await store.anderesAnrufMitKonversation(andere.id, "conv_unbekannt"), false);
});

test("H7c2b4b3-J2: Im JSON-Speicher liefert anrufeDesMandanten nur die Anrufe dieses Mandanten", async () => {
  const eigener = neu("t_h7c2b4b3_json_j2");
  const fremder = neu("t_h7c2b4b3_json_j2_fremd");
  assert.deepEqual((await store.anrufeDesMandanten("t_h7c2b4b3_json_j2")).map((call) => call.id), [eigener.id]);
  assert.deepEqual((await store.anrufeDesMandanten("t_h7c2b4b3_json_j2_fremd")).map((call) => call.id), [fremder.id]);
});
