import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { VORSPANN_WAHL_GRUND } from "../src/elevenlabs/vorspann-pruefung.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  OWNER_TEST_FIRST_NAME,
  makeTelnyxSigner,
  nowSeconds,
  seedCall,
  seedState,
  startServer,
  waitUntil,
} from "./helpers.js";
import { elInboundInitSpawnEnv } from "./_iel-inbound-harness.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { echtWarten } from "./echt-warten.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_BAD_GATEWAY = 502;
const HTTP_UNPROCESSABLE = 422;
const POLL_MS = 10;
const POLL_VERSUCHE = 300;
const NUMMER_PRAEFIX = "+4915112340";
const EINMAL = 1;
const AGENT_ID = "agent_3365_h2";
const OBJECTIVE = "Termin am Donnerstag vereinbaren";
const TTS_PFAD = "/v1/text-to-speech/";
const EL_START_PFAD = "/v1/convai/sip-trunk/outbound-call";
const TEXML_PFAD = "/v2/texml/calls/conn_3365";
const WAHL_PFAD = "/v2/calls";
const AKTION_PFAD = "/v2/calls/";
const APP_ID = "cc_app_3365";
const FREMDE_ID = "cc_fremd_3365";
const TELNYX_KEY = "KEYtest-3365";
const EL_KEY = "test-key-3365";
const TRAEGER_SID = "v3:ob-3365-h2";
const AUDIO_BYTES = 200_000;
const PUBLIC_URL = "https://agent.test";
const SIP_PASSWORT = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD;
const FEHLER_DETAIL = "detail-mit-geheimnis";
const DEPLOY_TOKEN = "3365-vorspann-deploy-token-mindestens-32";


const koerper = (anfrage) => JSON.parse(anfrage.roh);
const beine = (callId) => ({ callee: `cc_callee_${callId}` });
const nachPfad = (attrappe, pfad) => attrappe.anfragen.filter((anfrage) => anfrage.method === "POST" && anfrage.path === pfad);
const wahlen = (attrappe, callId) => nachPfad(attrappe, WAHL_PFAD).filter((anfrage) => koerper(anfrage).command_id.endsWith(callId));
const aktionen = (attrappe, bein, aktion) => nachPfad(attrappe, `${AKTION_PFAD}${bein}/actions/${aktion}`);
const ttsAnfragen = (attrappe) => attrappe.anfragen.filter((anfrage) => anfrage.path.startsWith(TTS_PFAD));

function antworteWahl(res, anfrage, steuerung) {
  const callId = koerper(anfrage).command_id.replace(/^vorspann-/, "");
  if (steuerung.dialFehler) {
    res.writeHead(HTTP_UNPROCESSABLE, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errors: [{ code: "10015", title: "Invalid", detail: FEHLER_DETAIL }] }));
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: { call_control_id: beine(callId).callee } }));
}

async function starteAttrappe() {
  const anfragen = [];
  const steuerung = {};
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", async () => {
      const anfrage = { method: req.method, path: req.url, roh };
      anfragen.push(anfrage);
      if (req.url.startsWith(TTS_PFAD)) {
        await steuerung.ttsWartet;
        res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
        return res.end(Buffer.alloc(AUDIO_BYTES, 1));
      }
      if (req.url.startsWith(EL_START_PFAD)) {
        res.writeHead(HTTP_OK, { "content-type": "application/json" });
        return res.end(JSON.stringify({ success: true, conversation_id: "conv_3365", sip_call_id: "sip_3365" }));
      }
      if (req.url === WAHL_PFAD) return antworteWahl(res, anfrage, steuerung);
      if (req.url.endsWith("/actions/playback_start")) await steuerung.playbackWartet;
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { sid: TRAEGER_SID, result: "ok" } }));
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

const umgebung = {};

