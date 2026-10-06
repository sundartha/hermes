import { test } from "node:test";
import assert from "node:assert/strict";

import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import {
  EL_BINDING_AFTER_ANSWER_MS,
  EL_BRIDGE_START_DEADLINE_MS,
  EL_RUECKFALL_QUELLE,
  aeussereRestfristMs,
  elRueckfallUrl,
  makeInboundBridges,
  umleitenOderAuflegen,
} from "../src/elevenlabs/inbound-bridges.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  captureConsole,
  seedCall,
  seedState,
  startServer,
  storeOpsFacade,
  waitForLog,
} from "./helpers.js";
import { CONV_ID, INBOUND_FROM, INBOUND_TO, TRAEGER_SID, seedWartenderElCall } from "./_iel-inbound-harness.js";

const OFFSET_MS = 5000;
const FRISCH_BEANTWORTET_S = 1;
const LANGE_HER_S = 3600;
const UNLESBAR = "kein-zeitpunkt";
const BEIDE_FRISTEN = 2;

function fakeTimer() {
  const auftraege = [];
  const geloescht = new Set();
  const aktive = () => auftraege.filter((auftrag) => !geloescht.has(auftrag));
  const feuere = (auftrag) => {
    if (geloescht.has(auftrag)) return;
    geloescht.add(auftrag);
    auftrag.fn();
  };
  return {
    auftraege,
    geloescht,
    aktive,
    setTimer: (fn, ms) => {
      const auftrag = { fn, ms };
      auftraege.push(auftrag);
      return auftrag;
    },
    clearTimer: (auftrag) => geloescht.add(auftrag),
    feuereKuerzeste: () => feuere([...aktive()].sort((links, rechts) => links.ms - rechts.ms)[0]),
    feuereAlle: () => [...aktive()].sort((links, rechts) => links.ms - rechts.ms).forEach(feuere),
  };
}

function baueBruecken(state, { nowMs } = {}) {
  const timer = fakeTimer();
  const umleitungen = [];
  const bridges = makeInboundBridges({
    store: storeOpsFacade(state),
    umleiten: (auftrag) => umleitungen.push(auftrag),
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    now: () => nowMs,
  });
  return { bridges, timer, umleitungen };
}

function wartenderZustand({ answeredVorS = FRISCH_BEANTWORTET_S } = {}) {
  const state = ops.makeDefaultState();
  const call = seedWartenderElCall(state, { answeredVorS });
  return { state, call, nowMs: Date.parse(call.answeredAt) + OFFSET_MS };
}

const rueckfallUrlFuer = (callId) => `/voice/el-rueckfall?callId=${callId}&quelle=frist`;

test("IEL-B6-20: armDeadlines armiert die Restfrist ab answeredAt; Ablauf leitet genau einmal mit quelle=frist um", () => {
  const { state, call, nowMs } = wartenderZustand();
  const { bridges, timer, umleitungen } = baueBruecken(state, { nowMs });
  bridges.armDeadlines(call.id);
  assert.deepEqual(timer.aktive().map((auftrag) => auftrag.ms), [EL_BRIDGE_START_DEADLINE_MS - OFFSET_MS]);
  timer.feuereAlle();
  assert.equal(umleitungen.length, 1);
  assert.equal(umleitungen[0].call.id, call.id);
  assert.equal(umleitungen[0].rueckfallUrl, rueckfallUrlFuer(call.id));
});

test("IEL-B6-21: die innere Frist feuert zuerst, leitet einmal um, und die aeussere feuert danach nicht mehr", () => {
  const { state, call, nowMs } = wartenderZustand();
  const { bridges, timer, umleitungen } = baueBruecken(state, { nowMs });
  bridges.armDeadlines(call.id);
  bridges.armBindingDeadline(call.id);
  assert.equal(timer.aktive().length, BEIDE_FRISTEN);
  timer.feuereKuerzeste();
  assert.equal(umleitungen.length, 1);
  assert.equal(timer.aktive().length, 0, "die aeussere Frist ist geloescht");
  timer.feuereAlle();
  assert.equal(umleitungen.length, 1);
  assert.ok(timer.auftraege.some((auftrag) => auftrag.ms === EL_BINDING_AFTER_ANSWER_MS));
});

test("IEL-B6-22: clearDeadlines -> keine Umleitung", () => {
  const { state, call, nowMs } = wartenderZustand();
  const { bridges, timer, umleitungen } = baueBruecken(state, { nowMs });
  bridges.armDeadlines(call.id);
  bridges.armBindingDeadline(call.id);
  bridges.clearDeadlines(call.id);
  timer.feuereAlle();
  assert.equal(umleitungen.length, 0);
});

