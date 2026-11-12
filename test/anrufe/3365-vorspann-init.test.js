import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
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
import { echtWarten } from "../echt-warten.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_SERVER_FEHLER = 500;
const NUR_LESEN = 0o555;
const SCHREIBBAR = 0o755;
const WARTE_FRIST_MS = 5_000;
const RUHE_MS = 150;
const NUMMER_PRAEFIX = "+4915112391";
const EINMAL = 1;
const AUDIO_BYTES = 200_000;
const APP_ID = "cc_app_3365_h4";
const AGENT_ID = "agent_3365_h4";
const PUBLIC_URL = "https://agent.test";
const FERTIG = "completed";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const ABSENDER = "+15005550006";
const ANGERUFENER = "+491737250001";
const KENNUNG_MENGE = 6;

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const istEl = (anfrage) => koerper(anfrage).command_id.endsWith("-el");
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
const aktionen = (attrappe, bein, aktion) => attrappe.anfragen.filter((anfrage) => anfrage.path === `/v2/calls/${bein}/actions/${aktion}`);
const bruecken = (attrappe, callId) => aktionen(attrappe, calleeVon(callId), "bridge");
const aufleger = (attrappe, callId) => [aktionen(attrappe, calleeVon(callId), "hangup").length, aktionen(attrappe, elVon(callId), "hangup").length];

const hangupFehler = new Set();

function beantworte({ req, res }, anfrage) {
  if (req.url.endsWith("/actions/hangup") && [...hangupFehler].some((bein) => req.url.includes(bein))) {
    res.writeHead(HTTP_SERVER_FEHLER, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errors: [{ code: "99", title: "Fehler" }] }));
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
  res.end(JSON.stringify({ data: { sid: "v3:ob-3365-3b2a", result: "ok" } }));
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

const verwaist = (nummer, extra = {}) =>
  seedCall({
    id: `call_3365_h4_${nummer}`,
    from: ABSENDER,
    to: ANGERUFENER,
    provider: "telnyx",
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    answeredAt: new Date().toISOString(),
    callControlId: calleeVon(`call_3365_h4_${nummer}`),
    elCallControlId: elVon(`call_3365_h4_${nummer}`),
    streamToken: String(nummer).padStart(KENNUNG_MENGE * 2, "0"),
    ...extra,
  });

const VERWAISTE = {
  aufbau: verwaist(1),
  aufbauNurCallee: verwaist(2, { elCallControlId: undefined }),
  bruecke: verwaist(3, { bridgedAt: new Date().toISOString() }),
  bruecke2: verwaist(4, { bridgedAt: new Date().toISOString() }),
  bruecke3: verwaist(5, { bridgedAt: new Date().toISOString() }),
  fremd: verwaist(6),
  unbekannt: verwaist(7),
  ohneBein: verwaist(8, { elCallControlId: null }),
  hangupFehler: verwaist(9),
  speicherFehler: verwaist(10),
};

const umgebung = {};

beforeEach(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...elInboundInitSpawnEnv(AGENT_ID),
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    TELNYX_CALL_CONTROL_APP_ID: APP_ID,
    ELEVENLABS_API_KEY: "test-key-3365",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3365_h4",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: "KEYtest-3365",
    TELNYX_CONNECTION_ID: "conn_3365",
    TELNYX_ACCOUNT_SID: "acct_3365",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
    PUBLIC_URL,
  };
  const seed = seedState({
    tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }],
    calls: Object.values(VERWAISTE),
  });
  umgebung.srv = await startServer({ env, seed });
});

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

let zaehler = 0;
const server = () => umgebung.srv;
const anrufIn = (id) => server().readStore().calls.find((eintrag) => eintrag.id === id);

function sende(callId, typ, { bein = calleeVon(callId), status } = {}) {
  const payload = { call_control_id: bein, ...(status ? { status } : {}) };
  const roh = JSON.stringify({ data: { id: `evt-h4-${(zaehler += EINMAL)}`, event_type: typ, payload } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}
const sprachAnfragen = () => umgebung.attrappe.anfragen.filter((anfrage) => anfrage.path.startsWith("/v1/text-to-speech/"));
const logZeile = (grund, callId) => `[el-vorspann] rueckfall grund=${grund} call=${callId}`;

async function neuerAnruf(extra = {}) {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: `${NUMMER_PRAEFIX}${String((zaehler += EINMAL)).padStart(3, "0")}`, objective: "Termin am Donnerstag vereinbaren", ...extra }),
  });
  return (await antwort.json()).callId;
}

async function init(call, extra = {}) {
  const body = {
    agent_id: AGENT_ID,
    conversation_id: `conv_h4_${(zaehler += EINMAL)}`,
    called_number: call.from,
    sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: call.streamToken },
    ...extra,
  };
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify(body),
  });
  return { status: antwort.status, json: await antwort.json() };
}