const serverEinstellungen = (env = {}) => ({
  env: {
    ...elInboundInitSpawnEnv(AGENT_ID),
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    TELNYX_CALL_CONTROL_APP_ID: APP_ID,
    ELEVENLABS_API_KEY: EL_KEY,
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3365",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: TELNYX_KEY,
    TELNYX_CONNECTION_ID: "conn_3365",
    TELNYX_ACCOUNT_SID: "acct_3365",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
    HERMES_DEPLOY_TOKEN: DEPLOY_TOKEN,
    ...env,
  },
  seed: seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] }),
});

before(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  umgebung.srv = await startServer(serverEinstellungen());
});

after(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

let anrufZaehler = 0;
const naechsteNummer = () => `${NUMMER_PRAEFIX}${String((anrufZaehler += EINMAL)).padStart(3, "0")}`;

const anrufStarten = (to = naechsteNummer()) =>
  abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to, objective: OBJECTIVE }),
  });
const anrufIn = (id) => {
  const { calls } = umgebung.srv.readStore();
  return calls.find((eintrag) => eintrag.id === id);
};

let ereignisZaehler = 0;
function sendeEreignis({ callId, typ, bein, signatur = true }) {
  ereignisZaehler += EINMAL;
  const roh = JSON.stringify({ data: { id: `evt-${ereignisZaehler}`, event_type: typ, payload: { call_control_id: bein ?? beine(callId).callee } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "telnyx-timestamp": zeit,
      "telnyx-signature-ed25519": signatur ? umgebung.signer.sign(zeit, roh) : "ungueltig",
    },
    body: roh,
  });
}

async function bis(pruefung) {
  for (let versuch = 0; versuch < POLL_VERSUCHE; versuch += EINMAL) {
    if (await pruefung()) return;
    await echtWarten(POLL_MS);
  }
  throw new Error("Bedingung nicht innerhalb der Testfrist erreicht");
}

async function mitSteuerung(werte, run) {
  Object.assign(umgebung.attrappe.steuerung, werte);
  try {
    await run();
  } finally {
    for (const schluessel of Object.keys(werte)) delete umgebung.attrappe.steuerung[schluessel];
  }
}

async function starteUndHebeAb() {
  const { attrappe } = umgebung;
  const { callId } = await (await anrufStarten()).json();
  assert.equal((await sendeEreignis({ callId, typ: "call.answered" })).status, HTTP_OK);
  await waitUntil(() => wahlen(attrappe, callId).length === EINMAL && aktionen(attrappe, beine(callId).callee, "playback_start").length === EINMAL);
  return callId;
}

function audioPfad(callId) {
  const [start] = aktionen(umgebung.attrappe, beine(callId).callee, "playback_start");
  return new URL(koerper(start).audio_url).pathname;
}

test("3365-K7: Schalter an -> genau ein POST /v2/calls an die Call-Control-App mit Wahlfeldern, kein TeXML, Kennung am Anruf", async () => {
  const { attrappe } = umgebung;
  const to = naechsteNummer();
  const antwort = await anrufStarten(to);
  const { callId } = await antwort.json();
  assert.equal(antwort.status, HTTP_OK);
  assert.equal(wahlen(attrappe, callId).length, EINMAL);
  assert.equal(attrappe.anfragen.filter((anfrage) => anfrage.path === TEXML_PFAD && anfrage.roh.includes(to.slice(1))).length, 0);
  const call = anrufIn(callId);
  assert.equal(call.callControlId, beine(callId).callee);
  assert.deepEqual(koerper(wahlen(attrappe, callId)[0]), {
    connection_id: APP_ID,
    to,
    from: call.from,
    webhook_url: `${PUBLIC_URL}/voice/vorspann?callId=${callId}`,
    time_limit_secs: call.maxDurationS,
    command_id: `vorspann-${callId}`,
  });
});

