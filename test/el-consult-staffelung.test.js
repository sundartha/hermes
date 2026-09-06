// P2 (W2): Fristnachweis des gestaffelten Halts. Gemessen wird an HERUNTERGESETZTEN
// Fristen (stages ist Test-Override, Repo-Idiom von makeConsultDelivery/holdMs) - eine
// Messung gegen die Produktionszahlen dauerte 30 s je Fall und belegte dasselbe.
// Store-DOUBLE statt echtem Store: gemessen wird der WARTELAUF, nicht die Persistenz;
// die haengt an state-ops und hat dort ihre eigenen Faelle (P2-10/P2-11 unten).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConsultRaised, CONSULT_RESULT } from "../src/conversation/consult-raised.js";
import { CONSULT_STATUS, CONSULT_TIMEOUT_REASON, CONSULT_ANSWER } from "../src/store/defaults.js";
import * as ops from "../src/store/state-ops.js";

const STAGES = Object.freeze({ deliveryDeadlineMs: 200, ackDeadlineMs: 400, answerDeadlineMs: 900 });
const TICK_MS = 20;
const TOLERANZ_MS = 250; // ein Tick + Scheduler-Rauschen, grosszuegig gegen Last

const CALL_ID = "call_staffelung";
const CONSULT_ID = "c0"; // erste Rueckfrage der Kette (state-ops.consultIdOf)
const QUESTION = "Darf ich den Termin bestaetigen?";

// answeredAt VOR jeder Rueckfrage: isInCallConsult (state-ops) erkennt eine Rueckfrage nur
// als IN-CALL, wenn sie nach dem Abnehmen entstand - genau der Fall, den diese Datei
// misst (die EL-Rueckfrage entsteht immer waehrend eines bereits laufenden Gespraechs).
function seedActiveCall(state) {
  state.calls.push({
    id: CALL_ID,
    status: "active",
    consults: [],
    context: { key_facts: [] },
    answeredAt: new Date(0).toISOString(),
  });
}

// Der Store-Double: reine In-Memory-Operationen ueber state-ops, mit den Schreibaufrufen
// von timeOutStagedConsult mitgeschrieben (aufrufe), damit P2-7 sie ohne einen zweiten
// Lesepfad pruefen kann. zustellenNachMs setzt NUR askDeliveredAt (Stufe 0);
// quittierenNachMs setzt askDeliveredAt UND ackedAt (eine Quittung setzt voraus, dass die
// Frage angekommen ist - realistischer Client, kein zweiter Fall fuer "quittiert, nie
// zugestellt"); antwortNachMs speist eine echte Antwort ueber ops.answerConsult ein (E-3:
// eine Antwort ist implizit auch eine Quittung, unabhaengig von den beiden anderen Markern).
function storeDouble({ zustellenNachMs = null, quittierenNachMs = null, antwortNachMs = null } = {}) {
  const state = { calls: [] };
  seedActiveCall(state);
  const aufrufe = [];
  const timers = [];

  function consult() {
    const call = ops.getCall(state, CALL_ID);
    return call.consults.find((eintrag) => eintrag.id === CONSULT_ID);
  }

  if (zustellenNachMs !== null)
    timers.push(setTimeout(() => { consult().askDeliveredAt = new Date().toISOString(); }, zustellenNachMs));
  if (quittierenNachMs !== null)
    timers.push(
      setTimeout(() => {
        const eintrag = consult();
        eintrag.askDeliveredAt ||= new Date().toISOString();
        eintrag.ackedAt = new Date().toISOString();
      }, quittierenNachMs),
    );
  if (antwortNachMs !== null)
    timers.push(
      setTimeout(() => {
        ops.answerConsult(state, CALL_ID, {
          eventId: CONSULT_ID,
          facts: ["Donnerstag ab 15 Uhr passt."],
          nowMs: Date.now(),
          openMs: 999_999,
        });
      }, antwortNachMs),
    );

  const store = {
    load: () => state,
    save: () => {},
    getCall: (callId) => ops.getCall(state, callId),
    emitConsult: (callId, questions) => ops.emitConsult(state, callId, questions).call,
    advanceInCallConsult: (callId, input) => ops.advanceInCallConsult(state, callId, input).wait,
    timeOutStagedConsult: (callId, input) => {
      aufrufe.push({ consultId: input.consultId, reason: input.reason, stageMs: input.stageMs });
      return ops.timeOutStagedConsult(state, callId, input);
    },
  };
  return { state, store, aufrufe, cleanup: () => timers.forEach(clearTimeout) };
}

