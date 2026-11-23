import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { anschlussSatz } from "../../src/elevenlabs/vorspann-anschluss.ts";
import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.ts";
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
const WARTE_FRIST_MS = 5_000;
const NUMMER_PRAEFIX = "+4915112392";
const EINMAL = 1;
const AUDIO_BYTES = 200_000;
const APP_ID = "cc_app_6126";
const AGENT_ID = "agent_6126";
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

function beantworte({ req, res }, anfrage) {
  if (req.url.startsWith("/v1/text-to-speech/")) {
    res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
    return res.end(Buffer.alloc(AUDIO_BYTES, 1));
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  if (req.url === "/v2/calls") {
    const kennung = koerper(anfrage).command_id.replace(/^vorspann-/, "").replace(/-el$/, "");
    return res.end(JSON.stringify({ data: { call_control_id: istEl(anfrage) ? elVon(kennung) : calleeVon(kennung) } }));
  }
  res.end(JSON.stringify({ data: { sid: `v3:ob-6126-${(zaehler += EINMAL)}`, result: "ok" } }));
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
    ELEVENLABS_API_KEY: "test-key-6126",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_6126",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: "KEYtest-6126",
    TELNYX_CONNECTION_ID: "conn_6126",
    TELNYX_ACCOUNT_SID: "acct_6126",
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
  const roh = JSON.stringify({ data: { id: `evt-6126-${(zaehler += EINMAL)}`, event_type: typ, payload } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}
const alleAnfragen = () => umgebung.attrappe.anfragen;
const sprachAnfragen = () => alleAnfragen().filter((anfrage) => anfrage.path.startsWith("/v1/text-to-speech/"));

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
      conversation_id: `conv_6126_${(zaehler += EINMAL)}`,
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


const GRUSSWOERTER = /\b(hello|hi|hallo|guten tag|bonjour|salut)\b/i;
const AUFFORDERUNG = { en: "Please go ahead.", de: "Bitte sprechen Sie.", fr: "Je vous écoute." };

async function anschlussFuer(extra) {
  const callId = await angenommenerAnruf(extra);
  const { text: gesprochen } = koerper(sprachAnfragen().at(-1));
  const antwort = await init(anrufIn(callId));
  return { gesprochen, antwort, agent: antwort.conversation_config_override.agent };
}

for (const sprache of ["en", "de", "fr"]) {
  test(`6126-K1/K2/K3: Dritter, ${sprache} -> first_message nennt den Anlass, fordert zum Sprechen auf, ohne Gruss und KI-Hinweis`, async () => {
    const { gesprochen, antwort, agent } = await anschlussFuer({ language: sprache });
    const satz = agent.first_message;
    assert.ok(satz.endsWith(AUFFORDERUNG[sprache]), satz);
    assert.ok(satz.length > AUFFORDERUNG[sprache].length + 1, satz);
    assert.doesNotMatch(satz, GRUSSWOERTER);
    assert.ok(!satz.includes(gesprochen));
    assert.ok(!satz.includes("Hermes"), satz);
    assert.equal(agent.language, sprache);
    assert.equal(antwort.dynamic_variables.eroeffnung_gesagt, gesprochen);
    assert.equal(antwort.dynamic_variables.eroeffnung, "");
  });
}

test("6126-K1: der Anschluss nennt den bereinigten Anlass des Auftrags", async () => {
  const { agent } = await anschlussFuer({ language: "en", objective: "Book a table for four on Friday" });
  assert.match(agent.first_message, /book a table for four on friday/i);
});

test("6126-K5: Anlass mit Platzhalter im Auftrag -> der Anschluss traegt nie einen Platzhalter", async () => {
  const { agent } = await anschlussFuer({ language: "en", objective: "Book {{table}} for Friday" });
  assert.doesNotMatch(agent.first_message, /\{\{/);
  assert.ok(agent.first_message.endsWith(AUFFORDERUNG.en), agent.first_message);
});

for (const [fall, eingabe, erwartet] of [
  ["Anlass mit Platzhalter", { language: "en", anlass: "I am calling about {{x}}" }, "Please go ahead."],
  ["leerer Anlass", { language: "de", anlass: "  " }, "Bitte sprechen Sie."],
  ["Anlass kein Text", { language: "fr", anlass: undefined }, "Je vous écoute."],
  ["Anlass mit Satzende", { language: "en", anlass: "I am calling about your order!" }, "I am calling about your order. Please go ahead."],
  ["Anlass klein am Anfang", { language: "de", anlass: "Wegen Ihrer Bestellung" }, "Wegen Ihrer Bestellung. Bitte sprechen Sie."],
  ["unbekannte Sprache ohne Aufforderung", { language: "xx", anlass: "I am calling about it" }, "I am calling about it."],
]) {
  test(`6126-K5: anschlussSatz, ${fall}`, () => {
    assert.equal(anschlussSatz(eingabe), erwartet);
  });
}