async function angenommenerAnruf(extra) {
  const callId = await neuerAnruf(extra);
  assert.equal((await sende(callId, "call.answered")).status, HTTP_OK);
  await waitUntil(() => aktionen(umgebung.attrappe, calleeVon(callId), "playback_start").length === EINMAL);
  await waitUntil(() => umgebung.attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage) && anfrage.roh.includes(callId)));
  return callId;
}


test("3365-K21: Init eines Vorspann-Anrufs -> first_message leer, eroeffnung_gesagt = gesprochener Vorspann-Text", async () => {
  const callId = await angenommenerAnruf();
  const { text: gesprochen } = koerper(sprachAnfragen().at(-1));
  assert.ok(gesprochen.includes("KI"), gesprochen);
  const antwort = await init(anrufIn(callId));
  assert.equal(antwort.status, HTTP_OK);
  const { conversation_config_override: override, dynamic_variables: variablen } = antwort.json;
  const { agent } = override;
  assert.equal(agent.first_message, "");
  assert.equal(agent.language, "en");
  assert.deepEqual(Object.keys(agent).sort(), ["first_message", "language"]);
  assert.equal(typeof override.tts.voice_id, "string");
  assert.equal(variablen.eroeffnung_gesagt, gesprochen);
  assert.equal(variablen.objective, "Termin am Donnerstag vereinbaren");
});

test("3365-K21: Init eines Vorspann-Anrufs in der Offenlegungssprache -> first_message trotzdem leer", async () => {
  const callId = await angenommenerAnruf({ language: "de" });
  const { text: gesprochen } = koerper(sprachAnfragen().at(-1));
  const antwort = await init(anrufIn(callId));
  const { agent } = antwort.json.conversation_config_override;
  assert.equal(agent.language, "de");
  assert.equal(agent.first_message, "");
  assert.equal(antwort.json.dynamic_variables.eroeffnung_gesagt, gesprochen);
});

test("3365-K21: Init eines Anrufs ohne Vorspann-Zustand -> unveraendert, keine eroeffnung_gesagt", async () => {
  const antwort = await init(VERWAISTE.fremd);
  assert.equal(antwort.status, HTTP_OK);
  const { conversation_config_override: override, dynamic_variables: variablen } = antwort.json;
  assert.equal(variablen.eroeffnung_gesagt, undefined);
  assert.equal(override.agent.first_message, undefined);
  assert.equal(variablen.objective, "Testziel");
});

const ereignisse = ["call.answered", "call.playback.ended"];

test("3365-K20: Aufbauphase ohne Prozesszustand -> beide bekannten Beine aufgelegt, Logzeile zustand_fehlt, keine Wiedergabe, keine Bruecke, Anruf beendet", async () => {
  const { attrappe, srv } = umgebung;
  const callId = VERWAISTE.aufbau.id;
  assert.equal((await sende(callId, ereignisse[0])).status, HTTP_OK);
  await waitUntil(() => aufleger(attrappe, callId).join() === "1,1");
  await waitUntil(() => srv.stdout.includes(logZeile("zustand_fehlt", callId)));
  await waitUntil(() => anrufIn(callId).status === "failed");
  assert.equal(anrufIn(callId).failureReason, "zustand_fehlt");
  assert.equal(aktionen(attrappe, calleeVon(callId), "playback_start").length, 0);
  assert.equal(bruecken(attrappe, callId).length, 0);
  await sende(callId, ereignisse[1], { status: FERTIG });
  await sende(callId, "call.answered", { bein: elVon(callId) });
  await echtWarten(RUHE_MS);
  assert.deepEqual(aufleger(attrappe, callId), [1, 1]);
  assert.equal(bruecken(attrappe, callId).length, 0);
});

test("3365-K20: Aufbauphase mit nur einem bekannten Bein -> nur dieses aufgelegt", async () => {
  const { attrappe } = umgebung;
  const callId = VERWAISTE.aufbauNurCallee.id;
  await sende(callId, "call.hangup", { bein: elVon(callId) });
  await echtWarten(RUHE_MS);
  assert.deepEqual(aufleger(attrappe, callId), [0, 0]);
  assert.equal(anrufIn(callId).status, "active");
  await sende(callId, ereignisse[0]);
  await waitUntil(() => aufleger(attrappe, callId).join() === "1,0");
  await waitUntil(() => anrufIn(callId).status === "failed");
});

