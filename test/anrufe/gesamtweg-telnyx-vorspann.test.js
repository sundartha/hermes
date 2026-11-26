import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { planProfileFor } from "../../src/plans.ts";
import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.ts";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  makeTelnyxSigner,
  mcpPost,
  nowSeconds,
  readToolResult,
  seedState,
  startIdp,
  startServer,
  toolCall,
  waitForStoreState,
  warteAufEreignis,
} from "../helpers.js";
import { CONV_ID } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { calleeVon, elVon, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const TENANT = "t_gw_6182";
const SUB = "sub-gw-6182";
const ABSENDER = "+4915110006182";
const ZIEL = "+49 211 5550182";
const AUFTRAG = "Ich möchte einen Haarschnitt für Donnerstagvormittag buchen.";
const KENNUNG = "6182";
const AGENT_ID = `agent_${KENNUNG}`;
const HTTP_OK = 200;
const WARTE_FRIST_MS = 10_000;
const ABFRAGE_TAKT_MS = "100";
const AUDIO_BYTES = 200_000;
const CONVERSATION_LAEUFT = Object.freeze({ conversation_id: CONV_ID, status: "in-progress", transcript: [], metadata: {} });
const ZEILEN = ["Guten Tag, hier spricht ein KI-Assistent.", "Donnerstag um zehn passt."];
const ZUSAMMENFASSUNG = "Termin am Donnerstag um 10 Uhr vereinbart.";
const GESPRAECH_FERTIG = Object.freeze({
  conversation_id: CONV_ID,
  status: "done",
  transcript: [{ role: "agent", message: ZEILEN[0] }, { role: "user", message: ZEILEN[1] }],
  analysis: { call_successful: "success", transcript_summary: ZUSAMMENFASSUNG },
  metadata: { call_duration_secs: 60, cost_fiat: 0.12, phone_call: { direction: "outbound", call_id: "sip_6182" } },
});

const seed = () =>
  seedState({
    settings: { allowSummaries: true },
    tenants: [{ id: TENANT, idpSubject: SUB, status: "active", ownerName: "Gw Kunde", kycLevel: "card" }],
    profiles: { [TENANT]: { ...planProfileFor("business"), maxCallsPerHour: 100 } },
    numbers: [
      { id: "num_gw", e164: ABSENDER, tenantId: TENANT, provider: "telnyx", status: "active", providerNumberId: null, providerAgentPhoneNumberId: "phnum_gw_6182" },
    ],
  });

async function starteElAttrappe() {
  const el = { antwort: CONVERSATION_LAEUFT, setzeAntwort: (antwort) => (el.antwort = antwort) };
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url.startsWith("/v1/text-to-speech/")) {
      res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
      return res.end(Buffer.alloc(AUDIO_BYTES, 1));
    }
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(el.antwort));
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  el.url = `http://127.0.0.1:${server.address().port}`;
  el.close = () => {
    server.closeAllConnections();
    return new Promise((fertig) => server.close(fertig));
  };
  return el;
}

async function mitGesamtweg(lauf) {
  const idp = await startIdp();
  const telnyx = await starteAttrappe();
  const el = await starteElAttrappe();
  const signer = makeTelnyxSigner();
  let srv;
  try {
  srv = await startServer({
    env: {
      ...vorspannUmgebung({ attrappe: telnyx, signer, publicUrl: "https://agent.test", kennung: KENNUNG }),
      ELEVENLABS_API_BASE: el.url,
      ELEVENLABS_RESULT_POLL_MS: ABFRAGE_TAKT_MS,
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      ...vorspannMandantenUmgebung([TENANT]),
      MCP_UI_ENABLED: "true",
      RETENTION_DAYS: "7",
    },
    seed: seed(),
  });
    await lauf({ srv, idp, telnyx, el, signer });
  } finally {
    await srv?.stop();
    await el.close();
    await telnyx.close();
    await idp.close();
  }
}