test("P2-1: ohne pollenden Client endet der Halt nach der Zustellfrist", async () => {
  const { store, aufrufe, cleanup } = storeDouble();
  const onConsultRaised = makeConsultRaised({ store, stages: STAGES, tickMs: TICK_MS });
  const started = Date.now();
  const result = await onConsultRaised({ callId: CALL_ID, question: QUESTION });
  const ms = Date.now() - started;
  cleanup();
  assert.equal(result.kind, CONSULT_RESULT.TIMEOUT);
  assert.equal(result.reason, CONSULT_TIMEOUT_REASON.NOT_DELIVERED);
  assert.ok(ms < STAGES.deliveryDeadlineMs + TOLERANZ_MS, `Dauer ${ms}ms zu lang`);
  assert.equal(aufrufe.length, 1, "timeOutStagedConsult genau einmal aufgerufen");
  assert.equal(aufrufe[0].stageMs, STAGES.deliveryDeadlineMs);
});

test("P2-2: zugestellt, nicht quittiert - Abbruch nach der Quittungsfrist", async () => {
  const { store, cleanup } = storeDouble({ zustellenNachMs: 50 });
  const onConsultRaised = makeConsultRaised({ store, stages: STAGES, tickMs: TICK_MS });
  const started = Date.now();
  const result = await onConsultRaised({ callId: CALL_ID, question: QUESTION });
  const ms = Date.now() - started;
  cleanup();
  assert.equal(result.reason, CONSULT_TIMEOUT_REASON.NOT_ACKED);
  assert.ok(ms >= STAGES.ackDeadlineMs && ms < STAGES.ackDeadlineMs + TOLERANZ_MS, `Dauer ${ms}ms`);
});

test("P2-3: quittiert, keine Antwort - Abbruch erst nach der Gesamtfrist", async () => {
  const { store, cleanup } = storeDouble({ quittierenNachMs: 50 });
  const onConsultRaised = makeConsultRaised({ store, stages: STAGES, tickMs: TICK_MS });
  const started = Date.now();
  const result = await onConsultRaised({ callId: CALL_ID, question: QUESTION });
  const ms = Date.now() - started;
  cleanup();
  assert.equal(result.reason, CONSULT_TIMEOUT_REASON.TIMEOUT);
  assert.ok(
    ms >= STAGES.answerDeadlineMs && ms < STAGES.answerDeadlineMs + TOLERANZ_MS,
    `Dauer ${ms}ms`,
  );
});

test("P2-4: quittiert und beantwortet - unveraendert ausgeliefert", async () => {
  const { store, aufrufe, cleanup } = storeDouble({ quittierenNachMs: 50, antwortNachMs: 600 });
  const onConsultRaised = makeConsultRaised({ store, stages: STAGES, tickMs: TICK_MS });
  const result = await onConsultRaised({ callId: CALL_ID, question: QUESTION });
  cleanup();
  assert.equal(result.kind, CONSULT_RESULT.ANSWERED);
  assert.deepEqual(result.facts, ["Donnerstag ab 15 Uhr passt."]);
  assert.equal(aufrufe.length, 0, "kein Abbruch bei einer ausgelieferten Antwort");
});

test("P2-5: Antwort OHNE Quittung innerhalb der Frist wird ausgeliefert (E-3)", async () => {
  const { store, cleanup } = storeDouble({ zustellenNachMs: 50, antwortNachMs: 300 });
  const onConsultRaised = makeConsultRaised({ store, stages: STAGES, tickMs: TICK_MS });
  const result = await onConsultRaised({ callId: CALL_ID, question: QUESTION });
  cleanup();
  assert.equal(result.kind, CONSULT_RESULT.ANSWERED);
});

test("P2-6: keine Stufe haelt laenger als die Gesamtfrist (I-7)", async () => {
  const { store, cleanup } = storeDouble({ quittierenNachMs: 50 });
  const onConsultRaised = makeConsultRaised({ store, stages: STAGES, tickMs: TICK_MS });
  const started = Date.now();
  const result = await onConsultRaised({ callId: CALL_ID, question: QUESTION });
  const ms = Date.now() - started;
  cleanup();
  assert.ok(ms <= STAGES.answerDeadlineMs + TOLERANZ_MS, `Dauer ${ms}ms ueberschreitet die Gesamtfrist`);
  assert.equal(result.reason, CONSULT_TIMEOUT_REASON.TIMEOUT);
});

test("P2-7: der Grund steht am Datensatz, nicht nur in der Antwort", async () => {
  const { store, aufrufe, cleanup } = storeDouble();
  const onConsultRaised = makeConsultRaised({ store, stages: STAGES, tickMs: TICK_MS });
  await onConsultRaised({ callId: CALL_ID, question: QUESTION });
  cleanup();
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].reason, CONSULT_TIMEOUT_REASON.NOT_DELIVERED);
  const call = store.getCall(CALL_ID);
  assert.equal(call.consults[0].timeoutReason, CONSULT_TIMEOUT_REASON.NOT_DELIVERED);
});

