import assert from "node:assert/strict";
import { after, test } from "node:test";
import { waitUntil } from "../helpers.js";
import { geldBootJsonStarten } from "./geld-boot-json-aufbau.mjs";

const FRIST_BIS_ABFRAGE_MS = 10_000;
const MINUTE_MS = 60_000;
const POLL_MS = 100;
const UEBERNAHME_MS = 30_000;
const EL_BASIS = "https://el.abfrage-boot.invalid";
const MANDANT = "t_geld_boot_json";

const abgefragt = [];
const { store } = await geldBootJsonStarten({
  ELEVENLABS_API_BASE: EL_BASIS,
  ELEVENLABS_API_KEY: "el-abfrage-boot-signierwert",
  ELEVENLABS_RESULT_POLL_MS: String(POLL_MS),
});
globalThis.fetch = async (url) => {
  const ziel = new URL(String(url));
  if (ziel.origin !== EL_BASIS) throw new Error(`Testaufbau: kein Zugriff nach außen (${ziel.origin})`);
  abgefragt.push(ziel.pathname.split("/").at(-1));
  const gespraech = { conversation_id: "x", status: "in-progress", transcript: [], metadata: { call_duration_secs: 0 } };
  return new Response(JSON.stringify(gespraech), { status: 200, headers: { "content-type": "application/json" } });
};

function elAnruf(kennung, { rueckfall = false } = {}) {
  const jetzt = new Date().toISOString();
  const call = store.createCall({
    direction: "inbound",
    from: "+4915799990052",
    to: "+4915799990053",
    tenantId: MANDANT,
    provider: "telnyx",
    twilioSid: `CA_abfrage_boot_${kennung}`,
    maxDurationS: 3600,
  });
  Object.assign(call, {
    status: "active",
    costProfile: "telnyx_inbound_el_convai",
    startedAt: jetzt,
    answeredAt: jetzt,
    elevenlabsConversationId: `conv_${kennung}`,
    elFallbackAt: rueckfall ? jetzt : undefined,
    fristAbfrageAt: new Date(Date.now() - MINUTE_MS).toISOString(),
  });
  store.save();
  return call.id;
}

test("Kriterium 5: im JSON-Speicher fragt der Boot-Takt einen faelligen Anruf ohne Timer ab und setzt die naechste Frist nach Intervall plus Uebernahmezeit", async () => {
  const vorher = Date.now();
  const id = elAnruf("faellig");
  await waitUntil(() => abgefragt.includes("conv_faellig"), { timeoutMs: FRIST_BIS_ABFRAGE_MS });
  await waitUntil(() => Date.parse(store.getCall(id).fristAbfrageAt) > vorher, { timeoutMs: FRIST_BIS_ABFRAGE_MS });
  const naechste = Date.parse(store.getCall(id).fristAbfrageAt);
  assert.ok(naechste >= vorher + POLL_MS + UEBERNAHME_MS);
  assert.ok(naechste <= Date.now() + POLL_MS + UEBERNAHME_MS);
  assert.equal(store.getCall(id).status, "active");
});

test("Kriterium 5: ein Anruf in der Rueckfall-Uebergabe wird nicht abgefragt, seine Frist wird geleert", async () => {
  const id = elAnruf("rueckfall", { rueckfall: true });
  await waitUntil(() => store.getCall(id).fristAbfrageAt === null, { timeoutMs: FRIST_BIS_ABFRAGE_MS });
  assert.equal(abgefragt.includes("conv_rueckfall"), false);
});

after(() => {
  for (const call of store.load().calls) call.status = "completed";
  store.save();
});
