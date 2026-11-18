import assert from "node:assert/strict";
import { test } from "node:test";

import { CONVERSATION_IN_PROGRESS } from "../fixtures/elevenlabs-conversations.js";
import { waitUntil } from "../helpers.js";
import {
  RUHE_TAKTE,
  WARTE,
  baueHarness,
  beendeSchleifen,
  makeAnbieter,
  mitAnbieter,
  okAntwort,
  leererZustand,
  ruhe,
  seedAusgehenderElCall,
  seedInboundElCall,
} from "../_iel-inbound-harness.js";

const GESPRAECH_S = 240;

function haltAbrufFest(anbieter) {
  let freigeben;
  const tor = new Promise((resolve) => {
    freigeben = resolve;
  });
  anbieter.setzeAntwort(() => tor);
  return freigeben;
}

test("Abfrage durch den Lauf: ein unbekannter Anruf und ein Anruf ohne Gespraech fragen den Anbieter nicht", async () => {
  const state = leererZustand();
  const ohneGespraech = seedAusgehenderElCall(state, { answeredVorS: GESPRAECH_S, mitGespraech: false });
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(CONVERSATION_IN_PROGRESS));

  await mitAnbieter({ state, anbieter }, async () => {
    await harness.el.abfrageDurchLauf("call_unbekannt");
    await harness.el.abfrageDurchLauf(ohneGespraech.id);
    await ruhe(RUHE_TAKTE);
  });

  assert.equal(anbieter.gets, 0);
});

test("Abfrage durch den Lauf: ein zweiter Aufruf waehrend der laufenden Abfrage startet keine zweite Kette", async () => {
  const state = leererZustand();
  const call = seedAusgehenderElCall(state, { answeredVorS: GESPRAECH_S, mitGespraech: true });
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(CONVERSATION_IN_PROGRESS));

  await mitAnbieter({ state, anbieter }, async () => {
    const freigeben = haltAbrufFest(anbieter);
    await harness.el.abfrageDurchLauf(call.id);
    await waitUntil(() => anbieter.offen === 1, WARTE);
    await harness.el.abfrageDurchLauf(call.id);
    await ruhe(RUHE_TAKTE);
    assert.equal(anbieter.offen, 1);
    assert.equal(anbieter.gets, 1);
    freigeben(okAntwort(CONVERSATION_IN_PROGRESS));
    await beendeSchleifen(state, anbieter);
  });

  assert.equal(anbieter.maxOffen, 1);
});

test("Abfrage durch den Lauf: bei einem gebundenen eingehenden Anruf startet das Start-Tor des Nachlaufs keine zweite Kette", async () => {
  const state = leererZustand();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(CONVERSATION_IN_PROGRESS));

  await mitAnbieter({ state, anbieter }, async () => {
    const freigeben = haltAbrufFest(anbieter);
    await harness.el.abfrageDurchLauf(call.id);
    await waitUntil(() => anbieter.offen === 1, WARTE);
    harness.el.startInboundNachlauf(call.id);
    await ruhe(RUHE_TAKTE);
    assert.equal(anbieter.offen, 1);
    assert.ok(call.elNachlaufStartedAt, "das Start-Tor setzt den Marker trotzdem");
    freigeben(okAntwort(CONVERSATION_IN_PROGRESS));
    await beendeSchleifen(state, anbieter);
  });

  assert.equal(anbieter.maxOffen, 1);
});
