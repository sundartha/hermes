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

// P2-12/P2-13 (S1-1-Fix): benannte Alter statt Magic Numbers (G25). Die Zustellfrist ist
// dieselbe wie STAGES.deliveryDeadlineMs oben (200ms) - EINE Quelle statt einer zweiten,
// zufaellig gleichen Zahl. ALIVE liegt darunter (fuer SICH selbst noch nicht abgelaufen),
// EXPIRED darueber.
const P2_STAGE_MS = STAGES.deliveryDeadlineMs;
const ALT_ALIVE_AGE_MS = 150;
const JUNG_ALIVE_AGE_MS = 50;
const EXPIRED_AGE_MS = 250;

// P2-12 (S1-1-Fix, Review Runde 1): ZWEI GLEICHZEITIG OFFENE In-Call-Consults
// (MAX_OPEN_POLLS_PER_CALL=2, consult/delivery.js) mit je EIGENER, unabhaengiger Stufe.
// Vorher waehlte timeOutStagedConsult den zu schliessenden Datensatz ueber
// advanceInCallConsult, das den ERSTEN offenen Consult in ARRAY-REIHENFOLGE nimmt - nicht
// ueber die uebergebene consultId. Bei zwei offenen Consults traf das nicht zuverlaessig
// den Consult, dessen EIGENE Stufe gerade abgelaufen ist: der aeltere, noch lebendige
// Consult (c0) wurde angefasst (held:true), waehrend der juengere Ziel-Consult (c1),
// dessen Zustellfrist tatsaechlich gerissen ist, unveraendert OPEN blieb, OHNE
// timeoutReason - waehrend awaitAnswer dem Anbieter trotzdem bedingungslos "timed out"
// zurueckgab (Phantom-Datensatz, E-2, s. state-ops.js:timeOutStagedConsult).
test("P2-12: bei zwei offenen In-Call-Consults schliesst timeOutStagedConsult GENAU den per consultId benannten, nicht den ersten im Array", () => {
  const state = { calls: [] };
  seedActiveCall(state);
  const call = ops.getCall(state, CALL_ID);
  const now = Date.now();
  // c0 (aelter): 150ms alt - unter der Zustellfrist (200ms) von c1, also fuer SICH selbst
  // noch nicht abgelaufen. Reihenfolge im Array bewusst zuerst (der bisherige Bug waehlte
  // genau dieses Element).
  call.consults.push({
    id: "c0",
    seq: 0,
    questions: ["Frage A"],
    status: CONSULT_STATUS.OPEN,
    askedAt: new Date(now - ALT_ALIVE_AGE_MS).toISOString(),
    answeredAt: null,
    answeredFacts: 0,
  });
  // c1 (juenger, das eigentliche Ziel dieses Aufrufs): ueber der Zustellfrist alt, also
  // fuer sich selbst abgelaufen.
  call.consults.push({
    id: "c1",
    seq: 1,
    questions: ["Frage B"],
    status: CONSULT_STATUS.OPEN,
    askedAt: new Date(now - EXPIRED_AGE_MS).toISOString(),
    answeredAt: null,
    answeredFacts: 0,
  });

  const ergebnis = ops.timeOutStagedConsult(state, CALL_ID, {
    consultId: "c1",
    reason: CONSULT_TIMEOUT_REASON.NOT_DELIVERED,
    nowMs: now,
    stageMs: P2_STAGE_MS,
  });

  const c0 = ops.getCall(state, CALL_ID).consults.find((entry) => entry.id === "c0");
  const c1 = ops.getCall(state, CALL_ID).consults.find((entry) => entry.id === "c1");

  assert.equal(ergebnis.changed, true);
  assert.equal(c1.status, CONSULT_STATUS.TIMED_OUT, "der benannte Consult c1 schliesst");
  assert.equal(c1.timeoutReason, CONSULT_TIMEOUT_REASON.NOT_DELIVERED);
  assert.equal(c0.status, CONSULT_STATUS.OPEN, "der NICHT benannte Consult c0 bleibt offen");
  assert.equal(c0.held, undefined, "c0 bleibt UNVERAENDERT - kein Seiteneffekt auf dem falschen Datensatz");
});

// Gegenprobe: derselbe Aufbau, aber consultId zeigt auf den AELTEREN (c0) - der jetzt
// selbst seine eigene (kuerzere) Frist gerissen hat, waehrend der juengere (c1) noch
// lebt. Ohne den Fix waere das Ergebnis in beide Richtungen falsch moeglich, je nach
// Array-Position - dieser Fall deckt die andere Reihenfolge ab.
test("P2-13: dieselbe Lage umgekehrt im Array - der juengere steht an Array-Position 0, das Ziel (aelterer) trotzdem korrekt getroffen", () => {
  const state = { calls: [] };
  seedActiveCall(state);
  const call = ops.getCall(state, CALL_ID);
  const now = Date.now();
  // Array-Position 0: der JUENGERE (50ms, fuer sich selbst noch nicht abgelaufen) -
  // genau die Position, die der bisherige Bug (Array-Reihenfolge statt consultId)
  // gegriffen haette.
  call.consults.push({
    id: "c1",
    seq: 1,
    questions: ["Frage B"],
    status: CONSULT_STATUS.OPEN,
    askedAt: new Date(now - JUNG_ALIVE_AGE_MS).toISOString(),
    answeredAt: null,
    answeredFacts: 0,
  });
  // Array-Position 1: der AELTERE (ueber der Zustellfrist) - das eigentliche Ziel.
  call.consults.push({
    id: "c0",
    seq: 0,
    questions: ["Frage A"],
    status: CONSULT_STATUS.OPEN,
    askedAt: new Date(now - EXPIRED_AGE_MS).toISOString(),
    answeredAt: null,
    answeredFacts: 0,
  });

  const ergebnis = ops.timeOutStagedConsult(state, CALL_ID, {
    consultId: "c0",
    reason: CONSULT_TIMEOUT_REASON.NOT_DELIVERED,
    nowMs: now,
    stageMs: P2_STAGE_MS,
  });

  const c0 = ops.getCall(state, CALL_ID).consults.find((entry) => entry.id === "c0");
  const c1 = ops.getCall(state, CALL_ID).consults.find((entry) => entry.id === "c1");

  assert.equal(ergebnis.changed, true);
  assert.equal(c0.status, CONSULT_STATUS.TIMED_OUT, "das benannte Ziel c0 schliesst, trotz Array-Position 1");
  assert.equal(c0.timeoutReason, CONSULT_TIMEOUT_REASON.NOT_DELIVERED);
  assert.equal(c1.status, CONSULT_STATUS.OPEN, "c1 bleibt offen, obwohl es an Array-Position 0 steht");
  assert.equal(c1.held, undefined);
});
