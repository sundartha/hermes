import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

import { EL_INBOUND_ACCESS_BOOT_ENV, OWNER_TEST_FIRST_NAME, makeTelnyxSigner, nowSeconds, seedCall, seedState, startServer, waitUntil as wartebis } from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echtWarten } from "../echt-warten.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVER_FEHLER = 500;
const WARTE_FRIST_MS = 5_000;
const EINMAL = 1;
const ZWEIMAL = 2;
const NUMMER_PRAEFIX = "+4915112391";
const AUDIO_BYTES = 200_000;
const KENNUNG = "ob-3365-grenzfall";
const GRUND = "el_uebergabe_gescheitert";
const NUR_LESEN = 0o555;
const SCHREIBBAR = 0o755;
const NIE = 0;
const RUHE_MS = 150;

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const istEl = (anfrage) => koerper(anfrage).command_id.endsWith("-el");
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
const aktionen = (attrappe, bein, aktion) => attrappe.anfragen.filter((anfrage) => anfrage.path === `/v2/calls/${bein}/actions/${aktion}`);
const fehler = (res, status) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ errors: [{ code: "99", title: "Fehler" }] }));
};

const antworteOk = (res) => {
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: { result: "ok" } }));
};

function beantworteFehler({ req, res }, anfrage, steuerung) {
  const elWahl = req.url === "/v2/calls" && istEl(anfrage);
  if (elWahl && steuerung.elFehler) fehler(res, HTTP_UNPROCESSABLE);
  else if (steuerung.wiedergabeFehler && req.url.endsWith("/actions/playback_start")) fehler(res, HTTP_SERVER_FEHLER);
  else if (elWahl && steuerung.elTorOffen) steuerung.elTorOffen.then(() => fehler(res, HTTP_UNPROCESSABLE));
  else if (steuerung.auflegTor && req.url.endsWith("/actions/hangup")) steuerung.auflegTor.then(() => antworteOk(res));
  else return false;
  return true;
}

function beantworte({ req, res }, anfrage, steuerung) {
  if (req.url.startsWith("/v1/text-to-speech/")) {
    res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
    return res.end(Buffer.alloc(AUDIO_BYTES, 1));
  }
  if (beantworteFehler({ req, res }, anfrage, steuerung)) return;
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  if (req.url === "/v2/calls") {
    const kennung = koerper(anfrage).command_id.replace(/^vorspann-/, "").replace(/-el$/, "");
    return res.end(JSON.stringify({ data: { call_control_id: istEl(anfrage) ? elVon(kennung) : calleeVon(kennung) } }));
  }
  res.end(JSON.stringify({ data: { sid: `v3:${KENNUNG}`, result: "ok" } }));
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
    ...elInboundInitSpawnEnv("agent_3365_grenzfall"),
    ...EL_INBOUND_ACCESS_BOOT_ENV,
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    TELNYX_CALL_CONTROL_APP_ID: "cc_app_3365_grenzfall",
    ELEVENLABS_API_KEY: "test-key-3365",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3365_grenzfall",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: "KEYtest-3365",
    TELNYX_CONNECTION_ID: "conn_3365",
    TELNYX_ACCOUNT_SID: "acct_3365",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
    PUBLIC_URL: "https://agent.test",
  };
  umgebung.srv = await startServer({ env, seed: seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] }) });
});

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

let zaehler = 0;
const speicher = () => umgebung.srv.readStore();
const anrufIn = (id) => speicher().calls.find((eintrag) => eintrag.id === id);
const elFehlerLog = (callId) => `[el-vorspann] rueckfall grund=el_fehler call=${callId}`;

function sendeAngenommen(callId) {
  const roh = JSON.stringify({ data: { id: `evt-grenzfall-${(zaehler += EINMAL)}`, event_type: "call.answered", payload: { call_control_id: calleeVon(callId) } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

async function neuerAnruf() {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: `${NUMMER_PRAEFIX}${String((zaehler += EINMAL)).padStart(3, "0")}`, objective: "Termin am Donnerstag vereinbaren" }),
  });
  return (await antwort.json()).callId;
}

