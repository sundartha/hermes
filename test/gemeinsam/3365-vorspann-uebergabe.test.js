import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

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
const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVER_FEHLER = 500;
const WARTE_FRIST_MS = 5_000;
const RUHE_MS = 150;
const POLL_MS = 10;
const POLL_VERSUCHE = 300;
const NUMMER_PRAEFIX = "+4915112390";
const EINMAL = 1;
const AUDIO_BYTES = 200_000;
const APP_ID = "cc_app_3365_3b2a";
const PUBLIC_URL = "https://agent.test";
const FERTIG = "completed";
const GRUND = "el_uebergabe_gescheitert";
const FEHLER_DETAIL = "detail-el-geheimnis-3b2a";
const FEHLER_TITEL = "Call did not connect";
const SIP_ZUGANG = EL_INBOUND_ACCESS_BOOT_ENV;
const NUR_LESEN = 0o555;
const SCHREIBBAR = 0o755;

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const istEl = (anfrage) => koerper(anfrage).command_id.endsWith("-el");
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
const aktionen = (attrappe, bein, aktion) => attrappe.anfragen.filter((anfrage) => anfrage.path === `/v2/calls/${bein}/actions/${aktion}`);
const bruecken = (attrappe, callId) => aktionen(attrappe, calleeVon(callId), "bridge");
const aufleger = (attrappe, callId) => [aktionen(attrappe, calleeVon(callId), "hangup").length, aktionen(attrappe, elVon(callId), "hangup").length];

function beantworte({ req, res }, anfrage, steuerung) {
  if (req.url.startsWith("/v1/text-to-speech/")) {
    res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
    return res.end(Buffer.alloc(AUDIO_BYTES, 1));
  }
  if (steuerung.bridgeFehler && req.url.endsWith("/actions/bridge")) {
    res.writeHead(HTTP_SERVER_FEHLER, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errors: [{ code: "99", title: "Fehler" }] }));
  }
  if (steuerung.elFehler && req.url === "/v2/calls" && istEl(anfrage)) {
    res.writeHead(HTTP_UNPROCESSABLE, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errors: [{ code: "10015", title: "Invalid", detail: FEHLER_DETAIL }] }));
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
  const steuerung = {};
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      const anfrage = { method: req.method, path: req.url, roh };
      anfragen.push(anfrage);
      beantworte({ req, res }, anfrage, steuerung);
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

beforeEach(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...elInboundInitSpawnEnv("agent_3365_h3b2a"),
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    TELNYX_CALL_CONTROL_APP_ID: APP_ID,
    ELEVENLABS_API_KEY: "test-key-3365",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3365_3b2a",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: "KEYtest-3365",
    TELNYX_CONNECTION_ID: "conn_3365",
    TELNYX_ACCOUNT_SID: "acct_3365",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
    PUBLIC_URL,
  };
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  umgebung.srv = await startServer({ env, seed });
});

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

let zaehler = 0;
const server = () => umgebung.srv;
const anrufIn = (id) => server().readStore().calls.find((eintrag) => eintrag.id === id);
async function benachrichtigungen(callId) {
  const { notifications } = await (await abrufMitFrist(`${server().localUrl}/api/state`)).json();
  return notifications.filter((eintrag) => eintrag.callId === callId).map((eintrag) => eintrag.title);
}
async function ersteBenachrichtigungen(callId) {
  for (let versuch = 0; versuch < POLL_VERSUCHE; versuch += EINMAL) {
    const titel = await benachrichtigungen(callId);
    if (titel.length) return titel;
    await echtWarten(POLL_MS);
  }
  return [];
}
const wahlLogs = () => server().stdout.split("dialCallControl ok").length;
const abbrechen = (callId) => abrufMitFrist(`${server().localUrl}/api/calls/${callId}/cancel`, { method: "POST" });

