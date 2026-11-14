import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.js";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  OWNER_TEST_FIRST_NAME,
  makeTelnyxSigner,
  nowSeconds,
  seedCall,
  seedState,
  startServer,
  waitUntil as wartebis,
} from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_SERVER_FEHLER = 500;
const WARTE_FRIST_MS = 5_000;
const NUMMER_PRAEFIX = "+4915112392";
const EINMAL = 1;
const AUDIO_BYTES = 200_000;
const APP_ID = "cc_app_3755";
const AGENT_ID = "agent_3755";
const PUBLIC_URL = "https://agent.test";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const EIGENE_NUMMER = "+4915112392999";

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const istEl = (anfrage) => koerper(anfrage).command_id.endsWith("-el");
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
const aktionen = (attrappe, bein, aktion) => attrappe.anfragen.filter((anfrage) => anfrage.path === `/v2/calls/${bein}/actions/${aktion}`);

let zaehler = 0;
const ttsFehler = { an: false };

function beantworte({ req, res }, anfrage) {
  if (ttsFehler.an && req.url.startsWith("/v1/text-to-speech/")) {
    res.writeHead(HTTP_SERVER_FEHLER, { "content-type": "application/json" });
    return res.end("{}");
  }
  if (req.url.startsWith("/v1/text-to-speech/")) {
    res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
    return res.end(Buffer.alloc(AUDIO_BYTES, 1));
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  if (req.url === "/v2/calls") {
    const kennung = koerper(anfrage).command_id.replace(/^vorspann-/, "").replace(/-el$/, "");
    return res.end(JSON.stringify({ data: { call_control_id: istEl(anfrage) ? elVon(kennung) : calleeVon(kennung) } }));
  }
  res.end(JSON.stringify({ data: { sid: `v3:ob-3755-${(zaehler += EINMAL)}`, result: "ok" } }));
}

async function starteAttrappe() {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      const anfrage = { method: req.method, path: req.url, roh };
      anfragen.push(anfrage);
      beantworte({ req, res }, anfrage);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    anfragen,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

const umgebung = {};

beforeEach(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...elInboundInitSpawnEnv(AGENT_ID),
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    OWNER_SELF_CALL_ENABLED: "true",
    OWNER_SELF_CALL_TENANT_IDS: TENANT_ID,
    TELNYX_CALL_CONTROL_APP_ID: APP_ID,
    ELEVENLABS_API_KEY: "test-key-3755",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3755",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: "KEYtest-3755",
    TELNYX_CONNECTION_ID: "conn_3755",
    TELNYX_ACCOUNT_SID: "acct_3755",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
    PUBLIC_URL,
  };
  const seed = seedState({
    tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME, privateNumber: EIGENE_NUMMER }],
  });
  umgebung.srv = await startServer({ env, seed });
});

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

const anrufIn = (id) => {
  const { calls } = umgebung.srv.readStore();
  return calls.find((eintrag) => eintrag.id === id);
};

function sende(callId, typ, extra = {}) {
  const payload = { call_control_id: calleeVon(callId), ...extra };
  const roh = JSON.stringify({ data: { id: `evt-3755-${(zaehler += EINMAL)}`, event_type: typ, payload } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}
const alleAnfragen = () => umgebung.attrappe.anfragen;
const sprachAnfragen = () => alleAnfragen().filter((anfrage) => anfrage.path.startsWith("/v1/text-to-speech/"));

function voiceOutbound(callId) {
  const roh = new URLSearchParams({ CallSid: anrufIn(callId).twilioSid }).toString();
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/outbound?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

async function neuerAnruf(extra = {}) {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: `${NUMMER_PRAEFIX}${String((zaehler += EINMAL)).padStart(3, "0")}`, objective: "Termin am Donnerstag vereinbaren", ...extra }),
  });
  assert.equal(antwort.status, HTTP_OK);
  return (await antwort.json()).callId;
}

async function init(call) {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: `conv_3755_${(zaehler += EINMAL)}`,
      called_number: call.from,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: call.streamToken },
    }),
  });
  assert.equal(antwort.status, HTTP_OK);
  return antwort.json();
}

