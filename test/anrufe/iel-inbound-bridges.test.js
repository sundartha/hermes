import { test } from "node:test";
import assert from "node:assert/strict";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import {
  EL_BINDING_AFTER_ANSWER_MS,
  EL_BRIDGE_START_DEADLINE_MS,
  EL_RUECKFALL_QUELLE,
  aeussereRestfristMs,
  elRueckfallUrl,
  makeInboundBridges,
  umleitenOderAuflegen,
} from "../../src/elevenlabs/inbound-bridges.ts";
import * as ops from "../../src/store/state-ops.js";
import { makeFristenLauf } from "../../src/telephony/fristen-lauf.ts";
import { hangUpAction } from "../../src/telephony/call-termination.ts";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  captureConsole,
  seedCall,
  seedState,
  startServer,
  storeOpsFacade,
  waitForLog,
} from "../helpers.js";
import { CONV_ID, INBOUND_FROM, INBOUND_TO, TRAEGER_SID, seedWartenderElCall } from "../_iel-inbound-harness.js";

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

const FEHLERTEXT_CALL = { id: "call_fehlertext", provider: "telnyx", twilioSid: "sid_fehlertext" };
const FEHLERTEXT_URL = "https://example.test/voice/el-rueckfall";

test("IEL-B6-27d: Umleitung gescheitert - die Logzeile nennt den Fehlertext der Umleitung", async () => {
  const zeilen = await captureConsole(() =>
    umleitenOderAuflegen({
      voiceControl: () => ({ redirectCall: () => Promise.reject(new Error("umleitung-defekt")) }),
      endCarrierCall: async () => {},
      call: FEHLERTEXT_CALL,
      url: FEHLERTEXT_URL,
    }),
  );
  assert.ok(zeilen.includes("[el-inbound] umleitung_fehlgeschlagen call=call_fehlertext: umleitung-defekt"));
});

test("IEL-B6-27e: Auflegen gescheitert - die Logzeile nennt den Fehlertext des Auflegens", async () => {
  const zeilen = await captureConsole(() =>
    umleitenOderAuflegen({
      voiceControl: () => ({}),
      endCarrierCall: () => Promise.reject(new Error("auflegen-defekt")),
      call: FEHLERTEXT_CALL,
      url: FEHLERTEXT_URL,
    }),
  );
  assert.ok(zeilen.includes("[el-inbound] auflegen_fehlgeschlagen call=call_fehlertext: auflegen-defekt"));
});

test("IEL-B6-27f: Umleitung lehnt mit null ab - das Trägerbein wird trotzdem aufgelegt, nichts wirft", async () => {
  const aufgelegt = [];
  await captureConsole(async () => {
    await assert.doesNotReject(
      umleitenOderAuflegen({
        voiceControl: () => ({ redirectCall: () => Promise.reject(null) }),
        endCarrierCall: async (callId) => {
          aufgelegt.push(callId);
        },
        call: FEHLERTEXT_CALL,
        url: FEHLERTEXT_URL,
      }),
    );
  });
  assert.deepEqual(aufgelegt, ["call_fehlertext"]);
});

test("IEL-B6-24c: Neustart ohne wartenden Call -> kein Timer und keine Logzeile ueber re-armierte Fristen", async () => {
  const { bridges, timer } = baueBruecken(ops.makeDefaultState(), { nowMs: Date.now() });
  const zeilen = await captureConsole(async () => bridges.rearmDeadlines());
  assert.deepEqual(timer.aktive(), []);
  assert.deepEqual(zeilen, []);
});

const FRISCH_ABLAGE_S = 1;

