import assert from "node:assert/strict";
import { test } from "node:test";

import { ANRUFSTART_AUSGANG, makeAnrufstartAuftrag } from "../../src/elevenlabs/anrufstart-auftrag.ts";
import { makeAnrufstartMarker } from "../../src/store.js";

const ANGELEGT_MS = Date.parse("2026-11-17T10:00:00.000Z");
const WARTEFRIST_MS = 120 * 1000;
const CALL_ID = "call_frist_vor_platz";

function aufbau(jetzt) {
  const spur = [];
  const call = { id: CALL_ID, tenantId: "t_frist", to: "+4915112340077", status: "active", startedAt: new Date(ANGELEGT_MS).toISOString() };
  const marker = makeAnrufstartMarker();
  const auftrag = makeAnrufstartAuftrag({
    store: { leseCall: async () => call, load: () => ({ calls: [call] }), anderesAnrufMitKonversation: async () => false, anrufstartMarker: marker },
    starte: async () => spur.push("starte"),
    anbieterGespraeche: { liste: async () => ({ conversations: [], has_more: false }), hole: async () => null },
    haltAnrufStartFest: () => spur.push("festgehalten"),
    beendeStartUnklar: async () => spur.push("unklar"),
    sperren: { eingefroren: () => false, pausiert: () => false, abgebrochen: () => false },
    beendeOhneWahl: async () => spur.push("ohne-wahl"),
    armeTimer: () => spur.push("timer"),
    wartefristMs: WARTEFRIST_MS,
    mandantenToken: () => "token",
    jetztMs: () => jetzt,
    platz: {
      belege: async () => {
        spur.push("belege");
        return true;
      },
      beendeNachWartefrist: async (id) => spur.push(`frist-ende:${id}`),
      warte: async () => spur.push("warte"),
    },
  });
  return { spur, marker, auftrag };
}

test("Platz frei, aber Frist abgelaufen: keine Wahl, kein Platz belegt, Anruf endet nach der Wartefrist", async () => {
  const bau = aufbau(ANGELEGT_MS + WARTEFRIST_MS + 5000);
  assert.equal(await bau.auftrag({ payload: { callId: CALL_ID } }), ANRUFSTART_AUSGANG.ABGELAUFEN);
  assert.deepEqual(bau.spur, [`frist-ende:${CALL_ID}`]);
  assert.equal(await bau.marker.lies(CALL_ID), null);
});

test("Platz frei, Frist gerade noch nicht abgelaufen: der Anruf wird gewaehlt", async () => {
  const bau = aufbau(ANGELEGT_MS + WARTEFRIST_MS - 1);
  assert.equal(await bau.auftrag({ payload: { callId: CALL_ID } }), ANRUFSTART_AUSGANG.GESTARTET);
  assert.deepEqual(bau.spur, ["belege", "starte", "timer"]);
});
