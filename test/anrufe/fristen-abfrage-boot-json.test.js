import assert from "node:assert/strict";
import { test } from "node:test";
import { waitUntil } from "../helpers.js";
import { geldBootJsonStarten } from "./geld-boot-json-aufbau.mjs";

const EL_BASIS = "https://el.abfrage-boot-json.invalid";
const KONVERSATION = "conv_abfrage_boot_json";
const MINUTE_MS = 60_000;
const FRIST_MS = 120_000 + 30_000;
const MANDANT = "t_geld_boot_json";

const { store } = await geldBootJsonStarten({
  ELEVENLABS_API_KEY: "el-abfrage-boot-json",
  ELEVENLABS_API_BASE: EL_BASIS,
  ELEVENLABS_RESULT_POLL_MS: "1500",
});

const abrufe = [];
globalThis.fetch = async (url) => {
  const ziel = new URL(String(url));
  if (ziel.origin !== EL_BASIS) throw new Error(`Testaufbau: kein Zugriff nach außen (${ziel.origin}${ziel.pathname})`);
  abrufe.push(ziel.pathname);
  return new Response(JSON.stringify({ status: "in-progress", transcript: [], metadata: {} }), { status: 200 });
};

function aktiverAnruf(kennung, { fristAbfrageAt }) {
  const call = store.createCall({
    direction: "inbound",
    from: "+4915799990052",
    to: "+4915799990053",
    tenantId: MANDANT,
    provider: "telnyx",
    twilioSid: `CA_geld_boot_json_${kennung}`,
  });
  call.status = "active";
  call.answeredAt = new Date().toISOString();
  call.elevenlabsConversationId = `${KONVERSATION}_${kennung}`;
  if (fristAbfrageAt) call.fristAbfrageAt = fristAbfrageAt;
  store.save();
  return call;
}

const abrufeVon = (kennung) => abrufe.filter((pfad) => pfad.endsWith(`_${kennung}`)).length;

async function einenTaktAbwarten(kennung) {
  const sonde = aktiverAnruf(kennung, { fristAbfrageAt: new Date(Date.now() - MINUTE_MS).toISOString() });
  await waitUntil(() => abrufeVon(kennung) > 0);
  sonde.status = "completed";
  store.save();
}

test("Kriterium 5: im JSON-Speicher fragt der Boot-Takt die Abfrage eines Anrufs mit faelliger Abfrage-Frist ohne Neuaufbau an, schreibt die Frist weit in die Zukunft und fragt danach nicht erneut an", async () => {
  const vor = Date.now();
  const call = aktiverAnruf("eins", { fristAbfrageAt: new Date(vor - MINUTE_MS).toISOString() });
  await waitUntil(() => abrufeVon("eins") > 0);
  await einenTaktAbwarten("sonde_a");
  await einenTaktAbwarten("sonde_b");
  call.status = "completed";
  store.save();
  assert.equal(abrufeVon("eins"), 1);
  assert.deepEqual(abrufe.filter((pfad) => pfad.endsWith("_eins")), [`/v1/convai/conversations/${KONVERSATION}_eins`]);
  const faellig = Date.parse(call.fristAbfrageAt);
  assert.ok(faellig >= vor + FRIST_MS && faellig <= Date.now() + FRIST_MS, call.fristAbfrageAt);
});

test("Kriterium 5: ein Anruf ohne Abfrage-Frist wird vom Boot-Takt nicht abgefragt", async () => {
  const call = aktiverAnruf("ohne", {});
  await einenTaktAbwarten("sonde_c");
  await einenTaktAbwarten("sonde_d");
  call.status = "completed";
  store.save();
  assert.equal(abrufeVon("ohne"), 0);
});
