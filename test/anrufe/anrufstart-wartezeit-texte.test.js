import assert from "node:assert/strict";
import { test } from "node:test";

import { ANRUFSTART_AUSGANG, makeAnrufstartAuftrag } from "../../src/elevenlabs/anrufstart-auftrag.ts";
import { config } from "../../src/config.ts";
import { PLACE_CALL_HOP_TIMEOUT_MS } from "../../src/mcp-tools.js";
import { LEITUNGSPLATZ_ENTSCHEIDUNG, WARTENDE_JE_KUNDE, makeAnrufstartMarker, makeLeitungsplaetze } from "../../src/store.js";
import { legacySnapshot } from "../mcp-draht-pfade.js";

const MS_JE_SEKUNDE = 1000;
const NEUE_HOP_FRIST_MS = 60 * MS_JE_SEKUNDE;
const ALTE_HOP_FRIST_MS = 180 * MS_JE_SEKUNDE;
const BRIEFING_SCHRITTE = 2;
const ANGELEGT_MS = Date.parse("2026-11-18T10:00:00.000Z");
const WARTEFRIST_MS = 120 * MS_JE_SEKUNDE;
const CALL_ID = "call_sg37";

test("Hop-Frist von place_call: eine Minute, weil der Anbieterstart nicht mehr in der Antwort liegt", () => {
  assert.equal(PLACE_CALL_HOP_TIMEOUT_MS, NEUE_HOP_FRIST_MS);
  assert.ok(PLACE_CALL_HOP_TIMEOUT_MS < ALTE_HOP_FRIST_MS);
  assert.ok(PLACE_CALL_HOP_TIMEOUT_MS > BRIEFING_SCHRITTE * config.llm.briefingTimeoutMs);
});

test("Werkzeugtext place_call: Antwort sofort mit der Anruf-ID, Wartezeit hoechstens 2 Minuten, ohne Wahl und ohne Kosten", async () => {
  const { tools } = await legacySnapshot({});
  const beschreibung = tools.find((werkzeug) => werkzeug.name === "place_call").description;
  assert.match(beschreibung, /returns at once with the call_id/);
  assert.match(beschreibung, /waits up to 2 minutes/);
  assert.match(beschreibung, /without dialling and without charge/);
  assert.doesNotMatch(beschreibung, /180/);
});

function wartenderAnruf() {
  const spur = [];
  const uhr = { ms: ANGELEGT_MS + WARTEFRIST_MS };
  const call = {
    id: CALL_ID,
    tenantId: "t_sg37",
    to: "+4915112340088",
    status: "active",
    startedAt: new Date(ANGELEGT_MS).toISOString(),
  };
  const auftrag = makeAnrufstartAuftrag({
    store: { leseCall: async () => call, load: () => ({ calls: [call] }), anderesAnrufMitKonversation: async () => false, anrufstartMarker: makeAnrufstartMarker() },
    starte: async () => spur.push("starte"),
    anbieterGespraeche: { liste: async () => ({ conversations: [], has_more: false }), hole: async () => null },
    haltAnrufStartFest: () => spur.push("festgehalten"),
    beendeStartUnklar: async () => spur.push("unklar"),
    sperren: { eingefroren: () => false, pausiert: () => false, abgebrochen: () => false },
    beendeOhneWahl: async (callId, grund) => spur.push(`ohne-wahl:${callId}:${grund}`),
    armeTimer: () => spur.push("timer"),
    wartefristMs: WARTEFRIST_MS,
    mandantenToken: () => "token",
    jetztMs: () => uhr.ms,
    platz: {
      belege: async () => false,
      beendeNachWartefrist: async (callId) => spur.push(`frist-ende:${callId}`),
      warte: async () => spur.push("warte"),
    },
  });
  return { spur, auftrag };
}

test("SG-37 Wartender Anruf ohne freie Leitung wird nach der Wartefrist nie gewaehlt", async () => {
  const { spur, auftrag } = wartenderAnruf();
  assert.equal(await auftrag({ payload: { callId: CALL_ID } }), ANRUFSTART_AUSGANG.ABGELAUFEN);
  assert.deepEqual(spur, [`frist-ende:${CALL_ID}`]);
});

test("SG-37 Wartende sind je Kunde begrenzt, der naechste wird abgewiesen statt eingereiht", async () => {
  const plaetze = makeLeitungsplaetze();
  for (let nummer = 0; nummer < WARTENDE_JE_KUNDE; nummer += 1)
    assert.equal(await plaetze.belegenWartend({ callId: `w_${nummer}`, tenantId: "kunde_sg37" }), LEITUNGSPLATZ_ENTSCHEIDUNG.FREI);
  assert.equal(await plaetze.belegenWartend({ callId: "w_zuviel", tenantId: "kunde_sg37" }), LEITUNGSPLATZ_ENTSCHEIDUNG.KUNDE_VOLL);
});
