import { test } from "node:test";
import assert from "node:assert/strict";

import { EL_BRIDGE_START_DEADLINE_MS, makeInboundBridges } from "../../src/elevenlabs/inbound-bridges.ts";
import * as ops from "../../src/store/state-ops.js";
import { seedWartenderElCall } from "../_iel-inbound-harness.js";

const OFFSET_MS = 5000;
const FRISCH_BEANTWORTET_S = 1;

function bauen({ lesen, state }) {
  const auftraege = [];
  const umleitungen = [];
  const bridges = makeInboundBridges({
    store: { getCall: () => null, leseCallUngebunden: lesen, load: () => state },
    umleiten: (auftrag) => umleitungen.push(auftrag),
    setTimer: (fn, ms) => {
      const auftrag = { fn, ms };
      auftraege.push(auftrag);
      return auftrag;
    },
    clearTimer: () => {},
    now: () => Date.parse(state.calls[0].answeredAt) + OFFSET_MS,
  });
  return { bridges, auftraege, umleitungen };
}

function zustand() {
  const state = ops.makeDefaultState();
  const call = seedWartenderElCall(state, { answeredVorS: FRISCH_BEANTWORTET_S });
  return { state, call };
}

const naechsterTakt = () => new Promise((fertig) => setImmediate(fertig));

test("Ablage-Lesung 1: armDeadlines liest den Anruf aus der Ablage, auch wenn getCall ihn nicht kennt", async () => {
  const { state, call } = zustand();
  const { bridges, auftraege } = bauen({ state, lesen: async (id) => (id === call.id ? call : null) });
  bridges.armDeadlines(call.id);
  await naechsterTakt();
  assert.deepEqual(auftraege.map((auftrag) => auftrag.ms), [EL_BRIDGE_START_DEADLINE_MS - OFFSET_MS]);
});

test("Ablage-Lesung 2: armDeadlines armiert nichts, wenn die Ablage den Anruf nicht kennt", async () => {
  const { state, call } = zustand();
  const { bridges, auftraege } = bauen({ state, lesen: async () => null });
  bridges.armDeadlines(call.id);
  await naechsterTakt();
  assert.deepEqual(auftraege, []);
});

test("Ablage-Lesung 3: der Fristablauf leitet nach der Ablage-Lesung genau einmal in den Rueckfall um", async () => {
  const { state, call } = zustand();
  const { bridges, auftraege, umleitungen } = bauen({ state, lesen: async () => call });
  bridges.armBindingDeadline(call.id);
  auftraege[0].fn();
  await naechsterTakt();
  assert.equal(umleitungen.length, 1);
  assert.equal(umleitungen[0].call.id, call.id);
});

test("Ablage-Lesung 4: der Fristablauf leitet nicht um, wenn die Ablage den Anruf beendet zeigt", async () => {
  const { state, call } = zustand();
  const { bridges, auftraege, umleitungen } = bauen({ state, lesen: async () => ({ ...call, status: "completed" }) });
  bridges.armBindingDeadline(call.id);
  auftraege[0].fn();
  await naechsterTakt();
  assert.deepEqual(umleitungen, []);
});

test("Ablage-Lesung 5: scheitert die Ablage-Lesung beim Fristablauf, bleibt die Umleitung aus und nichts wirft", async () => {
  const { state, call } = zustand();
  const { bridges, auftraege, umleitungen } = bauen({
    state,
    lesen: async () => {
      throw new Error("Ablage nicht erreichbar");
    },
  });
  bridges.armBindingDeadline(call.id);
  auftraege[0].fn();
  await naechsterTakt();
  assert.deepEqual(umleitungen, []);
});