test("IEL-B6-23: Ablauf auf GEBUNDEN, RUECKFALL, beendetem Call oder Budget-Profil ist wirkungslos", () => {
  const zustaende = {
    gebunden: (state, call) =>
      ops.bindInboundElConversation(state, call.id, { conversationId: CONV_ID, nowIso: new Date().toISOString() }),
    rueckfall: (state, call) => ops.markInboundElFallback(state, call.id, new Date().toISOString()),
    abgebrochen: (state, call) => ops.endCallRecord(state, call.id, "cancelled"),
    beendet: (state, call) => ops.endCallRecord(state, call.id, "completed"),
    budget: (state, call) => ops.recordCostProfile(state, call.id, KOSTENPROFIL.TELNYX_INBOUND_BUDGET),
  };
  for (const [name, versetze] of Object.entries(zustaende)) {
    const { state, nowMs } = wartenderZustand();
    const call = name === "budget" ? budgetCall(state) : state.calls[0];
    const { bridges, timer, umleitungen } = baueBruecken(state, { nowMs });
    bridges.armDeadlines(call.id);
    versetze(state, call);
    timer.feuereAlle();
    assert.equal(umleitungen.length, 0, name);
  }
});

function budgetCall(state) {
  return ops.createCall(state, {
    direction: "inbound",
    from: INBOUND_FROM,
    to: INBOUND_TO,
    twilioSid: TRAEGER_SID,
    tenantId: BOOTSTRAP_TENANT_ID,
  });
}

function neustartZustand() {
  const { state, call, nowMs } = wartenderZustand();
  const gebunden = seedWartenderElCall(state, { answeredVorS: FRISCH_BEANTWORTET_S });
  ops.bindInboundElConversation(state, gebunden.id, { conversationId: CONV_ID, nowIso: new Date().toISOString() });
  const rueckfall = seedWartenderElCall(state, { answeredVorS: FRISCH_BEANTWORTET_S });
  ops.markInboundElFallback(state, rueckfall.id, new Date().toISOString());
  const budget = budgetCall(state);
  ops.recordCostProfile(state, budget.id, KOSTENPROFIL.TELNYX_INBOUND_BUDGET);
  return { state: JSON.parse(JSON.stringify(state)), call, nowMs };
}

test("IEL-B6-24a: Neustart waehrend WARTET -> rearmDeadlines armiert NUR den wartenden Call mit seiner Restfrist", async () => {
  const { state, call, nowMs } = neustartZustand();
  const { bridges, timer, umleitungen } = baueBruecken(state, { nowMs });
  const zeilen = await captureConsole(async () => bridges.rearmDeadlines());
  assert.deepEqual(timer.aktive().map((auftrag) => auftrag.ms), [EL_BRIDGE_START_DEADLINE_MS - OFFSET_MS]);
  assert.ok(zeilen.includes("[el-inbound] Fristen re-armiert: 1 Anrufe"));
  timer.feuereAlle();
  assert.deepEqual(umleitungen.map((auftrag) => auftrag.call.id), [call.id]);
});

test("IEL-B6-24b: Neustart nach abgelaufener Frist -> Verzoegerung 0, die Umleitung feuert beim naechsten Tick", () => {
  const { state, call } = wartenderZustand({ answeredVorS: LANGE_HER_S });
  const zustand = JSON.parse(JSON.stringify(state));
  const { bridges, timer, umleitungen } = baueBruecken(zustand, { nowMs: Date.now() });
  bridges.rearmDeadlines();
  assert.deepEqual(timer.aktive().map((auftrag) => auftrag.ms), [0]);
  timer.feuereAlle();
  assert.deepEqual(umleitungen.map((auftrag) => auftrag.rueckfallUrl), [rueckfallUrlFuer(call.id)]);
});

test("IEL-B6-25: unlesbares answeredAt -> Restfrist 0 (sofort umleiten, nie Stille)", () => {
  const { state, call, nowMs } = wartenderZustand();
  call.answeredAt = UNLESBAR;
  assert.equal(aeussereRestfristMs(call, nowMs), 0);
  const { bridges, timer } = baueBruecken(state, { nowMs });
  bridges.armDeadlines(call.id);
  assert.deepEqual(timer.aktive().map((auftrag) => auftrag.ms), [0]);
});

