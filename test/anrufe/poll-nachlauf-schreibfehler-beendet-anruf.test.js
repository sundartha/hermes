import { test } from "node:test";
import assert from "node:assert/strict";

import { voiceMinutesOf } from "../../src/billing/metering.js";
import { makeElevenLabsOutbound } from "../../src/elevenlabs/outbound.js";
import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { billThunk, terminateAndBillCall } from "../../src/telephony/call-termination.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { waitUntil, withFetch } from "../helpers.js";
import { fehlerausgabeVonAsync } from "../gemeinsam/fehlerausgabe.js";
import { ACCOUNT, HTTP_OK, POLL_MS, baueStore, leererZustand, seedAusgehenderElCall } from "../_iel-inbound-harness.js";

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
  const store = {
    ...baueStore(state, { detektorZaehlungen: [] }),
    addActionItem: () => {
      throw new Error("db weg 5113");
    },
    leitungsplaetze: { freigeben: (id) => freigegeben.push(id) },
  };
  const gebucht = [];
  const callFinish = makeCallFinish({
    store,
    config: { billing: { paymentEnabled: false }, privacy: { diagnosticRetentionDays: 0 } },
    metering: { recordVoiceMinuteMeter() {}, reconcileVoiceBudget: (abgerechnet) => gebucht.push(voiceMinutesOf(abgerechnet)) },
    messaging: () => ({ sendSms: async () => {} }),
    summarizeCall: async () => null,
    planSummarySms: () => ({ send: false }),
    audit: () => {},
  });
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: { ...ACCOUNT, resultPollMs: POLL_MS } }),
    terminateAndBillCall,
    billThunk,
    finishCall: callFinish.finishCall,
    endCarrierCall: () => {},
  });
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