function sende(callId, typ, { bein = calleeVon(callId), status } = {}) {
  const payload = { call_control_id: bein, ...(status ? { status } : {}) };
  const roh = JSON.stringify({ data: { id: `evt-3b2a-${(zaehler += EINMAL)}`, event_type: typ, payload } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}
const wiedergabeEnde = (callId) => sende(callId, "call.playback.ended", { status: FERTIG });
const elAngenommen = (callId) => sende(callId, "call.answered", { bein: elVon(callId) });
const elAufgelegt = (callId) => sende(callId, "call.hangup", { bein: elVon(callId) });
const gegenstelleAufgelegt = (callId) => sende(callId, "call.hangup");
const logZeile = (grund, callId) => `[el-vorspann] rueckfall grund=${grund} call=${callId}`;

async function neuerAnruf() {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: `${NUMMER_PRAEFIX}${String((zaehler += EINMAL)).padStart(3, "0")}`, objective: "Termin am Donnerstag vereinbaren" }),
  });
  return (await antwort.json()).callId;
}

async function angenommenerAnruf() {
  const vorher = wahlLogs();
  const callId = await neuerAnruf();
  assert.equal((await sende(callId, "call.answered")).status, HTTP_OK);
  await waitUntil(() => aktionen(umgebung.attrappe, calleeVon(callId), "playback_start").length === EINMAL);
  await waitUntil(() => wahlLogs() - vorher >= 2);
  return callId;
}

async function mitSteuerung(werte, run) {
  Object.assign(umgebung.attrappe.steuerung, werte);
  try {
    await run();
  } finally {
    for (const schluessel of Object.keys(werte)) delete umgebung.attrappe.steuerung[schluessel];
  }
}

async function gescheitertDurchBrueckenfehler() {
  const callId = await angenommenerAnruf();
  await mitSteuerung({ bridgeFehler: true }, async () => {
    await wiedergabeEnde(callId);
    await elAngenommen(callId);
    await waitUntil(() => aufleger(umgebung.attrappe, callId).join() === "1,1");
  });
  return callId;
}

test("3365-D1: HTTP-Fehler beim EL-dial -> Uebergabe vermerkt, Angerufener aufgelegt, keine Bruecke, Logzeile el_fehler", async () => {
  const { attrappe, srv } = umgebung;
  let callId;
  await mitSteuerung({ elFehler: true }, async () => {
    callId = await neuerAnruf();
    await sende(callId, "call.answered");
    await waitUntil(() => aktionen(attrappe, calleeVon(callId), "hangup").length === EINMAL);
    await waitUntil(() => srv.stdout.includes(logZeile("el_fehler", callId)));
  });
  await wiedergabeEnde(callId);
  await echtWarten(RUHE_MS);
  assert.equal(bruecken(attrappe, callId).length, 0);
  assert.equal(aktionen(attrappe, elVon(callId), "hangup").length, 0);
  await waitUntil(() => anrufIn(callId).failureReason === GRUND);
  assert.ok(anrufIn(callId).elFallbackAt);
});

test("3365-D1: EL-Bein legt vor der Bruecke auf -> Uebergabe vermerkt, Angerufener aufgelegt, keine Bruecke, Logzeile el_fehler", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await angenommenerAnruf();
  await elAufgelegt(callId);
  await waitUntil(() => aktionen(attrappe, calleeVon(callId), "hangup").length === EINMAL);
  await waitUntil(() => srv.stdout.includes(logZeile("el_fehler", callId)));
  await wiedergabeEnde(callId);
  await echtWarten(RUHE_MS);
  assert.equal(bruecken(attrappe, callId).length, 0);
  assert.deepEqual(aufleger(attrappe, callId), [1, 0]);
  await waitUntil(() => anrufIn(callId).status === "failed");
  assert.equal(anrufIn(callId).failureReason, GRUND);
});

test("3365-D1: EL-Bein legt nach der Bruecke auf -> nichts vermerkt, Anruf completed", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await angenommenerAnruf();
  await wiedergabeEnde(callId);
  await elAngenommen(callId);
  await waitUntil(() => bruecken(attrappe, callId).length === EINMAL);
  await elAufgelegt(callId);
  await waitUntil(() => anrufIn(callId).status === "completed");
  assert.ok(!anrufIn(callId).failureReason);
  assert.ok(!anrufIn(callId).elFallbackAt);
  assert.ok(!srv.stdout.includes(logZeile("el_fehler", callId)));
});