test("IEL-B6-26: EL_RUECKFALL_QUELLE und elRueckfallUrl sind gepinnt (einzige Quelle fuer B8)", () => {
  assert.deepEqual({ ...EL_RUECKFALL_QUELLE }, { DIAL_ENDE: "dial_ende", FRIST: "frist" });
  assert.equal(
    elRueckfallUrl({ callId: "call_x", quelle: EL_RUECKFALL_QUELLE.DIAL_ENDE }),
    "/voice/el-rueckfall?callId=call_x&quelle=dial_ende",
  );
});

const WIRKUNG_URL = "https://agent.test/voice/el-rueckfall?callId=call_w&quelle=frist";
const WIRKUNG_CALL = Object.freeze({ id: "call_w", provider: "telnyx", twilioSid: TRAEGER_SID });

function wirkungsAttrappe({ port, auflegenWirft = false }) {
  const aufrufe = { umgeleitet: [], aufgelegt: [] };
  const endCarrierCall = async (callId) => {
    aufrufe.aufgelegt.push(callId);
    if (auflegenWirft) throw new Error("auflegen-defekt");
  };
  const voiceControl = () => port(aufrufe);
  return { aufrufe, lauf: () => umleitenOderAuflegen({ voiceControl, endCarrierCall, call: WIRKUNG_CALL, url: WIRKUNG_URL }) };
}

test("IEL-B6-27a: Port mit redirectCall -> Umleitung mit (twilioSid, url), kein Auflegen", async () => {
  const { aufrufe, lauf } = wirkungsAttrappe({
    port: (log) => ({ redirectCall: async (sid, url) => log.umgeleitet.push([sid, url]) }),
  });
  await lauf();
  assert.deepEqual(aufrufe.umgeleitet, [[TRAEGER_SID, WIRKUNG_URL]]);
  assert.deepEqual(aufrufe.aufgelegt, []);
});

test("IEL-B6-27b: redirectCall wirft oder fehlt -> Auflegen des Traeger-Beins", async () => {
  const ports = [
    () => ({ redirectCall: async () => Promise.reject(new Error("umleitung-defekt")) }),
    () => ({ endCall: async () => {} }),
  ];
  for (const port of ports) {
    const { aufrufe, lauf } = wirkungsAttrappe({ port });
    await captureConsole(lauf);
    assert.deepEqual(aufrufe.aufgelegt, [WIRKUNG_CALL.id]);
  }
});

test("IEL-B6-27c: auch ein werfendes Auflegen laesst die Wirkung erfuellen und wird geloggt", async () => {
  const { lauf } = wirkungsAttrappe({ port: () => ({}), auflegenWirft: true });
  const zeilen = await captureConsole(async () => {
    await assert.doesNotReject(lauf());
  });
  assert.ok(zeilen.some((zeile) => zeile.startsWith(`[el-inbound] auflegen_fehlgeschlagen call=${WIRKUNG_CALL.id}`)));
});

const SPAWN_CALL_ID = "call_iel_b6_frist";
const PUFFER_MS = 5000;
const SPAWN_MAX_DAUER_S = 600;
const LOG_FRIST_MS = 8000;

function abgelaufenerSeed() {
  const answeredAt = new Date(Date.now() - EL_BRIDGE_START_DEADLINE_MS - PUFFER_MS).toISOString();
  return seedState({
    settings: { allowSummaries: false },
    calls: [
      seedCall({
        id: SPAWN_CALL_ID,
        direction: "inbound",
        provider: "telnyx",
        from: INBOUND_FROM,
        to: INBOUND_TO,
        twilioSid: TRAEGER_SID,
        answeredAt,
        startedAt: answeredAt,
        maxDurationS: SPAWN_MAX_DAUER_S,
        costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
      }),
    ],
  });
}

test("IEL-B6-28: der Boot re-armiert die abgelaufene aeussere Frist und die Wirkung laeuft ueber server.js", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      ELEVENLABS_INBOUND_ENABLED: "true",
      ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID,
      ...EL_INBOUND_ACCESS_BOOT_ENV,
    },
    seed: abgelaufenerSeed(),
  });
  try {
    await waitForLog(srv, /\[el-inbound\] Fristen re-armiert: 1 Anrufe/, LOG_FRIST_MS);
    await waitForLog(srv, new RegExp(`\\[el-inbound\\] (umgeleitet|umleitung_fehlgeschlagen) call=${SPAWN_CALL_ID}`), LOG_FRIST_MS);
  } finally {
    await srv.stop();
  }
});