test("3365-K7: Wahl scheitert (HTTP 422) -> kein TeXML-Versuch, Anruf endet failed, Fehlerdetail des Anbieters nicht im Log", async () => {
  const { attrappe, srv } = umgebung;
  const to = naechsteNummer();
  const texmlVorher = nachPfad(attrappe, TEXML_PFAD).length;
  await mitSteuerung({ dialFehler: true }, async () => {
    const antwort = await anrufStarten(to);
    assert.equal(antwort.status, HTTP_BAD_GATEWAY);
  });
  assert.equal(nachPfad(attrappe, TEXML_PFAD).length, texmlVorher);
  const call = srv.readStore().calls.find((eintrag) => eintrag.to === to);
  assert.equal(call.status, "failed");
  assert.ok(!srv.stdout.includes(FEHLER_DETAIL), "Anbieter-Detail im Log");
  assert.ok(!srv.stdout.includes(TELNYX_KEY), "Schluessel im Log");
});

test("3365-K6: cancel_call waehrend des TTS-Wartens -> keine Wahl, kein TeXML, Logzeile abgebrochen_vor_wahl", async () => {
  const { attrappe, srv } = umgebung;
  let freigeben;
  const ttsWartet = new Promise((resolve) => (freigeben = resolve));
  const to = naechsteNummer();
  const ttsVorher = ttsAnfragen(attrappe).length;
  const texmlVorher = nachPfad(attrappe, TEXML_PFAD).length;
  await mitSteuerung({ ttsWartet }, async () => {
    const start = anrufStarten(to);
    await waitUntil(() => ttsAnfragen(attrappe).length > ttsVorher);
    const call = srv.readStore().calls.find((eintrag) => eintrag.to === to);
    const abbruch = await abrufMitFrist(`${srv.localUrl}/api/calls/${call.id}/cancel`, { method: "POST" });
    assert.equal(abbruch.status, HTTP_OK);
    freigeben();
    const antwort = await start;
    assert.equal(antwort.status, HTTP_CONFLICT);
    assert.deepEqual(await antwort.json(), { error: "Der Anruf wurde vor dem Waehlen abgebrochen. Es wurde nicht gewaehlt.", callId: call.id });
    assert.equal(wahlen(attrappe, call.id).length, 0);
    assert.equal(nachPfad(attrappe, TEXML_PFAD).length, texmlVorher);
    assert.ok(srv.stdout.includes(`[el-vorspann] rueckfall grund=${VORSPANN_WAHL_GRUND.ABGEBROCHEN} call=${call.id}`), srv.stdout);
  });
});

async function setzeAnrufpause(an) {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/intern/anrufpause`, {
    method: "POST",
    headers: { Authorization: `Bearer ${DEPLOY_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ an }),
  });
  assert.equal(antwort.status, HTTP_OK);
}

test("3365-K6: Anrufpause waehrend des TTS-Wartens -> keine Wahl, kein TeXML, Anruf failed, Logzeile gesperrt_vor_wahl", async () => {
  const { attrappe, srv } = umgebung;
  let freigeben;
  const ttsWartet = new Promise((resolve) => (freigeben = resolve));
  const to = naechsteNummer();
  const ttsVorher = ttsAnfragen(attrappe).length;
  const texmlVorher = nachPfad(attrappe, TEXML_PFAD).length;
  await mitSteuerung({ ttsWartet }, async () => {
    const start = anrufStarten(to);
    await waitUntil(() => ttsAnfragen(attrappe).length > ttsVorher);
    await setzeAnrufpause(true);
    try {
      freigeben();
      assert.notEqual((await start).status, HTTP_OK);
    } finally {
      await setzeAnrufpause(false);
    }
  });
  const call = srv.readStore().calls.find((eintrag) => eintrag.to === to);
  assert.equal(wahlen(attrappe, call.id).length, 0);
  assert.equal(nachPfad(attrappe, TEXML_PFAD).length, texmlVorher);
  assert.equal(call.status, "failed");
  assert.ok(srv.stdout.includes(`[el-vorspann] rueckfall grund=${VORSPANN_WAHL_GRUND.GESPERRT} call=${call.id}`), srv.stdout);
});