test("3365-K20: nach der Bruecke ohne Prozesszustand -> Antwort-Ereignisse werden ignoriert", async () => {
  const { attrappe, srv } = umgebung;
  const callId = VERWAISTE.bruecke.id;
  for (const typ of ereignisse) await sende(callId, typ, { status: FERTIG });
  await sende(callId, "call.answered", { bein: elVon(callId) });
  await echtWarten(RUHE_MS);
  assert.deepEqual(aufleger(attrappe, callId), [0, 0]);
  assert.equal(bruecken(attrappe, callId).length, 0);
  assert.equal(anrufIn(callId).status, "active");
  assert.ok(!srv.stdout.includes(logZeile("zustand_fehlt", callId)));
});

test("3365-K20: nach der Bruecke legt die Gegenstelle auf -> EL-Bein aufgelegt, Anruf completed", async () => {
  const { attrappe } = umgebung;
  const callId = VERWAISTE.bruecke2.id;
  await sende(callId, "call.hangup");
  await waitUntil(() => aufleger(attrappe, callId).join() === "0,1");
  await waitUntil(() => anrufIn(callId).status === "completed");
  assert.ok(!anrufIn(callId).failureReason);
  assert.ok(!anrufIn(callId).elFallbackAt);
});

test("3365-K20: nach der Bruecke legt das EL-Bein auf -> Angerufener aufgelegt, Anruf completed ohne Vermerk", async () => {
  const { attrappe } = umgebung;
  const callId = VERWAISTE.bruecke3.id;
  await sende(callId, "call.hangup", { bein: elVon(callId) });
  await waitUntil(() => aufleger(attrappe, callId).join() === "1,0");
  await waitUntil(() => anrufIn(callId).status === "completed");
  assert.ok(!anrufIn(callId).failureReason);
  assert.ok(!anrufIn(callId).elFallbackAt);
});

test("3365-K20: Ereignis eines fremden Beins ohne Zustand -> ignoriert", async () => {
  const { attrappe } = umgebung;
  const callId = VERWAISTE.fremd.id;
  await sende(callId, "call.answered", { bein: "cc_fremd" });
  await echtWarten(RUHE_MS);
  assert.deepEqual(aufleger(attrappe, callId), [0, 0]);
  assert.equal(anrufIn(callId).status, "active");
});

test("3365-K20: Ereignis ohne bekannten Typ ohne Zustand -> ignoriert", async () => {
  const { attrappe } = umgebung;
  const callId = VERWAISTE.unbekannt.id;
  await sende(callId, "call.initiated");
  await echtWarten(RUHE_MS);
  assert.deepEqual(aufleger(attrappe, callId), [0, 0]);
  assert.equal(anrufIn(callId).status, "active");
});

test("3365-K20: Ereignis ohne Beinkennung ohne Zustand -> ignoriert", async () => {
  const { attrappe } = umgebung;
  const callId = VERWAISTE.ohneBein.id;
  await sende(callId, ereignisse[0], { bein: null });
  await echtWarten(RUHE_MS);
  assert.deepEqual(aufleger(attrappe, callId), [0, 0]);
  assert.equal(anrufIn(callId).status, "active");
});

test("3365-K20: scheitert das Auflegen eines Beins ohne Zustand -> Fehler im Log, Anruf trotzdem beendet", async () => {
  const { srv } = umgebung;
  const callId = VERWAISTE.hangupFehler.id;
  hangupFehler.add(calleeVon(callId));
  try {
    await sende(callId, ereignisse[0]);
    await waitUntil(() => srv.stdout.includes(`[el-vorspann] nachlauf fehlgeschlagen call=${callId}:`));
  } finally {
    hangupFehler.delete(calleeVon(callId));
  }
  await waitUntil(() => anrufIn(callId).status === "failed");
});

test("3365-K20: scheitert das Speichern des Endes ohne Zustand -> Fehler im Log, beide Beine trotzdem aufgelegt", async () => {
  const { attrappe, srv } = umgebung;
  const callId = VERWAISTE.speicherFehler.id;
  fs.chmodSync(srv.dataDir, NUR_LESEN);
  try {
    await sende(callId, ereignisse[0]);
    await waitUntil(() => aufleger(attrappe, callId).join() === "1,1");
    await waitUntil(() => srv.stdout.includes(`[el-vorspann] ende fehlgeschlagen call=${callId}:`));
  } finally {
    fs.chmodSync(srv.dataDir, SCHREIBBAR);
  }
});

test("3365-K20: Ereignis eines fremden Beins bei vorhandenem Zustand -> ignoriert", async () => {
  const { attrappe } = umgebung;
  const callId = await angenommenerAnruf();
  await sende(callId, "call.hangup", { bein: "cc_fremd" });
  await echtWarten(RUHE_MS);
  assert.deepEqual(aufleger(attrappe, callId), [0, 0]);
  assert.equal(anrufIn(callId).status, "active");
});