function baueBrueckenMitAblage({ lesen, state }) {
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

function ablageZustand() {
  const state = ops.makeDefaultState();
  const call = seedWartenderElCall(state, { answeredVorS: FRISCH_ABLAGE_S });
  return { state, call };
}

const naechsterTakt = () => new Promise((fertig) => setImmediate(fertig));

test("Ablage-Lesung 1: armDeadlines liest den Anruf aus der Ablage, auch wenn getCall ihn nicht kennt", async () => {
  const { state, call } = ablageZustand();
  const { bridges, auftraege } = baueBrueckenMitAblage({ state, lesen: async (id) => (id === call.id ? call : null) });
  bridges.armDeadlines(call.id);
  await naechsterTakt();
  assert.deepEqual(auftraege.map((auftrag) => auftrag.ms), [EL_BRIDGE_START_DEADLINE_MS - OFFSET_MS]);
});

test("Ablage-Lesung 2: armDeadlines armiert nichts, wenn die Ablage den Anruf nicht kennt", async () => {
  const { state, call } = ablageZustand();
  const { bridges, auftraege } = baueBrueckenMitAblage({ state, lesen: async () => null });
  bridges.armDeadlines(call.id);
  await naechsterTakt();
  assert.deepEqual(auftraege, []);
});

test("Ablage-Lesung 3: der Fristablauf leitet nach der Ablage-Lesung genau einmal in den Rueckfall um", async () => {
  const { state, call } = ablageZustand();
  const { bridges, auftraege, umleitungen } = baueBrueckenMitAblage({ state, lesen: async () => call });
  bridges.armBindingDeadline(call.id);
  auftraege[0].fn();
  await naechsterTakt();
  assert.equal(umleitungen.length, 1);
  assert.equal(umleitungen[0].call.id, call.id);
});

test("Ablage-Lesung 4: der Fristablauf leitet nicht um, wenn die Ablage den Anruf beendet zeigt", async () => {
  const { state, call } = ablageZustand();
  const { bridges, auftraege, umleitungen } = baueBrueckenMitAblage({ state, lesen: async () => ({ ...call, status: "completed" }) });
  bridges.armBindingDeadline(call.id);
  auftraege[0].fn();
  await naechsterTakt();
  assert.deepEqual(umleitungen, []);
});

test("Ablage-Lesung 5: scheitert die Ablage-Lesung beim Fristablauf, bleibt die Umleitung aus und nichts wirft", async () => {
  const { state, call } = ablageZustand();
  const { bridges, auftraege, umleitungen } = baueBrueckenMitAblage({
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

const UB_MANDANT = "t_uebergabe_bruecken";
const UB_JETZT = Date.parse("2030-01-01T12:00:00.000Z");
const UB_UEBERNAHME_MS = 15000;
const UB_ANGENOMMEN_VOR_MS = 5000;

function ubAnruf(zusatz = {}) {
  return {
    id: "call_ub",
    tenantId: UB_MANDANT,
    status: "active",
    costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
    answeredAt: new Date(UB_JETZT - UB_ANGENOMMEN_VOR_MS).toISOString(),
    provider: "telnyx",
    twilioSid: "CA_ub",
    ...zusatz,
  };
}

function ubBaue({ anruf = ubAnruf(), mitUngebunden = false, schreibenScheitert = false } = {}) {
  const betrieb = { frist: [], umgeleitet: [], timer: [], lesen: 0 };
  const store = {
    getCall: () => anruf,
    load: () => ({ calls: [anruf] }),
    setzeUebergabeFrist: async (frist) => {
      if (schreibenScheitert) throw new Error("db weg");
      betrieb.frist.push(frist);
    },
  };
  if (mitUngebunden)
    store.leseCallUngebunden = async () => {
      betrieb.lesen += 1;
      return anruf;
    };
  const bruecken = makeInboundBridges({
    store,
    umleiten: (auftrag) => betrieb.umgeleitet.push(auftrag),
    setTimer: (fn, ms) => betrieb.timer.push(ms) && { fn },
    clearTimer: () => {},
    now: () => UB_JETZT,
    uebernahmeMs: UB_UEBERNAHME_MS,
  });
  return { betrieb, bruecken };
}

const ubTick = () => new Promise((erfuellen) => setImmediate(erfuellen));

test("Uebergabe-Frist schreiben: die aeussere Frist steht als Frist an der Anrufzeile, aeussere Restfrist plus Uebernahmezeit", async () => {
  const { betrieb, bruecken } = ubBaue();
  bruecken.armDeadlines("call_ub");
  await ubTick();
  const erwartet = UB_JETZT - UB_ANGENOMMEN_VOR_MS + EL_BRIDGE_START_DEADLINE_MS + UB_UEBERNAHME_MS;
  assert.deepEqual(betrieb.frist, [{ callId: "call_ub", tenantId: UB_MANDANT, faelligAt: new Date(erwartet).toISOString() }]);
});

test("Uebergabe-Frist schreiben: die innere Frist nach Annahme steht als Frist an der Anrufzeile, jetzt plus Bindungsfrist plus Uebernahmezeit", async () => {
  const { betrieb, bruecken } = ubBaue();
  bruecken.armBindingDeadline("call_ub");
  await ubTick();
  const erwartet = UB_JETZT + EL_BINDING_AFTER_ANSWER_MS + UB_UEBERNAHME_MS;
  assert.deepEqual(betrieb.frist, [{ callId: "call_ub", tenantId: UB_MANDANT, faelligAt: new Date(erwartet).toISOString() }]);
});

test("Uebergabe-Frist schreiben: der Timer wird auch dann sofort armiert, wenn das Schreiben der Frist noch aussteht", () => {
  const { betrieb, bruecken } = ubBaue();
  bruecken.armBindingDeadline("call_ub");
  assert.deepEqual(betrieb.timer, [EL_BINDING_AFTER_ANSWER_MS]);
});

test("Uebergabe-Frist schreiben: ohne Uebernahmezeit steht die Frist auf dem Timer-Zeitpunkt", async () => {
  const betrieb = { frist: [] };
  const bruecken = makeInboundBridges({
    store: { getCall: () => ubAnruf(), load: () => ({ calls: [] }), setzeUebergabeFrist: async (frist) => betrieb.frist.push(frist) },
    umleiten: () => {},
    setTimer: () => ({}),
    now: () => UB_JETZT,
  });
  bruecken.armBindingDeadline("call_ub");
  await ubTick();
  assert.equal(betrieb.frist[0].faelligAt, new Date(UB_JETZT + EL_BINDING_AFTER_ANSWER_MS).toISOString());
});

test("Uebergabe-Frist schreiben: scheitert das Schreiben, steht der Fehler mit Anruf-ID im Log und der Timer bleibt armiert", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { betrieb, bruecken } = ubBaue({ schreibenScheitert: true });
  bruecken.armBindingDeadline("call_ub");
  await ubTick();
  assert.deepEqual(zeilen, ["[fristen] Uebergabe-Frist schreiben fehlgeschlagen: call_ub Error: db weg"]);
  assert.deepEqual(betrieb.timer, [EL_BINDING_AFTER_ANSWER_MS]);
});

test("Uebergabe-Frist schreiben: ein unbekannter Anruf bekommt keine Frist", async () => {
  const { betrieb, bruecken } = ubBaue({ anruf: null });
  bruecken.armBindingDeadline("call_ub");
  await ubTick();
  assert.deepEqual(betrieb.frist, []);
});

test("Uebergabe durch den Lauf: ein wartender Anruf wird auf den Rueckfall-Pfad quelle=frist umgeleitet, gelesen wird die Zeile ohne Spiegel", async () => {
  const anruf = ubAnruf();
  const { betrieb, bruecken } = ubBaue({ anruf, mitUngebunden: true });
  await bruecken.uebergabeDurchLauf("call_ub");
  assert.equal(betrieb.lesen, 1);
  assert.deepEqual(betrieb.umgeleitet, [{ call: anruf, rueckfallUrl: elRueckfallUrl({ callId: "call_ub", quelle: EL_RUECKFALL_QUELLE.FRIST }) }]);
  assert.equal(betrieb.umgeleitet[0].rueckfallUrl, "/voice/el-rueckfall?callId=call_ub&quelle=frist");
});

test("Uebergabe durch den Lauf: das Log nennt Anruf und die Frist lauf", async (t) => {
  const zeilen = [];
  t.mock.method(console, "log", (...teile) => zeilen.push(teile.join(" ")));
  const { bruecken } = ubBaue();
  await bruecken.uebergabeDurchLauf("call_ub");
  assert.deepEqual(zeilen, ["[el-inbound] frist_abgelaufen call=call_ub frist=lauf"]);
});

test("Uebergabe durch den Lauf: ohne Ungebunden-Lesen faellt der Lauf auf den Spiegel zurueck", async () => {
  const { betrieb, bruecken } = ubBaue();
  await bruecken.uebergabeDurchLauf("call_ub");
  assert.equal(betrieb.umgeleitet.length, 1);
});

test("Uebergabe durch den Lauf: ein gebundener, ein zurueckgefallener, ein beendeter und ein unbekannter Anruf werden nicht umgeleitet", async () => {
  for (const anruf of [
    ubAnruf({ elevenlabsConversationId: "conv_1" }),
    ubAnruf({ elFallbackAt: "2030-01-01T12:00:00.000Z" }),
    ubAnruf({ status: "completed" }),
    null,
  ]) {
    const { betrieb, bruecken } = ubBaue({ anruf, mitUngebunden: true });
    await bruecken.uebergabeDurchLauf("call_ub");
    assert.deepEqual(betrieb.umgeleitet, []);
  }
});

test("Uebergabe durch den Lauf: ein Lesefehler wird nicht als nichts faellig verschluckt", async () => {
  const bruecken = makeInboundBridges({
    store: { getCall: () => null, load: () => ({ calls: [] }), leseCallUngebunden: async () => Promise.reject(new Error("db weg")) },
    umleiten: () => {},
    setTimer: () => ({}),
    now: () => UB_JETZT,
  });
  await assert.rejects(() => bruecken.uebergabeDurchLauf("call_ub"), /db weg/);
});

function ubFremderLauf({ auflegenWirft }) {
  const zeile = ubAnruf({ id: "call_fremd", twilioSid: "CA_gelesen_fremd" });
  const beobachtung = { aufgelegt: [], frist: [], fehler: [] };
  const voiceControl = () => ({
    redirectCall: () => Promise.reject(new Error("umleitung-defekt")),
    endCall: async (sid) => {
      beobachtung.aufgelegt.push(sid);
      if (auflegenWirft) throw new Error("auflegen-defekt");
    },
  });
  const store = {
    getCall: () => undefined,
    load: () => ({ calls: [] }),
    leseCallUngebunden: async () => zeile,
  };
  const endCarrierCall = (callId, gelesen) => {
    const call = store.getCall(callId) ?? gelesen;
    const auflegen = call ? hangUpAction(voiceControl, call, call.twilioSid) : null;
    return auflegen?.();
  };
  const bruecken = makeInboundBridges({
    store,
    now: () => UB_JETZT,
    setTimer: () => ({}),
    umleiten: ({ call, rueckfallUrl }) =>
      umleitenOderAuflegen({ voiceControl, endCarrierCall, call, url: `https://agent.test${rueckfallUrl}` }),
  });
  const lauf = makeFristenLauf({
    store: {
      faelligeFristen: async () => [{ callId: "call_fremd", tenantId: UB_MANDANT, versuche: 1 }],
      setzeUebergabeFrist: async (frist) => beobachtung.frist.push(frist),
    },
    beende: async () => {},
    limitJeMandant: 10,
    leaseMs: 1000,
    uebergabe: { umleiten: bruecken.uebergabeDurchLauf },
  });
  return { beobachtung, lauf };
}

async function ubFehlerzeilen(fn) {
  const zeilen = [];
  const original = console.error;
  console.error = (...a) => zeilen.push(a.map(String).join(" "));
  try {
    await captureConsole(fn);
  } finally {
    console.error = original;
  }
  return zeilen.filter((zeile) => zeile.startsWith("[fristen]"));
}

test("Uebergabe durch den Lauf eines fremden Prozesses: scheitert die Umleitung, legt der Lauf ueber die gelesene Zeile auf", async () => {
  const { beobachtung, lauf } = ubFremderLauf({ auflegenWirft: false });
  let ergebnis;
  await ubFehlerzeilen(async () => {
    ergebnis = await lauf.uebergabeTakt();
  });
  assert.deepEqual(beobachtung.aufgelegt, ["CA_gelesen_fremd"]);
  assert.deepEqual(ergebnis, { beendet: 0, offen: 0, gelesen: true });
});

test("Uebergabe durch den Lauf: scheitern Umleitung und Auflegen, bleibt die Uebergabe-Frist stehen und der naechste Takt versucht es erneut", async () => {
  const { beobachtung, lauf } = ubFremderLauf({ auflegenWirft: true });
  let ergebnis;
  const zeilen = await ubFehlerzeilen(async () => {
    ergebnis = await lauf.uebergabeTakt();
  });
  assert.deepEqual(beobachtung.frist, []);
  assert.equal(ergebnis.offen, 1);
  assert.ok(zeilen.some((zeile) => zeile.startsWith("[fristen] Uebergabe umleiten fehlgeschlagen: call_fremd")));
});

test("umleitenOderAuflegen meldet true bei Umleitung und bei Auflegen als Ersatz, false wenn auch das Auflegen scheitert", async () => {
  const call = { id: "call_rueck", provider: "telnyx", twilioSid: "sid_rueck" };
  const url = "https://agent.test/voice/el-rueckfall";
  const geht = { redirectCall: async () => {} };
  const kaputt = { redirectCall: () => Promise.reject(new Error("x")) };
  const ergebnis = [];
  await captureConsole(async () => {
    ergebnis.push(await umleitenOderAuflegen({ voiceControl: () => geht, endCarrierCall: async () => {}, call, url }));
    ergebnis.push(await umleitenOderAuflegen({ voiceControl: () => kaputt, endCarrierCall: async () => {}, call, url }));
    ergebnis.push(await umleitenOderAuflegen({ voiceControl: () => kaputt, endCarrierCall: () => Promise.reject(new Error("y")), call, url }));
  });
  assert.deepEqual(ergebnis, [true, true, false]);
});
