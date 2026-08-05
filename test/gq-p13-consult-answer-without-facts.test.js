// GQ-P13 (Gespraechsqualitaet): keine "Antwort ist DA"-Anweisung ohne Antwort.
//
// Befund F2 der Fragilitaets-Analyse: answerConsult (claude.js) setzt consult.status
// UNBEDINGT auf "answered" - auch dann, wenn mergeContextFacts am geteilten Deckel
// KEY_FACTS_LIMITS null Fakten aus der Antwort in call.context.key_facts uebernommen hat
// (z.B. weil der Deckel schon voll war, AL-P13-10). Vorher genuegte allein der Status
// "answered" ohne deliveredAt, damit consultAnswerAwaitingDelivery true meldete und
// advanceInCallConsult den Steuertext CONSULT_WAIT.ANSWERED auslieferte - eine Anweisung
// an das Modell, JETZT eine Auskunft zu nennen, die nirgends im Prompt steht, waehrend
// derselbe Steuertext jeden ehrlichen Ausweg verbietet (nicht nachfragen, kein Rueckruf,
// keine Nachricht).
//
// Beleg-Kette: mergeContextFacts -> answerConsult (beide claude.js, bewusst UNVERAENDERT -
// die Spec grenzt sie aus) -> answerAwaitsDelivery (state-ops.js, NEU, GQ-P13) ->
// consultAnswerAwaitingDelivery + markConsultAnswerDelivered (state-ops.js, beide lesen
// jetzt DIESELBE Bedingung statt zweier auseinanderlaufender Kopien, G5).
//
// Testnamen tragen bewusst KEINE Katalog-ID (GAP-/PROMPT-/...) am Namensanfang - sonst
// landen sie still im Gates-Lauf, wo Rot erlaubt ist (Lehre
// catalog-id-prefix-misroutes-tests). Praefix ist "GQ-P13-<n>:".
//
// Reine state-ops-Ops auf einem In-Memory-Objekt (kein Store-Wrapper noetig) - Muster
// al-p12-call-memory.test.js: state-ops.js zieht kein config.js, nur defaults.js/
// locales.js/crypto, statischer Import ist unproblematisch. Offline, kein Netz, kein
// Spawn, kein Sleep.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ops from "../src/store/state-ops.js";
import { seedState, seedCall } from "./helpers.js";
import { CONSULT_STATUS, CONSULT_WAIT } from "../src/store/defaults.js";

const CALL_ID = "call_gqp13";
const WAIT_MS = 1_000;
const OPEN_MS = 300_000;

// Ein Call mit EINGETROFFENER, noch nicht ausgelieferter Rueckfrage-Antwort. askedAt liegt
// nach call.answeredAt - nur dann zaehlt der Consult als In-Call-Consult
// (isInCallConsult), und nur In-Call-Consults erreichen das Praedikat.
function stateWithAnsweredConsult({ answeredFacts = 1, ...consultOverrides } = {}) {
  const call = seedCall({
    id: CALL_ID,
    direction: "outbound",
    status: "active",
    answeredAt: new Date(Date.now() - 600_000).toISOString(),
    consults: [
      {
        id: "c0",
        seq: 0,
        status: CONSULT_STATUS.ANSWERED,
        askedAt: new Date(Date.now() - 20_000).toISOString(),
        answeredAt: new Date(Date.now() - 4_000).toISOString(),
        answeredFacts,
        ...consultOverrides,
      },
    ],
  });
  return seedState({ calls: [call] });
}

const step = (s) => ops.advanceInCallConsult(s, CALL_ID, { nowMs: Date.now(), waitMs: WAIT_MS, openMs: OPEN_MS });

test("GQ-P13-1: Antwort MIT Fakten wartet weiterhin auf Zustellung (Bestand)", () => {
  const s = stateWithAnsweredConsult({ answeredFacts: 2 });
  const call = ops.getCall(s, CALL_ID);
  assert.equal(ops.consultAnswerAwaitingDelivery(call), true);
});

test("GQ-P13-2: Antwort OHNE uebernommene Fakten wartet auf nichts", () => {
  const s = stateWithAnsweredConsult({ answeredFacts: 0 });
  const call = ops.getCall(s, CALL_ID);
  assert.equal(ops.consultAnswerAwaitingDelivery(call), false);
});

test("GQ-P13-3: ohne Fakten traegt der Turn keinen Ankunfts-Steuertext", () => {
  const s = stateWithAnsweredConsult({ answeredFacts: 0 });
  const result = step(s);
  assert.equal(result.wait, CONSULT_WAIT.NONE);
  assert.notEqual(result.wait, CONSULT_WAIT.ANSWERED);
  assert.equal(result.changed, false);
  assert.equal(ops.getCall(s, CALL_ID).consults[0].status, CONSULT_STATUS.ANSWERED);
});

test("GQ-P13-4: ohne Fakten oeffnet sich kein Zustellfenster - deliveredAt bleibt aus", () => {
  const s = stateWithAnsweredConsult({ answeredFacts: 0 });
  const result = ops.markConsultAnswerDelivered(s, CALL_ID);
  assert.equal(result.marked, 0);
  assert.equal(result.changed, false);
  assert.equal(ops.getCall(s, CALL_ID).consults[0].deliveredAt, undefined);
});

test("GQ-P13-5: gemischt - nur die faktentragende Antwort wird ausgeliefert", () => {
  const s = stateWithAnsweredConsult({ answeredFacts: 0 });
  const call = ops.getCall(s, CALL_ID);
  call.consults.push({
    id: "c1",
    seq: 1,
    status: CONSULT_STATUS.ANSWERED,
    askedAt: new Date(Date.now() - 15_000).toISOString(),
    answeredAt: new Date(Date.now() - 3_000).toISOString(),
    answeredFacts: 3,
  });

  const result = ops.markConsultAnswerDelivered(s, CALL_ID);

  assert.equal(result.marked, 1);
  assert.equal(call.consults[0].deliveredAt, undefined);
  assert.equal(typeof call.consults[1].deliveredAt, "string");
});

test("GQ-P13-6: Datensatz ohne answeredFacts-Feld ist fail-closed", () => {
  const s = stateWithAnsweredConsult();
  const call = ops.getCall(s, CALL_ID);
  delete call.consults[0].answeredFacts;
  assert.equal(ops.consultAnswerAwaitingDelivery(call), false);
});

test("GQ-P13-7: der Nullfall erzeugt keine Schleife - jeder weitere Turn bleibt NONE", () => {
  const s = stateWithAnsweredConsult({ answeredFacts: 0 });
  const before = JSON.parse(JSON.stringify(ops.getCall(s, CALL_ID).consults[0]));

  for (let i = 0; i < 3; i += 1) {
    const result = step(s);
    assert.equal(result.wait, CONSULT_WAIT.NONE);
    assert.equal(result.changed, false);
  }

  assert.deepEqual(ops.getCall(s, CALL_ID).consults[0], before);
});
