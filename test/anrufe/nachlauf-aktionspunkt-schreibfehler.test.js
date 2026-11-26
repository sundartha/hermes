import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";
import { fristSignal } from "../gemeinsam/antwortfrist.mjs";
import { waitUntil } from "../helpers.js";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const HTTP_OK = 200;
const CONVERSATION_ID = "conv_nachlauf_schreibfehler_4739";
const NEXT_STEP_TEXT = "Bring the vehicle registration to the appointment on March 3.";
const KOSTENPROFIL_OUTBOUND_EL = "telnyx_outbound_el_convai";
const MANDANT = BOOTSTRAP_TENANT_ID;

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "postfach@kv2.invalid", eingang: true });
const store = await import("../../src/store.js");

const CONVERSATION = {
  conversation_id: CONVERSATION_ID,
  status: "done",
  transcript: [{ role: "agent", message: "Understood, see you then. Goodbye." }],
  analysis: {
    call_successful: "success",
    transcript_summary: "Agreed on the paperwork to bring.",
    data_collection_results: { next_steps: { data_collection_id: "next_steps", value: NEXT_STEP_TEXT } },
  },
  metadata: { call_duration_secs: 42, termination_reason: "Client disconnected: 1000", error: null },
};

test("Schreibfehler beim Anlegen des naechsten Schritts im ElevenLabs-Nachlauf wird beim Abbruch gemeldet statt als unbehandelte Ablehnung verloren", async () => {
  const hermes = laufendesHermes();
  const call = store.createCall({ direction: "outbound", from: "+10000000000", to: "+10000000001", tenantId: MANDANT });
  const state = store.load();
  const gespeichert = state.calls.find((eintrag) => eintrag.id === call.id);
  Object.assign(gespeichert, {
    status: "active",
    costProfile: KOSTENPROFIL_OUTBOUND_EL,
    answeredAt: new Date().toISOString(),
    elevenlabsConversationId: CONVERSATION_ID,
  });
  store.save();
  await store.drainFlushes();
  await hermes.db.query("CREATE FUNCTION schreibfehler_4739() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'db weg 4739'; END $$ LANGUAGE plpgsql");
  await hermes.db.query("CREATE TRIGGER schreibfehler_4739 BEFORE INSERT ON action_item FOR EACH ROW EXECUTE FUNCTION schreibfehler_4739()");

  const zeilen = [];
  const unbehandelt = [];
  const zaehler = (grund) => unbehandelt.push(String(grund));
  const fehlerOrig = console.error;
  const fetchOrig = globalThis.fetch;
  console.error = (...a) => zeilen.push(a.map(String).join(" "));
  process.on("unhandledRejection", zaehler);
  globalThis.fetch = async (url, optionen) => {
    if (String(url).includes(`/v1/convai/conversations/${CONVERSATION_ID}`)) {
      return new Response(JSON.stringify(CONVERSATION), { status: HTTP_OK, headers: { "content-type": "application/json" } });
    }
    return fetchOrig(url, { ...optionen, signal: fristSignal() });
  };
  let antwort;
  try {
    antwort = await hermes.anfrage(`/api/calls/${call.id}/cancel`, { method: "POST" });
    await waitUntil(() => zeilen.some((z) => z.includes("[cancel]")));
  } finally {
    globalThis.fetch = fetchOrig;
    console.error = fehlerOrig;
    process.off("unhandledRejection", zaehler);
  }

  assert.equal(antwort.status, HTTP_OK);
  assert.ok(zeilen.some((z) => z.includes("[cancel]") && z.includes("db weg 4739")), zeilen.join("\n"));
  assert.deepEqual(unbehandelt, []);
  const { rows } = await hermes.db.query("SELECT count(*)::int AS anzahl FROM action_item WHERE call_id = $1", [call.id]);
  assert.equal(rows[0].anzahl, 0);
});
