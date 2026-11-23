import assert from "node:assert/strict";

import { CONVERSATION_IN_PROGRESS } from "../fixtures/elevenlabs-conversations.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { EL_INBOUND_ACCESS_BOOT_ENV, nowSeconds, waitUntil } from "../helpers.js";
import { initBindungsKoerper } from "../_iel-inbound-harness.js";
import { starteAttrappe } from "./attrappen-server.js";

const HTTP_OK = 200;
const START_PFAD = "/v1/convai/sip-trunk/outbound-call";
const KONVERSATION_PFAD = "/v1/convai/conversations/";
const WAHL_PFAD = "/v2/calls";
const TTS_PFAD = "/v1/text-to-speech/";
const AUDIO_BYTES = 200_000;
const EL_BEIN_ENDUNG = "-el";
const gewaehlterBefehl = (anfrage) => anfrage.body.command_id ?? "";
const INIT_PFAD = "/webhooks/elevenlabs/init";
const INIT_TOKEN_KOPF = "x-hermes-init-token";
const WARTE_FRIST_MS = 10_000;
const KONVERSATION_VORSATZ = "conv_";
const AUFLEGEN = /^\/v2\/calls\/(cc_(?:callee|el)_(.+))\/actions\/hangup$/;
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
let ereignisZaehler = 0;
const meldeFehler = (fehler) => console.error("[attrappe] ereignis:", fehler.message);

function signaturKopf(signer, roh) {
  if (!signer) return {};
  const zeit = String(nowSeconds());
  return { "telnyx-timestamp": zeit, "telnyx-signature-ed25519": signer.sign(zeit, roh) };
}

async function sendeEreignis({ url, signer }, callId, { typ, bein, status }) {
  const payload = { call_control_id: bein, ...(status ? { status } : {}) };
  const ereignis = { data: { id: `evt-pg-${(ereignisZaehler += 1)}`, event_type: typ, payload } };
  const roh = JSON.stringify(ereignis);
  const antwort = await abrufMitFrist(`${url}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...signaturKopf(signer, roh) },
    body: roh,
  });
  assert.equal(antwort.status, HTTP_OK, await antwort.text());
}

async function bindeGespraech({ url, agentId }, callId, { streamToken, from }) {
  const koerper = {
    ...initBindungsKoerper({ bindung: streamToken, agentId, conversationId: `${KONVERSATION_VORSATZ}${callId}` }),
    called_number: from,
  };
  const antwort = await abrufMitFrist(`${url}${INIT_PFAD}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_KOPF]: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN },
    body: JSON.stringify(koerper),
  });
  assert.equal(antwort.status, HTTP_OK, await antwort.text());
}

const callIdVon = (befehl) => befehl.replace(/^vorspann-/, "").replace(/-el$/, "");
const jsonAntwort = (res, payload) => {
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
};

