import assert from "node:assert/strict";
import { test } from "node:test";

import { ANRUFSTART_AUSGANG, ANRUFSTART_SPERRE, makeAnrufstartAuftrag } from "../../src/elevenlabs/anrufstart-auftrag.ts";
import * as speicher from "../../src/store.js";
import { legeMandantAn, makePgTestStore } from "../pg-helpers.js";

const MANDANT = "t_anrufstart_asynchron";
const ZIEL = "+4915112340033";
const ABSENDER = "+4930555000403";
const FEST_MS = Date.parse("2026-11-18T10:00:00.000Z");

async function neuerAufbau({ eingefroren, pausiert }) {
  const { store: db, runner } = await makePgTestStore();
  await legeMandantAn(db, MANDANT);
  const call = db.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: MANDANT });
  await db.persistCall(call.id);
  const spur = [];
  const auftrag = makeAnrufstartAuftrag({
    store: {
      leseCall: (id) => db.leseCall(id),
      load: () => db.load(),
      anderesAnrufMitKonversation: (id, konv) => db.anderesAnrufMitKonversation(id, konv),
      anrufstartMarker: speicher.makePostgresAnrufstartMarker(runner),
    },
    starte: async () => {
      spur.push("starte");
    },
    anbieterGespraeche: { liste: async () => null, hole: async () => null },
    haltAnrufStartFest: () => {},
    beendeStartUnklar: async () => {},
    sperren: {
      eingefroren: async () => eingefroren,
      pausiert: async () => pausiert,
      abgebrochen: () => false,
    },
    beendeOhneWahl: async (callId, grund) => {
      spur.push(`ohne-wahl:${grund}`);
    },
    armeTimer: () => {},
    mandantenToken: () => "token-asynchron",
    jetztMs: () => FEST_MS,
  });
  return { auftrag: () => auftrag({ payload: { callId: call.id } }), spur };
}

const FAELLE = [
  { name: "beide Sperren lesen false", eingefroren: false, pausiert: false, ausgang: ANRUFSTART_AUSGANG.GESTARTET, spur: ["starte"] },
  {
    name: "OUTBOUND_FROZEN liest true",
    eingefroren: true,
    pausiert: false,
    ausgang: ANRUFSTART_AUSGANG.ABGESPERRT,
    spur: [`ohne-wahl:${ANRUFSTART_SPERRE.EINGEFROREN}`],
  },
  {
    name: "die Anrufpause liest true",
    eingefroren: false,
    pausiert: true,
    ausgang: ANRUFSTART_AUSGANG.ABGESPERRT,
    spur: [`ohne-wahl:${ANRUFSTART_SPERRE.PAUSE}`],
  },
  {
    name: "beide lesen true, OUTBOUND_FROZEN geht vor",
    eingefroren: true,
    pausiert: true,
    ausgang: ANRUFSTART_AUSGANG.ABGESPERRT,
    spur: [`ohne-wahl:${ANRUFSTART_SPERRE.EINGEFROREN}`],
  },
];

for (const fall of FAELLE)
  test(`Anrufstart mit asynchron gelesenen Sperren: ${fall.name}`, async () => {
    const aufbau = await neuerAufbau(fall);
    assert.equal(await aufbau.auftrag(), fall.ausgang);
    assert.deepEqual(aufbau.spur, fall.spur);
  });