test("3365-G1: Wiedergabe scheitert, EL-Bein steht -> beide Beine aufgelegt, kein Vermerk el_fehler", async () => {
  const { attrappe, srv } = umgebung;
  attrappe.steuerung.wiedergabeFehler = true;
  const callId = await neuerAnruf();
  await sendeAngenommen(callId);
  await waitUntil(() => aktionen(attrappe, elVon(callId), "hangup").length === EINMAL);
  await waitUntil(() => aktionen(attrappe, calleeVon(callId), "hangup").length === EINMAL);
  delete attrappe.steuerung.wiedergabeFehler;
  assert.ok(!srv.stdout.includes(elFehlerLog(callId)));
  assert.notEqual(anrufIn(callId).failureReason, GRUND);
  assert.equal(anrufIn(callId).elFallbackAt, null);
});

test("3365-G2: Anruf abgebrochen, dann scheitert das EL-Wahl -> Status cancelled, kein Vermerk el_fehler", async () => {
  const { attrappe, srv } = umgebung;
  let oeffne;
  attrappe.steuerung.elTorOffen = new Promise((resolve) => (oeffne = resolve));
  const callId = await neuerAnruf();
  await sendeAngenommen(callId);
  await waitUntil(() => attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage) && anfrage.roh.includes(callId)));
  const abbruch = await abrufMitFrist(`${srv.localUrl}/api/calls/${callId}/cancel`, { method: "POST" });
  assert.equal(abbruch.status, HTTP_OK);
  oeffne();
  await waitUntil(() => aktionen(attrappe, calleeVon(callId), "hangup").length >= ZWEIMAL);
  delete attrappe.steuerung.elTorOffen;
  assert.equal(anrufIn(callId).status, "cancelled");
  assert.ok(!anrufIn(callId).failureReason);
  assert.equal(anrufIn(callId).elFallbackAt, null);
  assert.ok(!srv.stdout.includes(elFehlerLog(callId)));
});

const vorkommen = (text, teil) => text.split(teil).length - EINMAL;
const wiedergabeFehlerLog = (callId) => `[el-vorspann] rueckfall grund=vorspann_nicht_abgespielt call=${callId}`;
const anrufUndAnnahme = async () => {
  const callId = await neuerAnruf();
  await sendeAngenommen(callId);
  return callId;
};

function sende(callId, typ, bein = calleeVon(callId)) {
  const roh = JSON.stringify({ data: { id: `evt-grenzfall-${(zaehler += EINMAL)}`, event_type: typ, payload: { call_control_id: bein, status: "completed" } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

async function benachrichtigungen(callId) {
  const { notifications } = await (await abrufMitFrist(`${umgebung.srv.localUrl}/api/state`)).json();
  return notifications.filter((eintrag) => eintrag.callId === callId).map((eintrag) => eintrag.title);
}

async function mitElFehler(run) {
  umgebung.attrappe.steuerung.elFehler = true;
  try {
    return await run();
  } finally {
    delete umgebung.attrappe.steuerung.elFehler;
  }
}

test("3365-A1: EL-dial scheitert -> Logzeile el_fehler einmal, Grund und Zeitpunkt vermerkt, beide Beine aufgelegt, keine Bruecke", async () => {
  const { attrappe, srv } = umgebung;
  const davor = Date.now();
  const callId = await mitElFehler(async () => {
    const id = await anrufUndAnnahme();
    await waitUntil(() => aktionen(attrappe, calleeVon(id), "hangup").length === EINMAL);
    await waitUntil(() => anrufIn(id).failureReason === GRUND);
    return id;
  });
  const danach = Date.now();
  assert.equal(vorkommen(srv.stdout, elFehlerLog(callId)), EINMAL);
  const zeitpunkt = anrufIn(callId).elFallbackAt;
  assert.equal(new Date(zeitpunkt).toISOString(), zeitpunkt);
  assert.ok(Date.parse(zeitpunkt) >= davor && Date.parse(zeitpunkt) <= danach);
  assert.equal(aktionen(attrappe, calleeVon(callId), "bridge").length, NIE);
  assert.equal(aktionen(attrappe, elVon(callId), "hangup").length, NIE);
});

test("3365-A5: Speicher scheitert beim Vermerk der EL-Wahl -> Fehler im Log, Angerufener trotzdem aufgelegt", async () => {
  const { attrappe, srv } = umgebung;
  let oeffne;
  attrappe.steuerung.elTorOffen = new Promise((resolve) => (oeffne = resolve));
  const callId = await anrufUndAnnahme();
  await waitUntil(() => attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage) && anfrage.roh.includes(callId)));
  fs.chmodSync(srv.dataDir, NUR_LESEN);
  try {
    oeffne();
    await waitUntil(() => aktionen(attrappe, calleeVon(callId), "hangup").length === EINMAL);
    await waitUntil(() => srv.stdout.includes(`[el-vorspann] vermerk fehlgeschlagen call=${callId}:`));
  } finally {
    fs.chmodSync(srv.dataDir, SCHREIBBAR);
    delete attrappe.steuerung.elTorOffen;
  }
  assert.equal(aktionen(attrappe, calleeVon(callId), "bridge").length, NIE);
});

test("3365-B1: EL-Bein legt vor der Bruecke auf -> Vermerk el_fehler mit Zeitpunkt", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await anrufUndAnnahme();
  await waitUntil(() => attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage) && anfrage.roh.includes(callId)));
  await sende(callId, "call.hangup", elVon(callId));
  await waitUntil(() => srv.stdout.includes(elFehlerLog(callId)));
  await waitUntil(() => anrufIn(callId).failureReason === GRUND);
  assert.ok(anrufIn(callId).elFallbackAt);
});