async function angenommenerAnruf(extra) {
  const callId = await neuerAnruf(extra);
  assert.equal((await sende(callId, "call.answered")).status, HTTP_OK);
  await waitUntil(() => aktionen(umgebung.attrappe, calleeVon(callId), "playback_start").length === EINMAL);
  await waitUntil(() => umgebung.attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage) && anfrage.roh.includes(callId)));
  return callId;
}

async function beendeAnruf(callId) {
  await sende(callId, "call.hangup");
  await waitUntil(() => anrufIn(callId).status !== "active");
}

for (const [fall, extra] of [
  ["Dritter, en", {}],
  ["Dritter, de", { language: "de" }],
  ["Dritter, fr", { language: "fr" }],
  ["Besitzer, en", { to: EIGENE_NUMMER }],
  ["Besitzer, de", { to: EIGENE_NUMMER, language: "de" }],
  ["Besitzer, fr", { to: EIGENE_NUMMER, language: "fr" }],
]) {
  test(`3755-K1: ${fall} -> Init nach dem Vorspann traegt leere first_message und den gesprochenen Text`, async () => {
    const callId = await angenommenerAnruf(extra);
    const { text: gesprochen } = koerper(sprachAnfragen().at(-1));
    assert.equal(anrufIn(callId).calleeIsOwner === true, extra.to === EIGENE_NUMMER);
    const antwort = await init(anrufIn(callId));
    assert.equal(antwort.conversation_config_override.agent.first_message, "");
    assert.equal(antwort.dynamic_variables.eroeffnung_gesagt, gesprochen);
    await beendeAnruf(callId);
  });
}

test("3755-K3: zwei Anrufe nacheinander an dieselbe Nummer mit verschiedenem Anlass -> jeder Init nennt nur den eigenen Anlass", async () => {
  const nummer = `${NUMMER_PRAEFIX}777`;
  const erster = await angenommenerAnruf({ to: nummer, objective: "Zahnarzttermin am Montag verschieben" });
  const spracherster = koerper(sprachAnfragen().at(-1)).text;
  const initErster = await init(anrufIn(erster));
  await beendeAnruf(erster);
  const zweiter = await angenommenerAnruf({ to: nummer, objective: "Blumen fuer Freitag bestellen" });
  const sprachzweiter = koerper(sprachAnfragen().at(-1)).text;
  assert.notEqual(zweiter, erster);
  assert.ok(spracherster.toLowerCase().includes("zahnarzt"), spracherster);
  assert.ok(sprachzweiter.toLowerCase().includes("blumen"), sprachzweiter);
  const initZweiter = await init(anrufIn(zweiter));
  assert.equal(initZweiter.dynamic_variables.eroeffnung_gesagt, sprachzweiter);
  assert.ok(!JSON.stringify(initZweiter).toLowerCase().includes("zahnarzt"));
  assert.equal(initErster.dynamic_variables.eroeffnung_gesagt, spracherster);
  assert.ok(!JSON.stringify(initErster).toLowerCase().includes("blumen"));
});

for (const [fall, extra, mitAnlass, fragen] of [
  ["Dritter, fr", { language: "fr" }, true, 0],
  ["Besitzer, fr", { to: EIGENE_NUMMER, language: "fr" }, true, 0],
]) {
  test(`3755-K2: ${fall}, Vorspann nicht erzeugbar (Rueckfall) -> Init ohne eroeffnung_gesagt, first_message traegt die volle Eroeffnung`, async () => {
    ttsFehler.an = true;
    let callId;
    try {
      callId = await neuerAnruf(extra);
    } finally {
      ttsFehler.an = false;
    }
    await waitUntil(() => umgebung.srv.stdout.includes(`[el-vorspann] rueckfall grund=tts_fehler call=${callId}`));
    assert.equal((await voiceOutbound(callId)).status, HTTP_OK);
    const antwort = await init(anrufIn(callId));
    const { first_message: erste } = antwort.conversation_config_override.agent;
    assert.equal(antwort.dynamic_variables.eroeffnung_gesagt, undefined);
    assert.equal(erste.split("?").length - 1, fragen, erste);
    assert.equal(erste.includes("Termin am Donnerstag vereinbaren"), mitAnlass, erste);
    assert.match(erste, /KI-Assistent/);
    assert.equal(anrufIn(callId).calleeIsOwner === true, extra.to === EIGENE_NUMMER);
  });
}