test("P2-8: PII-Riegel - die Frage steht in keiner Logzeile", async () => {
  const marker = "GEHEIME-MARKER-KETTE-9f3a";
  const zeilen = [];
  const original = console.log;
  console.log = (...args) => zeilen.push(args.join(" "));
  try {
    const { store, cleanup } = storeDouble();
    const onConsultRaised = makeConsultRaised({ store, stages: STAGES, tickMs: TICK_MS });
    await onConsultRaised({ callId: CALL_ID, question: `${marker} - darf ich zusagen?` });
    cleanup();
  } finally {
    console.log = original;
  }
  assert.ok(zeilen.length > 0, "es wurde ueberhaupt geloggt");
  for (const zeile of zeilen) assert.ok(!zeile.includes(marker), `Marker in Logzeile: ${zeile}`);
});

test("P2-9: Drain loest sofort auf, unabhaengig von der Stufe", async () => {
  const { store, cleanup } = storeDouble();
  const onConsultRaised = makeConsultRaised({
    store,
    isDraining: () => true,
    stages: STAGES,
    tickMs: TICK_MS,
  });
  const started = Date.now();
  const result = await onConsultRaised({ callId: CALL_ID, question: QUESTION });
  const ms = Date.now() - started;
  cleanup();
  assert.equal(result.reason, "drain");
  assert.ok(ms < STAGES.deliveryDeadlineMs, `Dauer ${ms}ms - der Drain haette sofort ausloesen muessen`);
});

// ---- P2-10/P2-11: reine Zustands-Faelle gegen state-ops (echter In-Memory-State) -------
// Der Ort des neuen Verhaltens ist state-ops, nicht der Wartelauf - ein Store-Double
// pruefte hier nur seine eigene Nachbildung, keine echte Logik.

test("P2-10: ackConsult quittiert nur eine OFFENE Rueckfrage", () => {
  const state = { calls: [] };
  seedActiveCall(state);
  ops.emitConsult(state, CALL_ID, [QUESTION]);

  const erst = ops.ackConsult(state, CALL_ID, { eventId: CONSULT_ID });
  assert.equal(erst.outcome, CONSULT_ANSWER.ACCEPTED);
  assert.equal(erst.changed, true);
  const nachErst = ops.getCall(state, CALL_ID).consults[0];
  assert.ok(nachErst.ackedAt, "ackedAt gesetzt");

  const zweit = ops.ackConsult(state, CALL_ID, { eventId: CONSULT_ID });
  assert.equal(zweit.outcome, CONSULT_ANSWER.ACCEPTED);
  assert.equal(zweit.changed, false, "idempotent - kein zweiter Schreibvorgang");

  const stateTimedOut = { calls: [] };
  seedActiveCall(stateTimedOut);
  ops.emitConsult(stateTimedOut, CALL_ID, [QUESTION]);
  const timedOutConsult = ops.getCall(stateTimedOut, CALL_ID).consults[0];
  timedOutConsult.status = CONSULT_STATUS.TIMED_OUT;
  const timedOutErgebnis = ops.ackConsult(stateTimedOut, CALL_ID, { eventId: CONSULT_ID });
  assert.equal(timedOutErgebnis.outcome, CONSULT_ANSWER.ALREADY_ANSWERED);

  const unbekannt = ops.ackConsult(state, CALL_ID, { eventId: "c99" });
  assert.equal(unbekannt.outcome, CONSULT_ANSWER.UNKNOWN_EVENT);

  const stateBeendet = { calls: [] };
  seedActiveCall(stateBeendet);
  ops.emitConsult(stateBeendet, CALL_ID, [QUESTION]);
  ops.getCall(stateBeendet, CALL_ID).status = "ended";
  const beendetErgebnis = ops.ackConsult(stateBeendet, CALL_ID, { eventId: CONSULT_ID });
  assert.equal(beendetErgebnis.outcome, CONSULT_ANSWER.CALL_ENDED);
});

test("P2-11: markConsultAskDelivered haelt den ERSTEN Zeitpunkt", () => {
  const state = { calls: [] };
  seedActiveCall(state);
  ops.emitConsult(state, CALL_ID, [QUESTION]);

  const erst = ops.markConsultAskDelivered(state, CALL_ID, CONSULT_ID);
  assert.equal(erst.changed, true);
  const consult = ops.getCall(state, CALL_ID).consults[0];
  const ersterZeitpunkt = consult.askDeliveredAt;
  assert.ok(ersterZeitpunkt);

  const zweit = ops.markConsultAskDelivered(state, CALL_ID, CONSULT_ID);
  assert.equal(zweit.changed, false, "der zweite Aufruf aendert askDeliveredAt nicht");
  assert.equal(consult.askDeliveredAt, ersterZeitpunkt);

  // B-1 (Regressionsschutz gegen die Namenskollision): deliveredAt ist seit GQ-P7 vergeben
  // und bedeutet das GEGENTEIL - markConsultAskDelivered darf es NIE beruehren.
  assert.equal(consult.deliveredAt, undefined);
});