let ereignisZaehler = 0;
function telnyxEreignis({ srv, signer, callId }, typ, { bein = calleeVon(callId), status } = {}) {
  const payload = { call_control_id: bein, ...(status ? { status } : {}) };
  const roh = JSON.stringify({ data: { id: `evt-6182-${(ereignisZaehler += 1)}`, event_type: typ, payload } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": signer.sign(zeit, roh) },
    body: roh,
  });
}

const aktionen = (telnyx, bein, aktion) => telnyx.anfragen.filter((anfrage) => anfrage.pfad === `/v2/calls/${bein}/actions/${aktion}`);
const gewaehlt = (telnyx, nachsilbe) => telnyx.waehlbefehle.filter((befehl) => befehl.endsWith(nachsilbe));

async function platziere({ srv, idp }) {
  const antwort = await readToolResult(
    await mcpPost(`${srv.localUrl}/mcp`, await idp.sign({ sub: SUB }), toolCall("place_call", { to: ZIEL, objective: AUFTRAG, })),
  );
  assert.notEqual(antwort.isError, true, JSON.stringify(antwort));
  return antwort.structuredContent.call_id;
}

async function initAnfrage(srv, call) {
  const antwort = await abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: CONV_ID,
      called_number: call.from,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: call.streamToken },
    }),
  });
  return { status: antwort.status, json: await antwort.json() };
}

test("Gesamtweg Telnyx-Vorspann: place_call, Annahme, Init-Bindung, Gespraech und Abschluss ergeben einen abgeschlossenen Anruf mit Transkript", async () => {
  await mitGesamtweg(async ({ srv, idp, telnyx, el, signer }) => {
    const callId = await platziere({ srv, idp });
    const anruf = () => srv.readStore().calls.find((eintrag) => eintrag.id === callId);
    const warteAuf = (bedingung) => warteAufEreignis([srv.ereignisse], bedingung, { timeoutMs: WARTE_FRIST_MS });
    await warteAuf(() => gewaehlt(telnyx, callId).length === 1);
    assert.equal(anruf().costProfile, KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI);
    assert.equal(anruf().from, ABSENDER);

    assert.equal((await telnyxEreignis({ srv, signer, callId }, "call.answered")).status, HTTP_OK);
    await warteAuf(() => aktionen(telnyx, calleeVon(callId), "playback_start").length === 1);
    await warteAuf(() => gewaehlt(telnyx, "-el").length === 1);

    const init = await initAnfrage(srv, anruf());
    assert.equal(init.status, HTTP_OK);
    const { conversation_config_override: override, dynamic_variables: variablen } = init.json;
    assert.equal(override.agent.language, "de");
    assert.equal(override.agent.first_message, `${AUFTRAG} Bitte sprechen Sie.`);
    assert.equal(variablen.objective, AUFTRAG);
    assert.ok(variablen.eroeffnung_gesagt.includes("KI"), variablen.eroeffnung_gesagt);
    await waitForStoreState(srv, () => anruf().elevenlabsConversationId === CONV_ID, WARTE_FRIST_MS);

    await telnyxEreignis({ srv, signer, callId }, "call.playback.ended", { status: "completed" });
    await telnyxEreignis({ srv, signer, callId }, "call.answered", { bein: elVon(callId) });
    await warteAuf(() => aktionen(telnyx, calleeVon(callId), "bridge").length === 1);

    el.setzeAntwort(GESPRAECH_FERTIG);
    await telnyxEreignis({ srv, signer, callId }, "call.hangup");
    await waitForStoreState(srv, () => anruf().status === "completed" && anruf().billedAt, WARTE_FRIST_MS);
    assert.equal(anruf().summary, ZUSAMMENFASSUNG);
    assert.deepEqual(anruf().transcript.map((zeile) => zeile.text).slice(-ZEILEN.length), ZEILEN);
  });
});