test("3365-K8: call.answered -> Antwort 200 vor jeder Aktion, playback_start mit der Vorspann-Adresse, Anruf als abgehoben vermerkt", async () => {
  const { attrappe } = umgebung;
  let wiedergabeFreigeben;
  const playbackWartet = new Promise((resolve) => (wiedergabeFreigeben = resolve));
  await mitSteuerung({ playbackWartet }, async () => {
    const { callId } = await (await anrufStarten()).json();
    const antwort = await sendeEreignis({ callId, typ: "call.answered" });
    assert.equal(antwort.status, HTTP_OK);
    await waitUntil(() => aktionen(attrappe, beine(callId).callee, "playback_start").length === EINMAL);
    wiedergabeFreigeben();
    assert.match(koerper(aktionen(attrappe, beine(callId).callee, "playback_start")[0]).audio_url, new RegExp(`^${PUBLIC_URL}/voice/tts/[A-Za-z0-9_-]{43}$`));
    await bis(() => anrufIn(callId).answeredAt);
  });
});

test("3365-K9: zweites call.answered (neue Ereigniskennung) -> kein zweites playback_start", async () => {
  const { attrappe } = umgebung;
  const callId = await starteUndHebeAb();
  assert.equal((await sendeEreignis({ callId, typ: "call.answered" })).status, HTTP_OK);
  await sendeEreignis({ callId, typ: "call.playback.ended" });
  await bis(async () => (await abrufMitFrist(`${umgebung.srv.localUrl}${audioPfad(callId)}`)).status === HTTP_NOT_FOUND);
  assert.equal(aktionen(attrappe, beine(callId).callee, "playback_start").length, EINMAL);
  assert.equal(wahlen(attrappe, callId).length, EINMAL);
});

test("3365-K10: Ereignis eines fremden Beins oder zu unbekanntem Anruf -> 200 ohne Telnyx-Aktion", async () => {
  const { attrappe, srv } = umgebung;
  const { callId } = await (await anrufStarten()).json();
  const fremdesBein = await sendeEreignis({ callId, typ: "call.answered", bein: FREMDE_ID });
  const unbekannterAnruf = await sendeEreignis({ callId: "gibt-es-nicht", typ: "call.answered" });
  assert.equal(fremdesBein.status, HTTP_OK);
  assert.equal(unbekannterAnruf.status, HTTP_OK);
  await sendeEreignis({ callId, typ: "call.answered" });
  await waitUntil(() => aktionen(attrappe, beine(callId).callee, "playback_start").length === EINMAL);
  assert.equal(aktionen(attrappe, FREMDE_ID, "playback_start").length, 0);
  assert.equal(aktionen(attrappe, beine("gibt-es-nicht").callee, "playback_start").length, 0);
  assert.doesNotMatch(srv.stdout, /\[error\]/);
});

test("3365-K11: ungueltige Signatur -> 403 ohne Aktion; gueltige Signatur -> 200 und die Aktion aus K8", async () => {
  const { attrappe } = umgebung;
  const { callId } = await (await anrufStarten()).json();
  const ungueltig = await sendeEreignis({ callId, typ: "call.answered", signatur: false });
  assert.equal(ungueltig.status, HTTP_FORBIDDEN);
  assert.equal((await sendeEreignis({ callId, typ: "call.answered" })).status, HTTP_OK);
  await waitUntil(() => aktionen(attrappe, beine(callId).callee, "playback_start").length === EINMAL);
  assert.equal(anrufIn(callId).status, "active");
});

test("3365-K12: Vorspann-Datei ist mehrfach abrufbar bis call.playback.ended, danach 404", async () => {
  const callId = await starteUndHebeAb();
  const abruf = () => abrufMitFrist(`${umgebung.srv.localUrl}${audioPfad(callId)}`);
  const erster = await abruf();
  const zweiter = await abruf();
  assert.equal(erster.status, HTTP_OK);
  assert.equal(zweiter.status, HTTP_OK);
  assert.equal((await zweiter.arrayBuffer()).byteLength, AUDIO_BYTES);
  await sendeEreignis({ callId, typ: "call.playback.ended" });
  await bis(async () => (await abruf()).status === HTTP_NOT_FOUND);
});

