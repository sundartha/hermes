import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { OWNER_TEST_FIRST_NAME, seedCall, seedState, startServer, waitUntil } from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_CONFLICT = 409;
const HTTP_SERVER_FEHLER = 500;
const WARTE_FRIST_MS = 5_000;
const AGENT_ID = "agent_3365_nach_tts";
const TTS_PFAD = "/v1/text-to-speech/";
const TEXML_PFAD = "/v2/texml/calls/conn_nach_tts";
const WAHL_PFAD = "/v2/calls";
const DEPLOY_TOKEN = "3365-nach-tts-deploy-token-mindestens-32";
const NUMMERN = ["+4915112360001", "+4915112360002"];

const umgebung = {};

async function starteAttrappe() {
  const anfragen = [];
  const steuerung = {};
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", async () => {
      anfragen.push(req.url);
      if (req.url.startsWith(TTS_PFAD)) {
        await steuerung.ttsWartet;
        res.writeHead(HTTP_SERVER_FEHLER, { "content-type": "application/json" });
        return res.end("{}");
      }
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { sid: "v3:ob-nach-tts", result: "ok", call_control_id: "cc_x" } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    anfragen,
    steuerung,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

before(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.srv = await startServer({
    env: {
      ...elInboundInitSpawnEnv(AGENT_ID),
      ELEVENLABS_OUTBOUND_ENABLED: "true",
      ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
      ELEVENLABS_OUTBOUND_VORSPANN: "true",
      TELNYX_CALL_CONTROL_APP_ID: "cc_app_nach_tts",
      ELEVENLABS_API_KEY: "test-key-nach-tts",
      ELEVENLABS_API_BASE: umgebung.attrappe.url,
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_nach_tts",
      ELEVENLABS_RESULT_POLL_MS: "60000",
      TELNYX_API_BASE: umgebung.attrappe.url,
      TELNYX_API_KEY: "KEYtest-nach-tts",
      TELNYX_CONNECTION_ID: "conn_nach_tts",
      TELNYX_ACCOUNT_SID: "acct_nach_tts",
      PUBLIC_URL: "https://agent.test",
      HERMES_DEPLOY_TOKEN: DEPLOY_TOKEN,
    },
    seed: seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] }),
  });
});

after(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

const anrufStarten = (to) =>
  abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to, objective: "Termin am Donnerstag vereinbaren" }),
  });
const anrufZu = (to) => {
  const { srv } = umgebung;
  return srv.readStore().calls.find((eintrag) => eintrag.to === to);
};
const anfragenListe = () => {
  const { attrappe } = umgebung;
  return attrappe.anfragen;
};
const anzahl = (pfad) => anfragenListe().filter((eintrag) => eintrag === pfad).length;
const ttsAnzahl = () => anfragenListe().filter((eintrag) => eintrag.startsWith(TTS_PFAD)).length;

async function startenUndWarten(to, waehrend) {
  let freigeben;
  umgebung.attrappe.steuerung.ttsWartet = new Promise((resolve) => (freigeben = resolve));
  const ttsVorher = ttsAnzahl();
  const start = anrufStarten(to);
  await waitUntil(() => ttsAnzahl() > ttsVorher, { timeoutMs: WARTE_FRIST_MS });
  try {
    await waehrend(anrufZu(to));
  } finally {
    freigeben();
    delete umgebung.attrappe.steuerung.ttsWartet;
  }
  return start;
}

const setzeAnrufpause = async (an) => {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/intern/anrufpause`, {
    method: "POST",
    headers: { Authorization: `Bearer ${DEPLOY_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ an }),
  });
  assert.equal(antwort.status, HTTP_OK);
};

test("3365-B4: cancel_call waehrend des TTS-Wartens, danach TTS-Fehler -> 409, kein TeXML, kein POST /v2/calls", async () => {
  const texmlVorher = anzahl(TEXML_PFAD);
  const wahlVorher = anzahl(WAHL_PFAD);
  const antwort = await startenUndWarten(NUMMERN[0], async (call) => {
    const abbruch = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls/${call.id}/cancel`, { method: "POST" });
    assert.equal(abbruch.status, HTTP_OK);
  });
  assert.equal(antwort.status, HTTP_CONFLICT);
  assert.equal(anzahl(TEXML_PFAD), texmlVorher);
  assert.equal(anzahl(WAHL_PFAD), wahlVorher);
  assert.equal(anrufZu(NUMMERN[0]).status, "cancelled");
});

test("3365-B4: Anrufpause waehrend des TTS-Wartens, danach TTS-Fehler -> keine Wahl, kein TeXML, Anruf failed", async () => {
  const texmlVorher = anzahl(TEXML_PFAD);
  const wahlVorher = anzahl(WAHL_PFAD);
  const antwort = await startenUndWarten(NUMMERN[1], async () => setzeAnrufpause(true)).finally(() => setzeAnrufpause(false));
  assert.notEqual(antwort.status, HTTP_OK);
  assert.equal(anzahl(TEXML_PFAD), texmlVorher);
  assert.equal(anzahl(WAHL_PFAD), wahlVorher);
  assert.equal(anrufZu(NUMMERN[1]).status, "failed");
});
