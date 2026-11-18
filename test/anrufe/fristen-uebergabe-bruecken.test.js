import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EL_BINDING_AFTER_ANSWER_MS,
  EL_BRIDGE_START_DEADLINE_MS,
  EL_RUECKFALL_QUELLE,
  elRueckfallUrl,
  makeInboundBridges,
} from "../../src/elevenlabs/inbound-bridges.ts";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";

const MANDANT = "t_uebergabe_bruecken";
const JETZT = Date.parse("2030-01-01T12:00:00.000Z");
const UEBERNAHME_MS = 15000;
const ANGENOMMEN_VOR_MS = 5000;

function makeAnruf(zusatz = {}) {
  return {
    id: "call_ub",
    tenantId: MANDANT,
    status: "active",
    costProfile: KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI,
    answeredAt: new Date(JETZT - ANGENOMMEN_VOR_MS).toISOString(),
    provider: "telnyx",
    twilioSid: "CA_ub",
    ...zusatz,
  };
}

function baue({ anruf = makeAnruf(), mitUngebunden = false, schreibenScheitert = false } = {}) {
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
    now: () => JETZT,
    uebernahmeMs: UEBERNAHME_MS,
  });
  return { betrieb, bruecken };
}

const tick = () => new Promise((erfuellen) => setImmediate(erfuellen));

test("Uebergabe-Frist schreiben: die aeussere Frist steht als Frist an der Anrufzeile, aeussere Restfrist plus Uebernahmezeit", async () => {
  const { betrieb, bruecken } = baue();
  bruecken.armDeadlines("call_ub");
  await tick();
  const erwartet = JETZT - ANGENOMMEN_VOR_MS + EL_BRIDGE_START_DEADLINE_MS + UEBERNAHME_MS;
  assert.deepEqual(betrieb.frist, [{ callId: "call_ub", tenantId: MANDANT, faelligAt: new Date(erwartet).toISOString() }]);
});

test("Uebergabe-Frist schreiben: die innere Frist nach Annahme steht als Frist an der Anrufzeile, jetzt plus Bindungsfrist plus Uebernahmezeit", async () => {
  const { betrieb, bruecken } = baue();
  bruecken.armBindingDeadline("call_ub");
  await tick();
  const erwartet = JETZT + EL_BINDING_AFTER_ANSWER_MS + UEBERNAHME_MS;
  assert.deepEqual(betrieb.frist, [{ callId: "call_ub", tenantId: MANDANT, faelligAt: new Date(erwartet).toISOString() }]);
});

test("Uebergabe-Frist schreiben: der Timer wird auch dann sofort armiert, wenn das Schreiben der Frist noch aussteht", () => {
  const { betrieb, bruecken } = baue();
  bruecken.armBindingDeadline("call_ub");
  assert.deepEqual(betrieb.timer, [EL_BINDING_AFTER_ANSWER_MS]);
});

test("Uebergabe-Frist schreiben: ohne Uebernahmezeit steht die Frist auf dem Timer-Zeitpunkt", async () => {
  const betrieb = { frist: [] };
  const bruecken = makeInboundBridges({
    store: { getCall: () => makeAnruf(), load: () => ({ calls: [] }), setzeUebergabeFrist: async (frist) => betrieb.frist.push(frist) },
    umleiten: () => {},
    setTimer: () => ({}),
    now: () => JETZT,
  });
  bruecken.armBindingDeadline("call_ub");
  await tick();
  assert.equal(betrieb.frist[0].faelligAt, new Date(JETZT + EL_BINDING_AFTER_ANSWER_MS).toISOString());
});

test("Uebergabe-Frist schreiben: scheitert das Schreiben, steht der Fehler mit Anruf-ID im Log und der Timer bleibt armiert", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { betrieb, bruecken } = baue({ schreibenScheitert: true });
  bruecken.armBindingDeadline("call_ub");
  await tick();
  assert.deepEqual(zeilen, ["[fristen] Uebergabe-Frist schreiben fehlgeschlagen: call_ub Error: db weg"]);
  assert.deepEqual(betrieb.timer, [EL_BINDING_AFTER_ANSWER_MS]);
});

test("Uebergabe-Frist schreiben: ein unbekannter Anruf bekommt keine Frist", async () => {
  const { betrieb, bruecken } = baue({ anruf: null });
  bruecken.armBindingDeadline("call_ub");
  await tick();
  assert.deepEqual(betrieb.frist, []);
});

test("Uebergabe durch den Lauf: ein wartender Anruf wird auf den Rueckfall-Pfad quelle=frist umgeleitet, gelesen wird die Zeile ohne Spiegel", async () => {
  const anruf = makeAnruf();
  const { betrieb, bruecken } = baue({ anruf, mitUngebunden: true });
  await bruecken.uebergabeDurchLauf("call_ub");
  assert.equal(betrieb.lesen, 1);
  assert.deepEqual(betrieb.umgeleitet, [{ call: anruf, rueckfallUrl: elRueckfallUrl({ callId: "call_ub", quelle: EL_RUECKFALL_QUELLE.FRIST }) }]);
  assert.equal(betrieb.umgeleitet[0].rueckfallUrl, "/voice/el-rueckfall?callId=call_ub&quelle=frist");
});

test("Uebergabe durch den Lauf: das Log nennt Anruf und die Frist lauf", async (t) => {
  const zeilen = [];
  t.mock.method(console, "log", (...teile) => zeilen.push(teile.join(" ")));
  const { bruecken } = baue();
  await bruecken.uebergabeDurchLauf("call_ub");
  assert.deepEqual(zeilen, ["[el-inbound] frist_abgelaufen call=call_ub frist=lauf"]);
});

test("Uebergabe durch den Lauf: ohne Ungebunden-Lesen faellt der Lauf auf den Spiegel zurueck", async () => {
  const { betrieb, bruecken } = baue();
  await bruecken.uebergabeDurchLauf("call_ub");
  assert.equal(betrieb.umgeleitet.length, 1);
});

test("Uebergabe durch den Lauf: ein gebundener, ein zurueckgefallener, ein beendeter und ein unbekannter Anruf werden nicht umgeleitet", async () => {
  for (const anruf of [
    makeAnruf({ elevenlabsConversationId: "conv_1" }),
    makeAnruf({ elFallbackAt: "2030-01-01T12:00:00.000Z" }),
    makeAnruf({ status: "completed" }),
    null,
  ]) {
    const { betrieb, bruecken } = baue({ anruf, mitUngebunden: true });
    await bruecken.uebergabeDurchLauf("call_ub");
    assert.deepEqual(betrieb.umgeleitet, []);
  }
});

test("Uebergabe durch den Lauf: ein Lesefehler wird nicht als nichts faellig verschluckt", async () => {
  const bruecken = makeInboundBridges({
    store: { getCall: () => null, load: () => ({ calls: [] }), leseCallUngebunden: async () => Promise.reject(new Error("db weg")) },
    umleiten: () => {},
    setTimer: () => ({}),
    now: () => JETZT,
  });
  await assert.rejects(() => bruecken.uebergabeDurchLauf("call_ub"), /db weg/);
});