test("3365-K17: Angerufener legt nach dem Abheben auf -> Anruf completed und abgerechnet, kein weiteres Auflegen, kein bridge", async () => {
  const { attrappe } = umgebung;
  const callId = await starteUndHebeAb();
  await sendeEreignis({ callId, typ: "call.hangup" });
  await bis(() => anrufIn(callId).status === "completed");
  assert.equal(aktionen(attrappe, beine(callId).callee, "bridge").length, 0);
  assert.equal(aktionen(attrappe, beine(callId).callee, "hangup").length, 0);
});

test("3365-K17: Angerufener legt auf, bevor abgehoben wurde -> Anruf failed (no-answer)", async () => {
  const { attrappe } = umgebung;
  const { callId } = await (await anrufStarten()).json();
  await sendeEreignis({ callId, typ: "call.hangup" });
  await bis(() => anrufIn(callId).status === "failed");
  assert.equal(anrufIn(callId).failureReason, "no-answer");
  assert.equal(wahlen(attrappe, callId).length, EINMAL);
});

test("3365-K18: cancel_call nach dem Abheben -> das Bein wird aufgelegt", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await starteUndHebeAb();
  const abbruch = await abrufMitFrist(`${srv.localUrl}/api/calls/${callId}/cancel`, { method: "POST" });
  assert.equal(abbruch.status, HTTP_OK);
  await waitUntil(() => aktionen(attrappe, beine(callId).callee, "hangup").length === EINMAL);
});

test("3365-K23: keine Geheimnisse in Anfragepfaden, Webhook-URLs und Log", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await starteUndHebeAb();
  const call = anrufIn(callId);
  const audioToken = audioPfad(callId).replace("/voice/tts/", "");
  const geheimnisse = [SIP_PASSWORT, TELNYX_KEY, EL_KEY, call.streamToken, EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN];
  for (const anfrage of attrappe.anfragen)
    for (const geheimnis of geheimnisse) assert.ok(!anfrage.path.includes(geheimnis), `Geheimnis im Pfad ${anfrage.path}`);
  for (const wahl of wahlen(attrappe, callId)) {
    const feld = koerper(wahl);
    for (const url of [feld.webhook_url, feld.to])
      for (const geheimnis of geheimnisse) assert.ok(!url.includes(geheimnis), `Geheimnis in ${url}`);
  }
  for (const geheimnis of [...geheimnisse, audioToken]) assert.ok(!srv.stdout.includes(geheimnis), "Geheimnis im Log");
});

test("3365-K1: ohne Weg ueber Telnyx geht der Anruf unveraendert ueber den ElevenLabs-SIP-Trunk, ohne Vorspann und ohne Wahl", async () => {
  const { attrappe } = umgebung;
  const srv = await startServer(serverEinstellungen({ ELEVENLABS_OUTBOUND_UEBER_TELNYX: "false" }));
  try {
    const startsVorher = nachPfad(attrappe, EL_START_PFAD).length;
    const ttsVorher = ttsAnfragen(attrappe).length;
    const wahlVorher = nachPfad(attrappe, WAHL_PFAD).length;
    const antwort = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: naechsteNummer(), objective: OBJECTIVE }),
    });
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    assert.equal(nachPfad(attrappe, EL_START_PFAD).length, startsVorher + EINMAL);
    assert.equal(ttsAnfragen(attrappe).length, ttsVorher);
    assert.equal(nachPfad(attrappe, WAHL_PFAD).length, wahlVorher);
    const call = srv.readStore().calls.find((eintrag) => eintrag.id === callId);
    assert.equal(call.twilioSid, null);
    assert.equal(call.callControlId, null);
  } finally {
    await srv.stop();
  }
});
