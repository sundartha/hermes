import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";

import { OWNER_TEST_FIRST_NAME, makeTelnyxSigner, nowSeconds, seedCall, seedState, startServer, warteAufEreignis } from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_SERVER_FEHLER = 500;
const WARTE_FRIST_MS = 8_000;
const WIEDERGABE_FRIST_MS = 1_500;
const NUMMER_PRAEFIX = "+4915112590";
const AUDIO_BYTES = 200_000;
const STATUS_LAENGE_MAX = 48;
const GRUND = "vorspann_nicht_abgespielt";

const warteAuf = (bedingung) => warteAufEreignis([umgebung.srv.ereignisse, umgebung.attrappe.ereignisse], bedingung, { timeoutMs: WARTE_FRIST_MS });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
const aktionen = (bein, aktion) => umgebung.attrappe.anfragen.filter((anfrage) => anfrage.path === `/v2/calls/${bein}/actions/${aktion}`);
const aufleger = (callId) => [aktionen(calleeVon(callId), "hangup").length, aktionen(elVon(callId), "hangup").length].join();

function beantworte({ req, res }, anfrage, steuerung) {
  if (req.url.startsWith("/v1/text-to-speech/")) {
    res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
    return res.end(Buffer.alloc(AUDIO_BYTES, 1));
  }
  if (steuerung.wiedergabeFehler && req.url.endsWith("/actions/playback_start")) {
    res.writeHead(HTTP_SERVER_FEHLER, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errors: [{ code: "99", title: "Fehler" }] }));
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  if (req.url === "/v2/calls") {
    const kennung = koerper(anfrage).command_id.replace(/^vorspann-/, "").replace(/-el$/, "");
    const bein = koerper(anfrage).command_id.endsWith("-el") ? elVon(kennung) : calleeVon(kennung);
    return res.end(JSON.stringify({ data: { call_control_id: bein } }));
  }
  res.end(JSON.stringify({ data: { sid: "v3:ob-5902", result: "ok" } }));
}

async function starteAttrappe() {
  const anfragen = [];
  const ereignisse = new EventEmitter();
  const steuerung = {};
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      const anfrage = { method: req.method, path: req.url, roh };
      anfragen.push(anfrage);
      ereignisse.emit("aenderung");
      beantworte({ req, res }, anfrage, steuerung);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    anfragen,
    ereignisse,
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
    ...elInboundInitSpawnEnv("agent_5902_ursache"),
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    TELNYX_CALL_CONTROL_APP_ID: "cc_app_5902",
    ELEVENLABS_API_KEY: "test-key-5902",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_5902",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: "KEYtest-5902",
    TELNYX_CONNECTION_ID: "conn_5902",
    TELNYX_ACCOUNT_SID: "acct_5902",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
    PUBLIC_URL: "https://agent.test",
    VORSPANN_WIEDERGABE_FRIST_MS: String(WIEDERGABE_FRIST_MS),
  };
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  umgebung.srv = await startServer({ env, seed });
});

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

let zaehler = 0;
const anrufIn = (id) => {
  const { calls } = umgebung.srv.readStore();
  return calls.find((eintrag) => eintrag.id === id);
};
const zeile = (callId, ursache) => `[el-vorspann] rueckfall grund=${GRUND} call=${callId} ursache=${ursache}`;

function sende(callId, typ, { status, bein = calleeVon(callId) } = {}) {
  const payload = { call_control_id: bein, ...(status === undefined ? {} : { status }) };
  const roh = JSON.stringify({ data: { id: `evt-5902-${(zaehler += 1)}`, event_type: typ, payload } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

async function abgehobenerAnruf() {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: `${NUMMER_PRAEFIX}${String((zaehler += 1)).padStart(3, "0")}`, objective: "Termin am Donnerstag vereinbaren" }),
  });
  const { callId } = await antwort.json();
  assert.equal((await sende(callId, "call.answered")).status, HTTP_OK);
  return callId;
}

const verarbeitet = () => abrufMitFrist(`${umgebung.srv.localUrl}/healthz`);

async function pruefeRueckfall(callId, ursache) {
  await warteAuf(() => aufleger(callId) === "1,1");
  assert.ok(umgebung.srv.stdout.includes(zeile(callId, ursache)), `Logzeile mit ursache=${ursache} fehlt`);
}

test("5902-K1: abgelehnter playback_start -> ursache=start_abgelehnt, beide Beine aufgelegt", async () => {
  umgebung.attrappe.steuerung.wiedergabeFehler = true;
  const callId = await abgehobenerAnruf();
  await pruefeRueckfall(callId, "start_abgelehnt");
});

test("5902-K2: kein playback.ended binnen der Frist -> ursache=kein_ende_ereignis, beide Beine aufgelegt", async () => {
  const callId = await abgehobenerAnruf();
  await pruefeRueckfall(callId, "kein_ende_ereignis");
  await warteAuf(() => anrufIn(callId).failureReason === GRUND);
  assert.equal(anrufIn(callId).failureReason, GRUND);
});

for (const [name, status, ursache] of [
  ["failed", "failed", "status_failed"],
  ["Status fehlt", undefined, "status_null"],
  ["erlaubte Sonderzeichen bleiben", "a.b:c-d_E9", "status_a.b:c-d_E9"],
  ["unerlaubte Zeichen werden ersetzt", "x y/z!", "status_x_y_z_"],
  ["Laenge auf 48 begrenzt", "a".repeat(STATUS_LAENGE_MAX + 12), `status_${"a".repeat(STATUS_LAENGE_MAX)}`],
]) {
  test(`5902-K3: playback.ended mit ${name} -> ${ursache}, beide Beine aufgelegt`, async () => {
    const callId = await abgehobenerAnruf();
    await warteAuf(() => aktionen(calleeVon(callId), "playback_start").length === 1);
    await warteAuf(() => umgebung.attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && anfrage.roh.includes(`vorspann-${callId}-el`)));
    await verarbeitet();
    await sende(callId, "call.playback.ended", { status });
    await pruefeRueckfall(callId, ursache);
  });
}

test("5902-K4: Rueckfall ohne Ursache (EL-Bein nicht angenommen) bleibt ohne ursache-Feld", async () => {
  const callId = await abgehobenerAnruf();
  await warteAuf(() => umgebung.attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && anfrage.roh.includes(`vorspann-${callId}-el`)));
  await verarbeitet();
  await sende(callId, "call.hangup", { bein: elVon(callId) });
  const zeileOhne = `[el-vorspann] rueckfall grund=el_nicht_angenommen call=${callId}\n`;
  await warteAuf(() => umgebung.srv.stdout.includes(zeileOhne));
  assert.ok(umgebung.srv.stdout.includes(zeileOhne));
});
