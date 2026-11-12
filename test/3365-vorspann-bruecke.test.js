import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";

import { OWNER_TEST_FIRST_NAME, makeTelnyxSigner, nowSeconds, seedCall, seedState, startServer, waitUntil as wartebis } from "./helpers.js";
import { elInboundInitSpawnEnv } from "./_iel-inbound-harness.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { echtWarten } from "./echt-warten.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_SERVER_FEHLER = 500;
const WARTE_FRIST_MS = 5_000;
const RUHE_MS = 150;
const NUMMER_PRAEFIX = "+4915112380";
const EINMAL = 1;
const AUDIO_BYTES = 200_000;
const APP_ID = "cc_app_3365_3a";
const PUBLIC_URL = "https://agent.test";
const FERTIG = "completed";
const READ_ONLY_DIR = 0o500;
const WRITABLE_DIR = 0o700;

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
  if ((steuerung.bridgeFehler && req.url.endsWith("/actions/bridge")) || (steuerung.wiedergabeFehler && req.url.endsWith("/actions/playback_start"))) {
    res.writeHead(HTTP_SERVER_FEHLER, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errors: [{ code: "99", title: "Fehler" }] }));
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  if (req.url === "/v2/calls") {
    const kennung = koerper(anfrage).command_id.replace(/^vorspann-/, "").replace(/-el$/, "");
    return res.end(JSON.stringify({ data: { call_control_id: istEl(anfrage) ? elVon(kennung) : calleeVon(kennung) } }));
  }
  res.end(JSON.stringify({ data: { sid: "v3:ob-3365-3a", result: "ok" } }));
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
    ...elInboundInitSpawnEnv("agent_3365_h3a"),
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    TELNYX_CALL_CONTROL_APP_ID: APP_ID,
    ELEVENLABS_API_KEY: "test-key-3365",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3365_3a",
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
const wahlLogs = () => server().stdout.split("dialCallControl ok").length;
const abbrechen = (callId) => abrufMitFrist(`${server().localUrl}/api/calls/${callId}/cancel`, { method: "POST" });

function sende(callId, typ, { bein = calleeVon(callId), status } = {}) {
  const payload = { call_control_id: bein, ...(status ? { status } : {}) };
  const roh = JSON.stringify({ data: { id: `evt-3a-${(zaehler += EINMAL)}`, event_type: typ, payload } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}
const wiedergabeEnde = (callId, status, bein) => sende(callId, "call.playback.ended", { bein, status });
const elAngenommen = (callId) => sende(callId, "call.answered", { bein: elVon(callId) });

async function angenommenerAnruf() {
  const vorher = wahlLogs();
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: `${NUMMER_PRAEFIX}${String((zaehler += EINMAL)).padStart(3, "0")}`, objective: "Termin am Donnerstag vereinbaren" }),
  });
  const { callId } = await antwort.json();
  assert.equal((await sende(callId, "call.answered")).status, HTTP_OK);
  await waitUntil(() => aktionen(umgebung.attrappe, calleeVon(callId), "playback_start").length === EINMAL);
  await waitUntil(() => wahlLogs() - vorher >= 2);
  return callId;
}

const wartenAufBruecke = (callId) => waitUntil(() => bruecken(umgebung.attrappe, callId).length === EINMAL);

test("3365-K13: Wiedergabe fertig, dann EL angenommen -> genau eine Bruecke zum EL-Bein, bridgedAt gesetzt", async () => {
  const callId = await angenommenerAnruf();
  await wiedergabeEnde(callId, FERTIG);
  await echtWarten(RUHE_MS);
  assert.equal(bruecken(umgebung.attrappe, callId).length, 0);
  await elAngenommen(callId);
  await wartenAufBruecke(callId);
  assert.deepEqual(koerper(bruecken(umgebung.attrappe, callId)[0]), { call_control_id: elVon(callId) });
  await waitUntil(() => anrufIn(callId).bridgedAt);
  assert.deepEqual(aufleger(umgebung.attrappe, callId), [0, 0]);
});

test("3365-K13: EL angenommen, dann Wiedergabe fertig -> genau eine Bruecke, Wiederholungen bruecken nicht erneut", async () => {
  const callId = await angenommenerAnruf();
  await elAngenommen(callId);
  await echtWarten(RUHE_MS);
  assert.equal(bruecken(umgebung.attrappe, callId).length, 0);
  await wiedergabeEnde(callId, FERTIG);
  await wartenAufBruecke(callId);
  await wiedergabeEnde(callId, FERTIG);
  await elAngenommen(callId);
  await echtWarten(RUHE_MS);
  assert.equal(bruecken(umgebung.attrappe, callId).length, EINMAL);
});

test("3365-K13: Ereignisse mit fremder Kennung zaehlen nicht, keine Bruecke", async () => {
  const callId = await angenommenerAnruf();
  await wiedergabeEnde(callId, FERTIG, "cc_fremd");
  await sende(callId, "call.answered", { bein: "cc_fremd" });
  await echtWarten(RUHE_MS);
  await wiedergabeEnde(callId, FERTIG, elVon(callId));
  await echtWarten(RUHE_MS);
  assert.equal(bruecken(umgebung.attrappe, callId).length, 0);
  assert.equal(anrufIn(callId).bridgedAt, undefined);
});

