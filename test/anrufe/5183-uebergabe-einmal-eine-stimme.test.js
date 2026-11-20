import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
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
const APP_ID = "cc_app_5183";
const AGENT_ID = "agent_5183";
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
  res.end(JSON.stringify({ data: { sid: `v3:ob-5183-${(zaehler += EINMAL)}`, result: "ok" } }));
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

const ABSENDER = "+15005550006";
const verwaist = (nummer, extra) =>
  seedCall({
    id: `call_5183_${nummer}`,
    from: ABSENDER,
    to: extra.to,
    provider: "telnyx",
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: new Date().toISOString(),
    callControlId: calleeVon(`call_5183_${nummer}`),
    elCallControlId: elVon(`call_5183_${nummer}`),
    streamToken: String(nummer).padStart(12, "0"),
    ...extra,
  });
const VERWAISTE = { gleicheSprache: verwaist(1, { to: "+491737250001" }), andereSprache: verwaist(2, { to: "+33142685300" }) };

const umgebung = {};

async function starteDienst() {
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...elInboundInitSpawnEnv(AGENT_ID),
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    OWNER_SELF_CALL_ENABLED: "true",
    OWNER_SELF_CALL_TENANT_IDS: TENANT_ID,
    TELNYX_CALL_CONTROL_APP_ID: APP_ID,
    ELEVENLABS_API_KEY: "test-key-5183",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_5183",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: "KEYtest-5183",
    TELNYX_CONNECTION_ID: "conn_5183",
    TELNYX_ACCOUNT_SID: "acct_5183",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
    PUBLIC_URL,
  };
  const seed = seedState({
    tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME, privateNumber: EIGENE_NUMMER }],
    calls: Object.values(VERWAISTE),
  });
  umgebung.srv = await startServer({ env, seed });
}

beforeEach(async () => {
  umgebung.attrappe = await starteAttrappe();
  await starteDienst();
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
  const roh = JSON.stringify({ data: { id: `evt-5183-${(zaehler += EINMAL)}`, event_type: typ, payload } });
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
  assert.equal(antwort.status, HTTP_OK, await antwort.clone().text());
  return (await antwort.json()).callId;
}

async function init(call) {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: `conv_5183_${(zaehler += EINMAL)}`,
      called_number: call.from,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: call.streamToken },
    }),
  });
  assert.equal(antwort.status, HTTP_OK, await antwort.clone().text());
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

const FAELLE = [
  ["Dritter, en", {}],
  ["Dritter, de", { language: "de" }],
  ["Dritter, fr", { language: "fr" }],
  ["Besitzer, en", { to: EIGENE_NUMMER }],
  ["Besitzer, de", { to: EIGENE_NUMMER, language: "de" }],
  ["Besitzer, fr", { to: EIGENE_NUMMER, language: "fr" }],
];
const stimmeVon = (anfrage) => anfrage.path.split("/")[3];

for (const [fall, extra] of FAELLE) {
  test(`5183-K1: ${fall} -> nach dem Vorspann traegt die Init-Antwort keine Eroeffnung, die der Agent sprechen koennte`, async () => {
    const callId = await angenommenerAnruf(extra);
    const { text: gesprochen } = koerper(sprachAnfragen().at(-1));
    const antwort = await init(anrufIn(callId));
    assert.equal(antwort.conversation_config_override.agent.first_message, "");
    assert.equal(antwort.dynamic_variables.eroeffnung, "");
    assert.equal(antwort.dynamic_variables.eroeffnung_gesagt, gesprochen);
    await beendeAnruf(callId);
  });

  test(`5183-K2: ${fall} -> Vorspann und Agent sprechen mit derselben Stimme`, async () => {
    const callId = await angenommenerAnruf(extra);
    const vorspannStimme = stimmeVon(sprachAnfragen().at(-1));
    assert.ok(vorspannStimme.length > 0);
    const antwort = await init(anrufIn(callId));
    assert.equal(antwort.conversation_config_override.tts.voice_id, vorspannStimme);
    await beendeAnruf(callId);
  });
}

test("5183-K3: ohne Vorspann traegt die Variable die Eroeffnung, first_message bleibt wie bisher und die Offenlegung steht vorn", async () => {
  const gleiche = await init(VERWAISTE.gleicheSprache);
  assert.equal(gleiche.dynamic_variables.eroeffnung_gesagt, undefined);
  assert.match(gleiche.dynamic_variables.eroeffnung, /^Hallo, .*KI-Assistent von Jonas Beispiel/);
  assert.equal(gleiche.conversation_config_override.agent.first_message, undefined);
  const andere = await init(VERWAISTE.andereSprache);
  assert.equal(andere.dynamic_variables.eroeffnung_gesagt, undefined);
  assert.ok(andere.dynamic_variables.eroeffnung.length > 0);
  const ersteNachricht = andere.conversation_config_override.agent.first_message;
  assert.equal(ersteNachricht, andere.dynamic_variables.eroeffnung);
  assert.ok(ersteNachricht.startsWith("Bonjour, ceci est un assistant IA"));
});
