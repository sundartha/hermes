import assert from "node:assert/strict";
import { test } from "node:test";

import { seedCall, seedState, waitUntil } from "../helpers.js";
import { CONV_ID, WARTE, baueHarness, isoVor, makeAnbieter, mitAnbieter, okAntwort } from "../_iel-inbound-harness.js";

const GESPRAECH = {
  conversation_id: CONV_ID,
  status: "in-progress",
  transcript: [
    { role: "agent", message: "Guten Tag." },
    { role: "user", message: "Hallo." },
  ],
  analysis: null,
  metadata: { call_duration_secs: 3 },
};

test("transkript-gleichzeitige-schreiber: zwei Abruf-Schleifen speichern die Zeilen des laufenden Gespraechs je einmal", async () => {
  const anker = isoVor(3);
  const call = seedCall({ id: "call_zwei_schreiber", answeredAt: anker, startedAt: anker, elevenlabsConversationId: CONV_ID });
  const state = seedState({ calls: [call] });
  const erste = baueHarness(state);
  const zweite = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(GESPRAECH));
  await mitAnbieter({ state, anbieter }, async () => {
    erste.el.rearmActiveConversationPolls();
    zweite.el.rearmActiveConversationPolls();
    await waitUntil(() => anbieter.gets >= 6, WARTE);
  });
  const gespeichert = state.calls.find((eintrag) => eintrag.id === call.id).transcript;
  assert.deepEqual(
    gespeichert.map((zeile) => zeile.text),
    ["Guten Tag.", "Hallo."],
  );
});
