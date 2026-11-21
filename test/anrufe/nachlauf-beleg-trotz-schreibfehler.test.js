import { test } from "node:test";
import assert from "node:assert/strict";

import { waitUntil, withFetch } from "../helpers.js";
import { fehlerausgabeVonAsync } from "../gemeinsam/fehlerausgabe.js";
import { HTTP_OK, baueHarness, leererZustand, seedAusgehenderElCall } from "../_iel-inbound-harness.js";

const LAUFZEIT_S = 60;
const SIP_KENNUNG = "otb_5747abcdef";
const ABSENDER = "+4930123456";
const KOSTEN_USD = 0.12;
const GESPRAECH = {
  conversation_id: "conv_beleg_5747",
  status: "done",
  transcript: [{ role: "agent", message: "Understood, see you then. Goodbye." }],
  analysis: {
    call_successful: "success",
    transcript_summary: "Agreed on the paperwork to bring.",
    data_collection_results: { next_steps: { data_collection_id: "next_steps", value: "Bring the registration." } },
  },
  metadata: {
    call_duration_secs: LAUFZEIT_S,
    cost_fiat: KOSTEN_USD,
    termination_reason: "Client disconnected: 1000",
    error: null,
    phone_call: { call_id: SIP_KENNUNG, agent_number: ABSENDER },
  },
};

async function laufeMitSchreibfehler(ausfall) {
  const state = leererZustand();
  const call = seedAusgehenderElCall(state, { answeredVorS: LAUFZEIT_S, mitGespraech: true });
  const freigegeben = [];
  const { el, store } = baueHarness(state);
  const belege = [];
  const sipKennungen = [];
  store.recordCallCostEvidence = (eingabe) => belege.push(eingabe);
  store.recordSipCallId = (id, sip) => sipKennungen.push([id, sip]);
  store[ausfall] = () => {
    throw new Error("db weg 5747");
  };
  store.leitungsplaetze = { freigeben: (id) => freigegeben.push(id) };
  const zeilen = await fehlerausgabeVonAsync(() =>
    withFetch(
      async () => ({ ok: true, status: HTTP_OK, json: async () => GESPRAECH }),
      async () => {
        await el.abfrageDurchLauf(call.id);
        await waitUntil(() => freigegeben.length > 0);
      },
    ),
  );
  return { call, zeilen, belege, sipKennungen };
}

test("addActionItem scheitert im Abfrage-Weg: EL-Kostenbeleg ist trotzdem gebucht, Fehler wird gemeldet, Anruf beendet", async () => {
  const { call, zeilen, belege } = await laufeMitSchreibfehler("addActionItem");
  assert.ok(belege.some((beleg) => beleg.traeger === "elevenlabs_convai"), JSON.stringify(belege));
  assert.ok(zeilen.some((z) => z.includes("[el-nachlauf] Anbieter-Ergebnis nicht gesichert") && z.includes("db weg 5747")), zeilen.join("\n"));
  assert.equal(call.status, "completed");
});

test("recordProviderCallResult scheitert im Abfrage-Weg: SIP-Kennung und Absender sind trotzdem gespeichert, Fehler wird gemeldet, Anruf beendet", async () => {
  const { call, zeilen, belege, sipKennungen } = await laufeMitSchreibfehler("recordProviderCallResult");
  assert.deepEqual(sipKennungen, [[call.id, SIP_KENNUNG]]);
  assert.equal(call.fromActualE164, ABSENDER);
  assert.ok(belege.some((beleg) => beleg.traeger === "elevenlabs_convai"));
  assert.ok(zeilen.some((z) => z.includes("[el-nachlauf] Anbieter-Ergebnis nicht gesichert") && z.includes("db weg 5747")), zeilen.join("\n"));
  assert.equal(call.status, "completed");
});
