import assert from "node:assert/strict";
import { test } from "node:test";

const FRISTEN = "../../src/elevenlabs/inbound-fristen.ts";
const BRIDGES = "../../src/elevenlabs/inbound-bridges.ts";

const AUSSEN_MS = 30000;
const INNEN_MS = 8000;
const OFFSET_MS = 5000;
const JETZT_MS = Date.parse("2026-01-01T12:00:00.000Z");
const WARTEND = { id: "call_a", status: "active", costProfile: "telnyx_inbound_el_convai", answeredAt: new Date(JETZT_MS - OFFSET_MS).toISOString() };

const laden = async (pfad) => import(pfad).catch(() => ({}));

function baue(fristen, call) {
  const auftraege = [];
  const geloescht = new Set();
  const umleitungen = [];
  const bridges = fristen.makeInboundBridges?.({
    store: { getCall: (id) => (id === call.id ? call : null), load: () => ({ calls: [call] }) },
    umleiten: (auftrag) => umleitungen.push(auftrag),
    setTimer: (fn, ms) => {
      const auftrag = { fn, ms };
      auftraege.push(auftrag);
      return auftrag;
    },
    clearTimer: (auftrag) => geloescht.add(auftrag),
    now: () => JETZT_MS,
  });
  return { bridges, umleitungen, aktive: () => auftraege.filter((auftrag) => !geloescht.has(auftrag)) };
}

test("Umbau: die Fristwerte stehen in inbound-fristen", async () => {
  const fristen = await laden(FRISTEN);
  assert.equal(fristen.EL_BRIDGE_START_DEADLINE_MS, AUSSEN_MS);
  assert.equal(fristen.EL_BINDING_AFTER_ANSWER_MS, INNEN_MS);
});

test("Umbau: aeussereRestfristMs rechnet ab answeredAt und kappt bei 0", async () => {
  const { aeussereRestfristMs } = await laden(FRISTEN);
  const fall = (vorMs) => ({ ...WARTEND, answeredAt: new Date(JETZT_MS - vorMs).toISOString() });
  assert.equal(aeussereRestfristMs?.(fall(OFFSET_MS), JETZT_MS), AUSSEN_MS - OFFSET_MS);
  assert.equal(aeussereRestfristMs?.(fall(AUSSEN_MS + OFFSET_MS), JETZT_MS), 0);
  assert.equal(aeussereRestfristMs?.({ ...WARTEND, answeredAt: "kein-zeitpunkt" }, JETZT_MS), 0);
});

test("Umbau: elRueckfallUrl und die Quellen stehen in inbound-fristen", async () => {
  const fristen = await laden(FRISTEN);
  assert.equal(fristen.EL_RUECKFALL_PFAD, "/voice/el-rueckfall");
  assert.deepEqual({ ...fristen.EL_RUECKFALL_QUELLE }, { DIAL_ENDE: "dial_ende", FRIST: "frist" });
  assert.equal(fristen.elRueckfallUrl?.({ callId: "call_a", quelle: "frist" }), "/voice/el-rueckfall?callId=call_a&quelle=frist");
});

test("Umbau: die aeussere Frist armiert die Restfrist und leitet bei Ablauf einmal mit quelle=frist um", async () => {
  const { bridges, umleitungen, aktive } = baue(await laden(FRISTEN), WARTEND);
  bridges?.armDeadlines("call_a");
  assert.deepEqual(aktive().map((auftrag) => auftrag.ms), [AUSSEN_MS - OFFSET_MS]);
  aktive()[0].fn();
  assert.equal(umleitungen.length, 1);
  assert.equal(umleitungen[0].rueckfallUrl, "/voice/el-rueckfall?callId=call_a&quelle=frist");
});

test("Umbau: die innere Frist armiert 8 s, und clearDeadlines loescht beide", async () => {
  const { bridges, aktive } = baue(await laden(FRISTEN), WARTEND);
  bridges?.armDeadlines("call_a");
  bridges?.armBindingDeadline("call_a");
  assert.deepEqual(aktive().map((auftrag) => auftrag.ms).sort((a, b) => a - b), [INNEN_MS, AUSSEN_MS - OFFSET_MS]);
  bridges.clearDeadlines("call_a");
  assert.equal(aktive().length, 0);
});

test("Umbau: ein nicht mehr wartender Anruf wird bei Ablauf nicht umgeleitet", async () => {
  const gebunden = { ...WARTEND, elevenlabsConversationId: "conv_1" };
  const { bridges, umleitungen, aktive } = baue(await laden(FRISTEN), gebunden);
  bridges?.armBindingDeadline("call_a");
  assert.equal(aktive().length, 1);
  aktive()[0].fn();
  assert.equal(umleitungen.length, 0);
});

test("Umbau: rearmDeadlines armiert wartende Anrufe mit der Restfrist", async () => {
  const { bridges, aktive } = baue(await laden(FRISTEN), WARTEND);
  bridges?.rearmDeadlines();
  assert.deepEqual(aktive().map((auftrag) => auftrag.ms), [AUSSEN_MS - OFFSET_MS]);
});

test("Umbau: inbound-bridges reicht dieselben Fristen-Begriffe weiter", async () => {
  const [fristen, bridges] = await Promise.all([laden(FRISTEN), laden(BRIDGES)]);
  assert.equal(typeof fristen.makeInboundBridges, "function");
  for (const name of ["makeInboundBridges", "aeussereRestfristMs", "elRueckfallUrl", "EL_RUECKFALL_QUELLE", "EL_RUECKFALL_PFAD", "EL_BRIDGE_START_DEADLINE_MS", "EL_BINDING_AFTER_ANSWER_MS"]) {
    assert.equal(bridges[name], fristen[name], name);
  }
});