test("3365-B2: Angerufener legt vor der Bruecke auf -> kein Vermerk, EL-Bein aufgelegt", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await anrufUndAnnahme();
  await waitUntil(() => attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage) && anfrage.roh.includes(callId)));
  await sende(callId, "call.hangup");
  await waitUntil(() => aktionen(attrappe, elVon(callId), "hangup").length === EINMAL);
  await waitUntil(() => anrufIn(callId).status === "completed");
  assert.equal(anrufIn(callId).elFallbackAt, null);
  assert.ok(!srv.stdout.includes(elFehlerLog(callId)));
});

test("3365-B4: Wiedergabe scheitert, danach legt das EL-Bein auf -> kein Vermerk", async () => {
  const { attrappe, srv } = umgebung;
  attrappe.steuerung.wiedergabeFehler = true;
  const callId = await anrufUndAnnahme();
  await waitUntil(() => aktionen(attrappe, elVon(callId), "hangup").length === EINMAL);
  delete attrappe.steuerung.wiedergabeFehler;
  await sende(callId, "call.hangup", elVon(callId));
  await waitUntil(() => anrufIn(callId).status !== "active");
  assert.equal(anrufIn(callId).elFallbackAt, null);
  assert.ok(!srv.stdout.includes(elFehlerLog(callId)));
});

test("3365-C1: Bruecke steht, Angerufener legt auf -> completed und keine Fehlermeldung", async () => {
  const { attrappe } = umgebung;
  const callId = await anrufUndAnnahme();
  await waitUntil(() => aktionen(attrappe, calleeVon(callId), "playback_start").length === EINMAL);
  await waitUntil(() => attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage) && anfrage.roh.includes(callId)));
  await sende(callId, "call.playback.ended");
  await sende(callId, "call.answered", elVon(callId));
  await waitUntil(() => aktionen(attrappe, calleeVon(callId), "bridge").length === EINMAL);
  await sende(callId, "call.hangup");
  await waitUntil(() => anrufIn(callId).status === "completed");
  assert.equal(anrufIn(callId).elFallbackAt, null);
  await echtWarten(RUHE_MS);
  assert.ok(!(await benachrichtigungen(callId)).includes("Call did not connect"));
});

test("3365-C3: Auflegen ohne vorheriges Abheben -> failed mit Grund no-answer, kein Vermerk", async () => {
  const callId = await neuerAnruf();
  await sende(callId, "call.hangup");
  await waitUntil(() => anrufIn(callId).status === "failed");
  assert.equal(anrufIn(callId).elFallbackAt, null);
  assert.notEqual(anrufIn(callId).failureReason, GRUND);
  assert.ok(anrufIn(callId).failureReason);
});

