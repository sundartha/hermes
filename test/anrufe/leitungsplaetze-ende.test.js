import assert from "node:assert/strict";
import test from "node:test";

import { seedState, startServer, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { beinLegtAuf, initInhaltFuer, vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { calleeVon, elVon, makeTelnyxSigner, vorspannUmgebung } from "./el-bein-attrappe.js";
import { CONVERSATION_DONE_WITH_ANALYSIS, CONVERSATION_IN_PROGRESS } from "../fixtures/elevenlabs-conversations.js";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const AUFTRAG = "Tisch fuer zwei reservieren (Ende-Regeln)";
const EL_PLAETZE_NUTZBAR = 4;
const KONVERSATION_PFAD = "/v1/convai/conversations/";
const TTS_PFAD = "/v1/text-to-speech/";
const WAHL_PFAD = "/v2/calls";
const AUDIO_BYTES = 200_000;
const AGENT_KENNUNG = "le";

const kundeVon = (index) => `t_le_${index}`;
const absenderVon = (index) => `+1202555${String(2000 + index).padStart(4, "0")}`;
const zielVon = (nummer) => `+1202555${String(5000 + nummer).padStart(4, "0")}`;

function seedKunden(anzahl) {
  const indizes = Array.from({ length: anzahl }, (_, index) => index);
  return seedState({
    tenants: indizes.map((index) => ({
      id: kundeVon(index),
      status: "active",
      kycLevel: "card",
      ownerName: "Eve Example",
      country: "US",
      defaultLanguage: "en",
    })),
    numbers: indizes.map((index) => ({
      id: `num_le_${index}`,
      e164: absenderVon(index),
      tenantId: kundeVon(index),
      provider: "telnyx",
      status: "active",
      providerNumberId: null,
      providerAgentPhoneNumberId: `phnum_le_${index}`,
      language: "en",
    })),
    profiles: Object.fromEntries(indizes.map((index) => [kundeVon(index), { maxCallsPerHour: 100 }])),
  });
}

async function rufeAn(srv, index, ziel) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": kundeVon(index) },
    body: JSON.stringify({ to: ziel, objective: AUFTRAG }),
  });
  return { status: res.status, body: await res.json() };
}

async function startePlaetze(srv, anzahl, kundeJeAnruf) {
  for (let nummer = 1; nummer <= anzahl; nummer += 1) {
    const antwort = await rufeAn(srv, kundeJeAnruf(nummer), zielVon(nummer));
    assert.equal(antwort.status, HTTP_OK, `Anruf ${nummer} muss angenommen werden`);
  }
}

let ereignisZaehler = 0;
async function meldeBein(srv, callId, { typ, bein = calleeVon(callId), status }) {
  const payload = { call_control_id: bein, ...(status ? { status } : {}) };
  const antwort = await abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: { id: `evt-ende-${(ereignisZaehler += 1)}`, event_type: typ, payload } }),
  });
  assert.equal(antwort.status, HTTP_OK);
}

function starteElAnbieter() {
  const fertig = new Set();
  return starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      if (req.url.startsWith(TTS_PFAD)) {
        res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
        return res.end(Buffer.alloc(AUDIO_BYTES, 1));
      }
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      if (req.url === WAHL_PFAD) {
        const befehl = JSON.parse(roh).command_id;
        const anrufId = befehl.replace(/^vorspann-/, "").replace(/-el$/, "");
        const kennung = befehl.endsWith("-el") ? elVon(anrufId) : calleeVon(anrufId);
        return res.end(JSON.stringify({ data: { call_control_id: kennung, result: "ok" } }));
      }
      if (!req.url.startsWith(KONVERSATION_PFAD)) return res.end(JSON.stringify({ data: { result: "ok" } }));
      const id = req.url.slice(KONVERSATION_PFAD.length);
      const vorlage = fertig.has(id) ? CONVERSATION_DONE_WITH_ANALYSIS : CONVERSATION_IN_PROGRESS;
      res.end(JSON.stringify({ ...vorlage, conversation_id: id }));
    });
  }).then((attrappe) => ({ ...attrappe, melde: (id) => fertig.add(id) }));
}

const erster = (stand) => stand.calls.find((call) => call.tenantId === kundeVon(0));

test("Ende: ein abgeholtes ElevenLabs-Ergebnis gibt den Platz frei, ein noch laufendes Gespraech nicht", async () => {
  const anbieter = await starteElAnbieter();
  const srv = await startServer({
    env: {
      ...vorspannUmgebung({ attrappe: anbieter, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung: AGENT_KENNUNG }),
      ...vorspannMandantenUmgebung(Array.from({ length: EL_PLAETZE_NUTZBAR + 1 }, (_, index) => kundeVon(index))),
      ELEVENLABS_RESULT_POLL_MS: "100",
      SKIP_TWILIO_SIGNATURE_CHECK: "true",
    },
    seed: seedKunden(EL_PLAETZE_NUTZBAR + 1),
  });
  try {
    await startePlaetze(srv, EL_PLAETZE_NUTZBAR, (nummer) => nummer - 1);
    const erstesWarten = await rufeAn(srv, EL_PLAETZE_NUTZBAR, zielVon(900));
    assert.equal(erstesWarten.status, HTTP_OK);
    assert.equal(erstesWarten.body.status, "dialing");
    const gewaehlt = (zustand, callId) => Boolean(zustand.calls.find((call) => call.id === callId).callControlId);
    assert.equal(gewaehlt(srv.readStore(), erstesWarten.body.callId), false, "bei belegten Plaetzen wird nicht gewaehlt");
    const stand = await waitForStoreState(srv, (s) => s.calls.length >= EL_PLAETZE_NUTZBAR);
    await initInhaltFuer(srv, { callId: erster(stand).id, agentId: `agent_${AGENT_KENNUNG}` });
    const gebunden = await waitForStoreState(srv, (s) => Boolean(erster(s).elevenlabsConversationId));
    const callId = erster(gebunden).id;
    await meldeBein(srv, callId, { typ: "call.playback.ended", status: "completed" });
    await meldeBein(srv, callId, { typ: "call.answered", bein: elVon(callId) });
    await waitForStoreState(srv, (s) => Boolean(erster(s).bridgedAt));
    anbieter.melde(erster(gebunden).elevenlabsConversationId);
    await beinLegtAuf(srv, callId);
    await waitForStoreState(srv, (s) => erster(s).status === "completed" && Boolean(erster(s).billedAt) && Boolean(erster(s).summary));
    await waitForStoreState(srv, (s) => gewaehlt(s, erstesWarten.body.callId));
    const zweitesWarten = await rufeAn(srv, EL_PLAETZE_NUTZBAR, zielVon(901));
    assert.equal(zweitesWarten.status, HTTP_OK);
    assert.equal(zweitesWarten.body.status, "dialing");
    assert.equal(gewaehlt(srv.readStore(), zweitesWarten.body.callId), false, "der eine frei gewordene Platz ist vergeben");
  } finally {
    await srv.stop();
    await anbieter.close();
  }
});
