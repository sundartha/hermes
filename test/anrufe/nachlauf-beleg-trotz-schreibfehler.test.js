import { test } from "node:test";
import assert from "node:assert/strict";

import { waitUntil, withFetch } from "../helpers.js";
import { fehlerausgabeVonAsync } from "../gemeinsam/fehlerausgabe.js";
import * as ops from "../../src/store/state-ops.js";
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
  store.recordCallCostEvidence = (eingabe) => ops.recordCallCostEvidence(state, eingabe);
  store.recordSipCallId = (id, sip) => ops.recordSipCallId(state, id, sip);
  store.recordActualSender = (id, absender) => ops.recordActualSender(state, id, absender);
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
  return { state, call, zeilen };
}

const belegeVon = (state, id) => (state.callCostEvidence ?? []).filter((zeile) => zeile.callId === id);

test("addActionItem scheitert im Abfrage-Weg: EL-Kostenbeleg ist trotzdem gebucht, Fehler wird gemeldet, Anruf beendet", async () => {
  const { state, call, zeilen } = await laufeMitSchreibfehler("addActionItem");
  const belege = belegeVon(state, call.id);
  assert.ok(belege.some((beleg) => beleg.traeger === "elevenlabs_convai"), JSON.stringify(belege));
  assert.ok(zeilen.some((z) => z.includes("[el-nachlauf] Anbieter-Ergebnis nicht gesichert") && z.includes("db weg 5747")), zeilen.join("\n"));
  assert.equal(call.status, "completed");
});

test("recordProviderCallResult scheitert im Abfrage-Weg: SIP-Kennung und Absender sind trotzdem gespeichert, Fehler wird gemeldet, Anruf beendet", async () => {
  const { state, call, zeilen } = await laufeMitSchreibfehler("recordProviderCallResult");
  assert.equal(call.sipCallId, SIP_KENNUNG);
  assert.equal(call.fromActualE164, ABSENDER);
  assert.ok(belegeVon(state, call.id).length > 0);
  assert.ok(zeilen.some((z) => z.includes("[el-nachlauf] Anbieter-Ergebnis nicht gesichert") && z.includes("db weg 5747")), zeilen.join("\n"));
  assert.equal(call.status, "completed");
});