test("3365-D2: Fehler beim bridge -> Uebergabe vermerkt, beide Beine aufgelegt, Logzeile el_fehler", async () => {
  const callId = await gescheitertDurchBrueckenfehler();
  await waitUntil(() => umgebung.srv.stdout.includes(logZeile("el_fehler", callId)));
  await waitUntil(() => anrufIn(callId).failureReason === GRUND);
  assert.equal(anrufIn(callId).bridgedAt, undefined);
});

test("3365-D3: nach gescheiterter Uebergabe schickt das Auflegen die Fehlermeldung statt einer Zusammenfassung", async () => {
  const callId = await gescheitertDurchBrueckenfehler();
  await waitUntil(() => anrufIn(callId).failureReason === GRUND);
  await gegenstelleAufgelegt(callId);
  await waitUntil(() => anrufIn(callId).status === "failed");
  const titel = await ersteBenachrichtigungen(callId);
  assert.deepEqual(titel, [FEHLER_TITEL]);
  assert.equal(anrufIn(callId).failureReason, GRUND);
});

test("3365-D4: cancel_call und danach Auflegen des EL-Beins -> Status bleibt cancelled, keine gescheiterte Uebergabe", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await angenommenerAnruf();
  assert.equal((await abbrechen(callId)).status, HTTP_OK);
  await waitUntil(() => aufleger(attrappe, callId).join() === "1,1");
  await elAufgelegt(callId);
  await gegenstelleAufgelegt(callId);
  await echtWarten(RUHE_MS);
  assert.equal(anrufIn(callId).status, "cancelled");
  assert.ok(!anrufIn(callId).failureReason);
  assert.ok(!anrufIn(callId).elFallbackAt);
  assert.ok(!srv.stdout.includes(logZeile("el_fehler", callId)));
});

test("3365-D5: scheitert store.save() beim Vermerk der Bruecken-Uebergabe -> Fehler im Log, beide Beine trotzdem aufgelegt", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await angenommenerAnruf();
  await mitSteuerung({ bridgeFehler: true }, async () => {
    await wiedergabeEnde(callId);
    await waitUntil(() => anrufIn(callId).transcript.length > 0);
    fs.chmodSync(srv.dataDir, NUR_LESEN);
    try {
      await elAngenommen(callId);
      await waitUntil(() => aufleger(attrappe, callId).join() === "1,1");
      await waitUntil(() => srv.stdout.includes(`[el-vorspann] vermerk fehlgeschlagen call=${callId}:`));
    } finally {
      fs.chmodSync(srv.dataDir, SCHREIBBAR);
    }
  });
  assert.equal(bruecken(attrappe, callId).length, EINMAL);
});

test("3365-D6: keine Geheimnisse in Logzeilen und Antworten bei gescheiterter Uebergabe", async () => {
  const { attrappe, srv } = umgebung;
  let antworten;
  let callId;
  await mitSteuerung({ elFehler: true }, async () => {
    callId = await neuerAnruf();
    antworten = [await sende(callId, "call.answered"), await elAufgelegt(callId)];
    await waitUntil(() => srv.stdout.includes(logZeile("el_fehler", callId)));
  });
  const geheimnisse = [SIP_ZUGANG.ELEVENLABS_INBOUND_SIP_PASSWORD, anrufIn(callId).streamToken, FEHLER_DETAIL];
  for (const antwort of antworten) {
    const text = await antwort.text();
    for (const geheimnis of geheimnisse) assert.ok(!text.includes(geheimnis), "Geheimnis in der Antwort");
  }
  for (const geheimnis of geheimnisse) assert.ok(!srv.stdout.includes(geheimnis), "Geheimnis im Log");
  for (const anfrage of attrappe.anfragen)
    for (const geheimnis of geheimnisse) assert.ok(!anfrage.path.includes(geheimnis), `Geheimnis im Pfad ${anfrage.path}`);
});