test("3365-Db: Wiedergabe scheitert, EL-Wahl gelingt -> nur Logzeile vorspann_nicht_abgespielt", async () => {
  const { attrappe, srv } = umgebung;
  attrappe.steuerung.wiedergabeFehler = true;
  const callId = await anrufUndAnnahme();
  await waitUntil(() => aktionen(attrappe, elVon(callId), "hangup").length === EINMAL);
  delete attrappe.steuerung.wiedergabeFehler;
  assert.equal(vorkommen(srv.stdout, wiedergabeFehlerLog(callId)), EINMAL);
  assert.equal(vorkommen(srv.stdout, elFehlerLog(callId)), NIE);
});

test("3365-Dc: Wiedergabe und EL-Wahl scheitern -> beide Logzeilen je einmal, ein Vermerk, Angerufener aufgelegt", async () => {
  const { attrappe, srv } = umgebung;
  attrappe.steuerung.wiedergabeFehler = true;
  const callId = await mitElFehler(async () => {
    const id = await anrufUndAnnahme();
    await waitUntil(() => anrufIn(id).failureReason === GRUND);
    await waitUntil(() => aktionen(attrappe, calleeVon(id), "hangup").length === EINMAL);
    return id;
  });
  delete attrappe.steuerung.wiedergabeFehler;
  assert.equal(vorkommen(srv.stdout, wiedergabeFehlerLog(callId)), EINMAL);
  assert.equal(vorkommen(srv.stdout, elFehlerLog(callId)), EINMAL);
});

const abgerechnet = (callId) => Boolean(anrufIn(callId).billedAt);
const logZeileMit = (callId, aktion) => `[el-vorspann] ${aktion} fehlgeschlagen call=${callId}:`;

async function elLegtAufBeiGesperrtemSpeicher() {
  const { attrappe, srv } = umgebung;
  let oeffne;
  attrappe.steuerung.auflegTor = new Promise((resolve) => (oeffne = resolve));
  const callId = await anrufUndAnnahme();
  await waitUntil(() => attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage) && anfrage.roh.includes(callId)));
  fs.chmodSync(srv.dataDir, NUR_LESEN);
  try {
    await sende(callId, "call.hangup", elVon(callId));
    await waitUntil(() => aktionen(attrappe, calleeVon(callId), "hangup").length === EINMAL);
  } finally {
    fs.chmodSync(srv.dataDir, SCHREIBBAR);
    oeffne();
    delete attrappe.steuerung.auflegTor;
  }
  return callId;
}

test("3365-V3: EL-Bein legt vor der Bruecke auf, Vermerk scheitert -> Fehler vermerk im Log, Angerufener aufgelegt, einmal abgerechnet", async () => {
  const { srv } = umgebung;
  const callId = await elLegtAufBeiGesperrtemSpeicher();
  await waitUntil(() => abgerechnet(callId));
  assert.equal(vorkommen(srv.stdout, logZeileMit(callId, "vermerk")), EINMAL);
  assert.equal(aktionen(umgebung.attrappe, calleeVon(callId), "hangup").length, EINMAL);
});

test("3365-V4: EL-Bein legt vor der Bruecke auf, Speichern des Endes scheitert -> Fehler ende im Log, Angerufener trotzdem aufgelegt, einmal abgerechnet", async () => {
  const { srv } = umgebung;
  const callId = await elLegtAufBeiGesperrtemSpeicher();
  assert.equal(vorkommen(srv.stdout, logZeileMit(callId, "ende")), EINMAL);
  await waitUntil(() => abgerechnet(callId));
  assert.equal(vorkommen(srv.stdout, `[el-vorspann] ereignis fehlgeschlagen call=${callId}:`), NIE);
});

test("3365-V5: Angerufener legt nach der Bruecke auf -> kein Vermerk, EL-Bein aufgelegt, einmal abgerechnet", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await anrufUndAnnahme();
  await waitUntil(() => attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage) && anfrage.roh.includes(callId)));
  await sende(callId, "call.playback.ended");
  await sende(callId, "call.answered", elVon(callId));
  await waitUntil(() => aktionen(attrappe, calleeVon(callId), "bridge").length === EINMAL);
  await sende(callId, "call.hangup");
  await waitUntil(() => aktionen(attrappe, elVon(callId), "hangup").length === EINMAL);
  await waitUntil(() => abgerechnet(callId));
  assert.ok(!srv.stdout.includes(elFehlerLog(callId)));
  assert.ok(!srv.stdout.includes(logZeileMit(callId, "vermerk")));
});
