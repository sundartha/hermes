import assert from "node:assert/strict";
import { test } from "node:test";

import { makeAnrufstartAuftrag } from "../../src/elevenlabs/anrufstart-auftrag.ts";

const FEST_MS = Date.parse("2026-11-26T10:00:00.000Z");
const WARTEFRIST_MS = 120 * 1000;
const WARTE_TAKT_MS = 1000;
const CALL = {
  id: "call-rennen",
  tenantId: "t_rennen",
  to: "+4915112340011",
  startedAt: new Date(FEST_MS).toISOString(),
};

function aufbau({ unsichtbarFuer, beendenScheitert = false }) {
  const protokoll = { lesen: 0, starts: [], beendet: [], gewartet: [] };
  const abhaengigkeiten = {
    store: {
      leseCall: async () => {
        protokoll.lesen += 1;
        return protokoll.lesen > unsichtbarFuer ? CALL : null;
      },
      anderesAnrufMitKonversation: async () => false,
      anrufstartMarker: { setze: async () => true, lies: async () => null },
    },
    starte: async (call) => {
      protokoll.starts.push(call.id);
    },
    anbieterGespraeche: { liste: async () => null, hole: async () => null },
    haltAnrufStartFest: () => {},
    beendeStartUnklar: async () => {},
    sperren: { eingefroren: () => false, pausiert: () => false, abgebrochen: () => false },
    platz: {
      belege: async () => true,
      beendeNachWartefrist: async () => {},
      warte: async (ms) => {
        protokoll.gewartet.push(ms);
      },
    },
    wartefristMs: WARTEFRIST_MS,
    beendeOhneWahl: async (callId, grund) => {
      if (beendenScheitert) throw new Error("Speicher weg");
      protokoll.beendet.push([callId, grund]);
    },
    armeTimer: () => {},
    mandantenToken: () => "token",
    jetztMs: () => FEST_MS,
  };
  return { protokoll, auftrag: makeAnrufstartAuftrag(abhaengigkeiten) };
}

test("Anrufstart-Auftrag: sieht der erste Lesevorgang den Anruf noch nicht, startet er nach kurzer Wiederholung genau einmal", async () => {
  const { protokoll, auftrag } = aufbau({ unsichtbarFuer: 2 });
  assert.equal(await auftrag({ payload: { callId: CALL.id } }), "gestartet");
  assert.deepEqual(protokoll.starts, [CALL.id]);
  assert.deepEqual(protokoll.gewartet, [WARTE_TAKT_MS, WARTE_TAKT_MS]);
  assert.deepEqual(protokoll.beendet, []);
});

test("Anrufstart-Auftrag: bleibt der Anruf nach der Wiederholung unlesbar, endet er als nicht gewaehlt und startet nie", async () => {
  const { protokoll, auftrag } = aufbau({ unsichtbarFuer: 100 });
  await assert.rejects(auftrag({ payload: { callId: CALL.id } }), /Auftrag ohne bekannten Anruf/);
  assert.deepEqual(protokoll.starts, []);
  assert.deepEqual(protokoll.beendet, [[CALL.id, "anruf-nicht-lesbar"]]);
  assert.equal(protokoll.lesen, 5);
  assert.deepEqual(protokoll.gewartet, [WARTE_TAKT_MS, WARTE_TAKT_MS, WARTE_TAKT_MS, WARTE_TAKT_MS]);
});

test("Anrufstart-Auftrag: ein Auftrag ohne gueltige callId beendet keinen Anruf", async () => {
  const { protokoll, auftrag } = aufbau({ unsichtbarFuer: 100 });
  await assert.rejects(auftrag({ payload: { callId: 7 } }), /Auftrag ohne bekannten Anruf/);
  assert.deepEqual(protokoll.beendet, []);
  assert.equal(protokoll.lesen, 0);
});

test("Anrufstart-Auftrag: scheitert das Beenden des unlesbaren Anrufs, bleibt die Meldung 'Auftrag ohne bekannten Anruf'", async () => {
  const { auftrag } = aufbau({ unsichtbarFuer: 100, beendenScheitert: true });
  await assert.rejects(auftrag({ payload: { callId: CALL.id } }), /Auftrag ohne bekannten Anruf/);
});
