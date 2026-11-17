import assert from "node:assert/strict";
import { test } from "node:test";
import { waitUntil } from "../helpers.js";
import { echtWarten } from "../echt-warten.js";
import { geldBootJsonStarten } from "./geld-boot-json-aufbau.mjs";

const EL_BASIS = "https://el.abfrage-boot-json.invalid";
const KONVERSATION = "conv_abfrage_boot_json";
const MINUTE_MS = 60_000;
const BEOBACHTUNG_MS = 800;
const MANDANT = "t_geld_boot_json";

const { store } = await geldBootJsonStarten({
  ELEVENLABS_API_KEY: "el-abfrage-boot-json",
  ELEVENLABS_API_BASE: EL_BASIS,
  ELEVENLABS_RESULT_POLL_MS: "1500",
});

const abrufe = [];
const bisher = globalThis.fetch;
globalThis.fetch = async (url, optionen = {}) => {
  const ziel = new URL(String(url));
  if (ziel.origin !== EL_BASIS) return bisher(url, optionen);
  abrufe.push(ziel.pathname);
  return new Response(JSON.stringify({ status: "in-progress", transcript: [], metadata: {} }), { status: 200 });
};

test("Kriterium 5: im JSON-Speicher fragt der Boot-Takt die Abfrage eines Anrufs mit faelliger Abfrage-Frist ohne Neuaufbau an, schreibt die Frist weit in die Zukunft und fragt danach nicht erneut an", async () => {
  const call = store.createCall({
    direction: "inbound",
    from: "+4915799990052",
    to: "+4915799990053",
    tenantId: MANDANT,
    provider: "telnyx",
    twilioSid: "CA_geld_boot_json_abfrage",
  });
  call.status = "active";
  call.answeredAt = new Date().toISOString();
  call.elevenlabsConversationId = KONVERSATION;
  call.fristAbfrageAt = new Date(Date.now() - MINUTE_MS).toISOString();
  store.save();
  await waitUntil(() => abrufe.length > 0);
  await echtWarten(BEOBACHTUNG_MS);
  call.status = "completed";
  store.save();
  assert.deepEqual(abrufe, [`/v1/convai/conversations/${KONVERSATION}`]);
  assert.ok(Date.parse(call.fristAbfrageAt) > Date.now() + MINUTE_MS, call.fristAbfrageAt);
});

test("Kriterium 5: ein Anruf ohne Abfrage-Frist wird vom Boot-Takt nicht abgefragt", async () => {
  const vorher = abrufe.length;
  const call = store.createCall({
    direction: "inbound",
    from: "+4915799990052",
    to: "+4915799990053",
    tenantId: MANDANT,
    provider: "telnyx",
    twilioSid: "CA_geld_boot_json_abfrage_ohne",
  });
  call.status = "active";
  call.answeredAt = new Date().toISOString();
  call.elevenlabsConversationId = `${KONVERSATION}_ohne`;
  store.save();
  await echtWarten(BEOBACHTUNG_MS);
  call.status = "completed";
  store.save();
  assert.equal(abrufe.length, vorher);
});
