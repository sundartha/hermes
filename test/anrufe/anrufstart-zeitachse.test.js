import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";

import { EL_INBOUND_ACCESS_BOOT_ENV, OWNER_TEST_FIRST_NAME, makeTelnyxSigner, nowSeconds, seedCall, seedState, startServer, warteAufEreignis } from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const WARTE_FRIST_MS = 5_000;
const MINUTE_MS = 60_000;
const AGENT_ID = "agent_5987";
const APP_ID = "cc_app_5987";
const ZIEL = "+4915112359871";
const AUDIO_BYTES = 200_000;

const warteAuf = (bedingung) => warteAufEreignis([umgebung.srv.ereignisse, umgebung.attrappe.ereignisse], bedingung, { timeoutMs: WARTE_FRIST_MS });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const beinVon = (callId) => `cc_callee_${callId}`;
const aktionen = (attrappe) => attrappe.anfragen.filter((anfrage) => anfrage.path.includes("/actions/"));
const logZeilen = () => umgebung.srv.stdout.split("\n");
const zeile = (callId, messung) => logZeilen().find((text) => text.includes(`[el-vorspann] ${messung} `) && text.endsWith(`call=${callId}`));
const anrufListe = () => umgebung.srv.readStore().calls;
const anrufDaten = (callId) => anrufListe().find((eintrag) => eintrag.id === callId);

async function starteAttrappe() {
  const anfragen = [];
  const ereignisse = new EventEmitter();
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      anfragen.push({ path: req.url, roh });
      ereignisse.emit("aenderung");
      if (req.url.startsWith("/v1/text-to-speech/")) {
        res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
        return res.end(Buffer.alloc(AUDIO_BYTES, 1));
      }
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      const kennung = req.url === "/v2/calls" ? koerper(anfragen.at(-1)).command_id.replace(/^vorspann-/, "") : "x";
      res.end(JSON.stringify({ data: { call_control_id: beinVon(kennung), sid: "v3:ob-5987", result: "ok" } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    anfragen,
    ereignisse,
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
  umgebung.srv = await startServer({
    env: {
      ...elInboundInitSpawnEnv(AGENT_ID),
      ELEVENLABS_OUTBOUND_ENABLED: "true",
      ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
      ELEVENLABS_OUTBOUND_VORSPANN: "true",
      TELNYX_CALL_CONTROL_APP_ID: APP_ID,
      ELEVENLABS_API_KEY: "test-key-5987",
      ELEVENLABS_API_BASE: umgebung.attrappe.url,
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_5987",
      ELEVENLABS_RESULT_POLL_MS: "60000",
      TELNYX_API_BASE: umgebung.attrappe.url,
      TELNYX_API_KEY: "KEYtest-5987",
      TELNYX_CONNECTION_ID: "conn_5987",
      TELNYX_ACCOUNT_SID: "acct_5987",
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
      PUBLIC_URL: "https://agent.test",
      EL_INBOUND_SIP_PASSWORD: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD,
    },
    seed: seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] }),
  });
});

afterEach(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

async function neuerAnruf() {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: ZIEL, objective: "Termin am Donnerstag vereinbaren" }),
  });
  return (await antwort.json()).callId;
}

function sendeEreignis({ callId, typ, bein }) {
  const roh = JSON.stringify({ data: { id: `evt-${typ}-${bein}`, event_type: typ, payload: { call_control_id: bein ?? beinVon(callId) } } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

const verarbeitet = () => abrufMitFrist(`${umgebung.srv.localUrl}/healthz`);
const zahlen = (text) => Object.fromEntries([...text.matchAll(/(\w+)=(\d+)/g)].map(([, name, wert]) => [name, Number(wert)]));

test("5987-A1: ein gestarteter Anruf schreibt auftrag_bis_wahl mit Teilzeiten, ohne Nummer", async () => {
  const callId = await neuerAnruf();
  await warteAuf(() => zeile(callId, "auftrag_bis_wahl"));
  const text = zeile(callId, "auftrag_bis_wahl");
  assert.match(text, /\[el-vorspann\] auftrag_bis_wahl ms=\d+ ms_tts=\d+ ms_pruefe=\d+ ms_waehle=\d+ call=\S+$/);
  const werte = zahlen(text);
  assert.ok(werte.ms < MINUTE_MS, text);
  assert.ok(werte.ms >= werte.ms_tts + werte.ms_pruefe + werte.ms_waehle, text);
  assert.ok(!text.includes(ZIEL.slice(-7)), text);
});

test("5987-A2: meldet Telnyx das Klingeln, steht auftrag_bis_klingeln im Log und der Anruf bleibt unberuehrt", async () => {
  const callId = await neuerAnruf();
  await warteAuf(() => zeile(callId, "auftrag_bis_wahl"));
  const vorher = aktionen(umgebung.attrappe).length;
  assert.equal((await sendeEreignis({ callId, typ: "call.ringing" })).status, HTTP_OK);
  await warteAuf(() => zeile(callId, "auftrag_bis_klingeln"));
  const text = zeile(callId, "auftrag_bis_klingeln");
  assert.match(text, /\[el-vorspann\] auftrag_bis_klingeln ms=\d+ call=\S+$/);
  const werte = zahlen(text);
  assert.ok(werte.ms < MINUTE_MS, text);
  assert.ok(werte.ms >= zahlen(zeile(callId, "auftrag_bis_wahl")).ms_waehle, text);
  await verarbeitet();
  assert.equal(aktionen(umgebung.attrappe).length, vorher);
  assert.equal(anrufDaten(callId).status, "active");
});

test("5987-A3: Klingeln des ElevenLabs-Beins zaehlt nicht als Klingeln des Angerufenen", async () => {
  const callId = await neuerAnruf();
  await sendeEreignis({ callId, typ: "call.answered" });
  await warteAuf(() => anrufDaten(callId)?.elCallControlId);
  const { elCallControlId: elBein } = anrufDaten(callId);
  await sendeEreignis({ callId, typ: "call.ringing", bein: elBein });
  await verarbeitet();
  assert.equal(zeile(callId, "auftrag_bis_klingeln"), undefined);
});