export async function starteAnrufstartAttrappe({ signer } = {}) {
  const sende = (url, callId, daten) => sendeEreignis({ url, signer }, callId, daten);
  const anfragen = [];
  const instanzen = new Map();
  const besitzer = new Map();
  const aufgelegteAnrufe = new Set();
  const laeufe = new Set();
  const besitzerVon = (callId) => besitzer.get(callId) ?? [...instanzen.values()].at(-1);
  const elGewaehlt = (callId) =>
    anfragen.some((a) => a.pfad === WAHL_PFAD && gewaehlterBefehl(a) === `vorspann-${callId}${EL_BEIN_ENDUNG}`);

  function imHintergrund(lauf) {
    const festgehalten = new Promise((fertig) => setImmediate(fertig))
      .then(lauf)
      .catch(meldeFehler)
      .finally(() => laeufe.delete(festgehalten));
    laeufe.add(festgehalten);
  }

  async function nimmAn(callId, hermes) {
    await sende(hermes.url, callId, { typ: "call.answered", bein: calleeVon(callId) });
    await waitUntil(() => elGewaehlt(callId), { timeoutMs: WARTE_FRIST_MS });
    await bindeGespraech(hermes, callId, await hermes.leseAnruf(callId));
    await sende(hermes.url, callId, { typ: "call.playback.ended", bein: calleeVon(callId), status: "completed" });
    await sende(hermes.url, callId, { typ: "call.answered", bein: elVon(callId) });
  }

  function beantworteWahl(anfrage, res) {
    const befehl = gewaehlterBefehl(anfrage);
    const callId = callIdVon(befehl);
    const calleeBein = !befehl.endsWith(EL_BEIN_ENDUNG);
    const hermes = instanzen.get(new URL(anfrage.body.webhook_url).host);
    if (hermes && calleeBein) {
      besitzer.set(callId, hermes);
      imHintergrund(() => nimmAn(callId, hermes));
    }
    jsonAntwort(res, { data: { call_control_id: `cc_${calleeBein ? "callee" : "el"}_${callId}`, result: "ok" } });
  }

  function beantworteAufgelegt([, bein, callId], res) {
    aufgelegteAnrufe.add(callId);
    imHintergrund(() => sende(besitzerVon(callId).url, callId, { typ: "call.hangup", bein }));
    jsonAntwort(res, { data: { result: "ok" } });
  }

  function beantworteKonversation(anfrage, res) {
    const konversation = anfrage.pfad.slice(KONVERSATION_PFAD.length);
    const beendet = anfrage.methode === "GET" && aufgelegteAnrufe.has(konversation.slice(KONVERSATION_VORSATZ.length));
    const abgeschlossen = beendet ? { status: "done", metadata: { call_duration_secs: 1, error: null } } : {};
    jsonAntwort(res, { ...CONVERSATION_IN_PROGRESS, conversation_id: konversation, ...abgeschlossen });
  }

  function beantworte(anfrage, res) {
    if (anfrage.pfad.startsWith(TTS_PFAD)) {
      res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
      return res.end(Buffer.alloc(AUDIO_BYTES, 1));
    }
    const aufgelegt = AUFLEGEN.exec(anfrage.pfad);
    if (anfrage.pfad === WAHL_PFAD) return beantworteWahl(anfrage, res);
    if (aufgelegt) return beantworteAufgelegt(aufgelegt, res);
    if (anfrage.pfad.startsWith(START_PFAD))
      return jsonAntwort(res, { success: true, conversation_id: `conv_gw0_${anfragen.length}`, sip_call_id: "sip_gw0" });
    return beantworteKonversation(anfrage, res);
  }

  const attrappe = await starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (stueck) => (roh += stueck));
    req.on("end", () => {
      const anfrage = { methode: req.method, pfad: req.url, body: JSON.parse(roh || "{}") };
      anfragen.push(anfrage);
      beantworte(anfrage, res);
    });
  });
  return {
    url: attrappe.url,
    starts: () =>
      anfragen.filter(
        (a) =>
          a.methode === "POST" &&
          (a.pfad.startsWith(START_PFAD) || (a.pfad === WAHL_PFAD && !gewaehlterBefehl(a).endsWith(EL_BEIN_ENDUNG))),
      ),
    beendetGespraech: (konversation) => {
      assert.ok(konversation, "ohne Gespraechs-ID laesst sich das Beenden keinem Anruf zuordnen");
      const callId = konversation.slice(KONVERSATION_VORSATZ.length);
      const beinPfade = [calleeVon(callId), elVon(callId)].map((bein) => `/v2/calls/${bein}/actions/hangup`);
      return anfragen.some(
        (a) => (a.methode === "DELETE" && a.pfad === KONVERSATION_PFAD + konversation) || beinPfade.includes(a.pfad),
      );
    },
    verbinde: (ziel) => instanzen.set(ziel.host, ziel),
    legtAuf: (konversation) => {
      const callId = konversation.slice(KONVERSATION_VORSATZ.length);
      return sende(besitzerVon(callId).url, callId, { typ: "call.hangup", bein: calleeVon(callId) });
    },
    schliessen: async () => {
      while (laeufe.size > 0) await Promise.allSettled([...laeufe]);
      await attrappe.close();
    },
  };
}
