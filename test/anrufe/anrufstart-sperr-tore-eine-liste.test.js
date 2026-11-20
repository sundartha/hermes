import assert from "node:assert/strict";
import { test } from "node:test";

import { ANRUFSTART_SPERR_TORE, ANRUFSTART_SPERRE, makeAnrufstartAuftrag } from "../../src/elevenlabs/anrufstart-auftrag.ts";

const ANRUF = { id: "call_tore", tenantId: "t_tore", to: "+4915112340033", startedAt: "2026-11-20T10:00:00.000Z" };
const FEST_MS = Date.parse("2026-11-20T10:00:00.500Z");

async function sperrGrundAusAuftrag(sperren) {
  const beendet = [];
  const ausfuehren = makeAnrufstartAuftrag({
    store: {
      leseCall: async () => ANRUF,
      anrufstartMarker: { lies: async () => null },
    },
    starte: async () => assert.fail("darf nicht starten"),
    anbieterGespraeche: { liste: async () => null, hole: async () => null },
    haltAnrufStartFest: () => null,
    beendeStartUnklar: async () => {},
    sperren: { abgebrochen: () => false, ...sperren },
    beendeOhneWahl: async (callId, grund) => {
      beendet.push([callId, grund]);
    },
    armeTimer: () => {},
    mandantenToken: () => "token",
    jetztMs: () => FEST_MS,
  });
  await ausfuehren({ payload: { callId: ANRUF.id } });
  return beendet;
}

test("Sperr-Tore stehen in fester Reihenfolge Einfrieren vor Pause mit ihren Gruenden", () => {
  assert.deepEqual(
    ANRUFSTART_SPERR_TORE.map(({ name, grund }) => [name, grund]),
    [
      ["eingefroren", "outbound-frozen"],
      ["pausiert", "anrufpause"],
    ],
  );
});

test("Auftragspfad beendet bei Kill-Switch und Pause mit outbound-frozen und fragt die Pause gar nicht erst", async () => {
  const fragen = [];
  const beendet = await sperrGrundAusAuftrag({
    eingefroren: () => true,
    pausiert: () => {
      fragen.push("pausiert");
      return true;
    },
  });
  assert.deepEqual(beendet, [[ANRUF.id, ANRUFSTART_SPERRE.EINGEFROREN]]);
  assert.deepEqual(fragen, []);
});

test("Auftragspfad beendet bei nur aktiver Pause mit anrufpause und reicht den Anruf an die Pause", async () => {
  const gefragt = [];
  const beendet = await sperrGrundAusAuftrag({
    eingefroren: () => false,
    pausiert: (call) => {
      gefragt.push(call.id);
      return true;
    },
  });
  assert.deepEqual(beendet, [[ANRUF.id, "anrufpause"]]);
  assert.deepEqual(gefragt, [ANRUF.id]);
});

test("ein Tor, das beim Lesen wirft, laesst den Auftrag nicht durch", async () => {
  await assert.rejects(
    sperrGrundAusAuftrag({
      eingefroren: () => {
        throw new Error("Tor nicht lesbar");
      },
      pausiert: () => false,
    }),
    /Tor nicht lesbar/,
  );
});
