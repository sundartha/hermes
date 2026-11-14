import assert from "node:assert/strict";
import { test } from "node:test";

import { seedCall, seedState, waitUntil } from "../helpers.js";
import { CONV_ID, WARTE, baueHarness, isoVor, makeAnbieter, mitAnbieter, okAntwort } from "../_iel-inbound-harness.js";

const GESPRAECH = {
  conversation_id: CONV_ID,
  status: "in-progress",
  transcript: [{ role: "agent", message: "Guten Tag." }],
  analysis: null,
  metadata: { call_duration_secs: 3 },
};

test("live-transkript-verschwundener-anruf: verschwindet der Anruf während des Abrufs, bleibt der Takt ohne Fehler und schreibt nichts", async () => {
  const anker = isoVor(3);
  const call = seedCall({ id: "call_verschwunden", answeredAt: anker, startedAt: anker, elevenlabsConversationId: CONV_ID });
  const state = seedState({ calls: [call] });
  const { el, store } = baueHarness(state);
  let verschwunden = false;
  let abfragenDanach = 0;
  const abfrage = store.getCall;
  store.getCall = (id) => {
    if (verschwunden) abfragenDanach++;
    return abfrage(id);
  };
  const anbieter = makeAnbieter(async () => {
    state.calls = state.calls.filter((eintrag) => eintrag.id !== call.id);
    verschwunden = true;
    return okAntwort(GESPRAECH);
  });
  const abgelehnt = [];
  const merke = (grund) => abgelehnt.push(grund);
  process.on("unhandledRejection", merke);
  try {
    await mitAnbieter({ state, anbieter }, async () => {
      el.rearmActiveConversationPolls();
      await waitUntil(() => abgelehnt.length > 0 || abfragenDanach >= 2, WARTE);
    });
  } finally {
    process.off("unhandledRejection", merke);
  }
  assert.deepEqual(abgelehnt, []);
  assert.equal(state.calls.length, 0);
});