for (const [name, status, logStatus] of [
  ["anderer Status", "file_not_found", "file_not_found"],
  ["Status fehlt", undefined, "null"],
]) {
  test(`3365-K14: Wiedergabe-Ende mit ${name} -> keine Bruecke, beide Beine aufgelegt, auch nicht nach EL angenommen`, async () => {
    const callId = await angenommenerAnruf();
    await wiedergabeEnde(callId, status);
    await waitUntil(() => aufleger(umgebung.attrappe, callId).join() === "1,1");
    await elAngenommen(callId);
    await echtWarten(RUHE_MS);
    assert.equal(bruecken(umgebung.attrappe, callId).length, 0);
    assert.ok(umgebung.srv.stdout.includes(`[el-vorspann] wiedergabe fehlgeschlagen call=${callId}: Status ${logStatus}`));
    assert.ok(umgebung.srv.stdout.includes(`[el-vorspann] rueckfall grund=vorspann_nicht_abgespielt call=${callId}`));
  });
}

test("3365-K14: HTTP-Fehler bei playback_start -> keine Bruecke, beide Beine aufgelegt, Logzeile vorspann_nicht_abgespielt", async () => {
  const vorher = wahlLogs();
  umgebung.attrappe.steuerung.wiedergabeFehler = true;
  let callId;
  try {
    const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: `${NUMMER_PRAEFIX}${String((zaehler += EINMAL)).padStart(3, "0")}`, objective: "Termin am Donnerstag vereinbaren" }),
    });
    callId = (await antwort.json()).callId;
    await sende(callId, "call.answered");
    await waitUntil(() => aufleger(umgebung.attrappe, callId).join() === "1,1");
  } finally {
    delete umgebung.attrappe.steuerung.wiedergabeFehler;
  }
  assert.ok(wahlLogs() > vorher);
  await elAngenommen(callId);
  await echtWarten(RUHE_MS);
  assert.equal(bruecken(umgebung.attrappe, callId).length, 0);
  assert.ok(umgebung.srv.stdout.includes(`[el-vorspann] rueckfall grund=vorspann_nicht_abgespielt call=${callId}`));
});

test("3365-K14: Bruecke scheitert -> beide Beine aufgelegt, kein bridgedAt", async () => {
  const callId = await angenommenerAnruf();
  umgebung.attrappe.steuerung.bridgeFehler = true;
  try {
    await wiedergabeEnde(callId, FERTIG);
    await elAngenommen(callId);
    await waitUntil(() => aufleger(umgebung.attrappe, callId).join() === "1,1");
  } finally {
    delete umgebung.attrappe.steuerung.bridgeFehler;
  }
  assert.equal(anrufIn(callId).bridgedAt, undefined);
  assert.ok(umgebung.srv.stdout.includes(`[el-vorspann] bruecke fehlgeschlagen call=${callId}:`));
});

test("3365-K13: nach cancel_call wird nicht mehr gebrueckt", async () => {
  const callId = await angenommenerAnruf();
  assert.equal((await abbrechen(callId)).status, HTTP_OK);
  await waitUntil(() => aufleger(umgebung.attrappe, callId).join() === "1,1");
  await wiedergabeEnde(callId, FERTIG);
  await elAngenommen(callId);
  await echtWarten(RUHE_MS);
  assert.equal(bruecken(umgebung.attrappe, callId).length, 0);
});

async function gebrueckterAnruf() {
  const callId = await angenommenerAnruf();
  await wiedergabeEnde(callId, FERTIG);
  await elAngenommen(callId);
  await wartenAufBruecke(callId);
  return callId;
}

test("3365-K19: nach der Bruecke legt der Angerufene auf -> EL-Bein aufgelegt, Anruf completed und abgerechnet", async () => {
  const callId = await gebrueckterAnruf();
  await sende(callId, "call.hangup");
  await waitUntil(() => aufleger(umgebung.attrappe, callId).join() === "0,1");
  await waitUntil(() => anrufIn(callId).status === "completed" && anrufIn(callId).billedAt);
  assert.ok(!anrufIn(callId).failureReason);
});

test("3365-K19: nach der Bruecke legt das EL-Bein auf -> Angerufener aufgelegt, Anruf completed und abgerechnet", async () => {
  const callId = await gebrueckterAnruf();
  await sende(callId, "call.hangup", { bein: elVon(callId) });
  await waitUntil(() => aufleger(umgebung.attrappe, callId).join() === "1,0");
  await waitUntil(() => anrufIn(callId).status === "completed" && anrufIn(callId).billedAt);
  assert.ok(!anrufIn(callId).failureReason);
  await sende(callId, "call.hangup");
  await echtWarten(RUHE_MS);
  assert.deepEqual(aufleger(umgebung.attrappe, callId), [1, 0]);
});

test("3523: scheitert der Vermerk des Transkripts nach vollstaendiger Wiedergabe -> beide Beine aufgelegt, keine Bruecke, Fehler im Log", async () => {
  const callId = await angenommenerAnruf();
  await elAngenommen(callId);
  fs.chmodSync(umgebung.srv.dataDir, READ_ONLY_DIR);
  try {
    await wiedergabeEnde(callId, FERTIG);
    await waitUntil(() => aufleger(umgebung.attrappe, callId).join() === "1,1");
    await waitUntil(() => umgebung.srv.stdout.includes(`[el-vorspann] transkript fehlgeschlagen call=${callId}:`));
  } finally {
    fs.chmodSync(umgebung.srv.dataDir, WRITABLE_DIR);
  }
  assert.equal(bruecken(umgebung.attrappe, callId).length, 0);
});
