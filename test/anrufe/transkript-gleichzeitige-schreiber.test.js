import assert from "node:assert/strict";
import { test } from "node:test";

import { CONVERSATION_DONE_WITH_ANALYSIS } from "../fixtures/elevenlabs-conversations.js";
import { seedCall, seedState, waitUntil } from "../helpers.js";
import {
  CONV_ID,
  RUHE_TAKTE,
  WARTE,
  baueElMitStore,
  baueStore,
  isoVor,
  makeAnbieter,
  mitAnbieter,
  okAntwort,
  ruhe,
} from "../_iel-inbound-harness.js";

const ZEILEN = [
  { role: "agent", message: "Guten Tag." },
  { role: "user", message: "Hallo." },
  { role: "agent", message: "Wie geht es Ihnen?" },
];

const gespraech = (anzahl, zusatz = {}) => ({
  ...CONVERSATION_DONE_WITH_ANALYSIS,
  conversation_id: CONV_ID,
  status: "in-progress",
  transcript: ZEILEN.slice(0, anzahl),
  analysis: null,
  metadata: { call_duration_secs: 3, ...zusatz },
});

function baueAsyncEl(state, { gesperrt }) {
  let sperre = gesperrt;
  const beobachtung = { detektorZaehlungen: [] };
  const basis = baueStore(state, beobachtung);
  const schreibversuche = [];
  const offene = [];
  const belege = [];
  const store = {
    ...basis,
    recordCallCostEvidence: (beleg) => {
      belege.push(beleg);
    },
    addTranscript: async (callId, role, text) => {
      schreibversuche.push(text);
      if (sperre) await new Promise((freigeben) => offene.push(freigeben));
      return basis.addTranscript(callId, role, text);
    },
  };
  const el = baueElMitStore(store);
  const gibFreiBis = async (ergebnis) => {
    let fertig = false;
    ergebnis.then(() => {
      fertig = true;
    });
    while (!fertig) {
      offene.shift()?.();
      await ruhe(1);
    }
    await ergebnis;
  };
  const sperreAuf = () => {
    sperre = false;
    for (const freigeben of offene.splice(0)) freigeben();
  };
  return { el, schreibversuche, belege, gibFreiBis, sperreAuf };
}

const elBeleg = (belege) => belege.find((beleg) => beleg.quelle === "elevenlabs_conversation");

function seedLaufenden(zusatz = {}) {
  const anker = isoVor(3);
  const call = seedCall({
    id: "call_async_schreiber",
    answeredAt: anker,
    startedAt: anker,
    elevenlabsConversationId: CONV_ID,
    ...zusatz,
  });
  return { call, state: seedState({ calls: [call] }) };
}

function gespeichert(state, call) {
  const { transcript } = state.calls.find((eintrag) => eintrag.id === call.id);
  return transcript.map((zeile) => zeile.text);
}

test("transkript-gleichzeitige-schreiber: zwei gleichzeitige Abrufe schreiben die Zeilen eines Anrufs nacheinander und je einmal", async () => {
  const { call, state } = seedLaufenden();
  const anbieter = makeAnbieter(async () => okAntwort(gespraech(2)));
  const { el, schreibversuche, gibFreiBis, sperreAuf } = baueAsyncEl(state, { gesperrt: true });
  await mitAnbieter({ state, anbieter }, async () => {
    try {
      const beide = Promise.all([el.endActiveCall(call.id), el.endActiveCall(call.id)]);
      await waitUntil(() => schreibversuche.length >= 1, WARTE);
      await ruhe(RUHE_TAKTE);
      assert.deepEqual(schreibversuche, ["Guten Tag."]);
      await gibFreiBis(beide);
    } finally {
      sperreAuf();
    }
  });
  assert.deepEqual(gespeichert(state, call), ["Guten Tag.", "Hallo."]);
  assert.deepEqual(schreibversuche, ["Guten Tag.", "Hallo."]);
});

test("transkript-gleichzeitige-schreiber: ein dritter Abruf wartet auf den zweiten, auch wenn der erste schon fertig ist", async () => {
  const { call, state } = seedLaufenden();
  const anbieter = makeAnbieter(async () => okAntwort(gespraech(2)));
  const { el, schreibversuche, gibFreiBis, sperreAuf } = baueAsyncEl(state, { gesperrt: true });
  await mitAnbieter({ state, anbieter }, async () => {
    try {
      const erster = el.endActiveCall(call.id);
      await waitUntil(() => schreibversuche.length >= 1, WARTE);
      anbieter.setzeAntwort(async () => okAntwort(gespraech(3)));
      const zweiter = el.endActiveCall(call.id);
      await gibFreiBis(erster);
      await waitUntil(() => schreibversuche.length >= 3, WARTE);
      const dritter = el.endActiveCall(call.id);
      await ruhe(RUHE_TAKTE);
      assert.deepEqual(schreibversuche, ["Guten Tag.", "Hallo.", "Wie geht es Ihnen?"]);
      await gibFreiBis(Promise.all([zweiter, dritter]));
    } finally {
      sperreAuf();
    }
  });
  assert.deepEqual(gespeichert(state, call), ["Guten Tag.", "Hallo.", "Wie geht es Ihnen?"]);
});

test("transkript-gleichzeitige-schreiber: das Ergebnis eines eingehenden Anrufs wird als nachreifbarer Kostenbeleg gespeichert", async () => {
  const { call, state } = seedLaufenden();
  const fertig = {
    ...gespraech(2, { cost_fiat: 0.5 }),
    status: "done",
    analysis: CONVERSATION_DONE_WITH_ANALYSIS.analysis,
  };
  const anbieter = makeAnbieter(async () => okAntwort(fertig));
  const { el, belege } = baueAsyncEl(state, { gesperrt: false });
  await mitAnbieter({ state, anbieter }, () => el.awaitAndPersistInboundElResult(call.id));
  assert.deepEqual(gespeichert(state, call), ["Guten Tag.", "Hallo."]);
  assert.equal(elBeleg(belege).nachreifbar, true);
});

test("transkript-gleichzeitige-schreiber: beim Beenden eines Anrufs wird das Gespraech gespeichert und der Kostenbeleg ist nicht nachreifbar", async () => {
  const { call, state } = seedLaufenden();
  const anbieter = makeAnbieter(async () => okAntwort(gespraech(2, { cost_fiat: 0.5 })));
  const { el, belege } = baueAsyncEl(state, { gesperrt: false });
  await mitAnbieter({ state, anbieter }, () => el.endActiveCall(call.id));
  assert.deepEqual(gespeichert(state, call), ["Guten Tag.", "Hallo."]);
  assert.equal(elBeleg(belege).nachreifbar, false);
});
