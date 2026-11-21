import { test } from "node:test";
import assert from "node:assert/strict";

import { waitUntil, withFetch } from "../helpers.js";
import { fehlerausgabeVonAsync } from "../gemeinsam/fehlerausgabe.js";
import { HTTP_OK, baueHarness, leererZustand, seedAusgehenderElCall } from "../_iel-inbound-harness.js";

const LAUFZEIT_S = 60;
const NAECHSTER_SCHRITT = "Bring the vehicle registration to the appointment on March 3.";
const GESPRAECH = {
  conversation_id: "conv_poll_schreibfehler_5113",
  status: "done",
  transcript: [{ role: "agent", message: "Understood, see you then. Goodbye." }],
  analysis: {
    call_successful: "success",
    transcript_summary: "Agreed on the paperwork to bring.",
    data_collection_results: { next_steps: { data_collection_id: "next_steps", value: NAECHSTER_SCHRITT } },
  },
  metadata: { call_duration_secs: LAUFZEIT_S, termination_reason: "Client disconnected: 1000", error: null },
};

test("Schreibfehler beim Sichern des Anbieter-Ergebnisses im Nachlauf: Fehler wird gemeldet, Anrufende und Leitungsplatz-Freigabe laufen trotzdem", async () => {
  const state = leererZustand();
  const call = seedAusgehenderElCall(state, { answeredVorS: LAUFZEIT_S, mitGespraech: true });
  const freigegeben = [];
  const { el, store, gebucht } = baueHarness(state);
  store.addActionItem = () => {
    throw new Error("db weg 5113");
  };
  store.leitungsplaetze = { freigeben: (id) => freigegeben.push(id) };
  const unbehandelt = [];
  const zaehler = (grund) => unbehandelt.push(String(grund));
  process.on("unhandledRejection", zaehler);
  let zeilen;
  try {
    zeilen = await fehlerausgabeVonAsync(() =>
      withFetch(
        async () => ({ ok: true, status: HTTP_OK, json: async () => GESPRAECH }),
        async () => {
          await el.abfrageDurchLauf(call.id);
          await waitUntil(() => freigegeben.length > 0);
        },
      ),
    );
  } finally {
    process.off("unhandledRejection", zaehler);
  }

  assert.ok(zeilen.some((z) => z.includes("[el-nachlauf] Anbieter-Ergebnis nicht gesichert") && z.includes(`call=${call.id}`) && z.includes("db weg 5113")), zeilen.join("\n"));
  assert.equal(call.status, "completed");
  assert.ok(call.endedAt);
  assert.deepEqual(freigegeben, [call.id]);
  assert.deepEqual(unbehandelt, []);
  assert.deepEqual(gebucht, [1]);
  assert.deepEqual(state.actionItems.filter((punkt) => punkt.callId === call.id), []);
});
