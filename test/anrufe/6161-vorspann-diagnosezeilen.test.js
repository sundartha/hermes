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
  startTelnyxProvisioningMock,
  waitForStoreState,
  waitUntil,
} from "../helpers.js";
import { CONV_ID, INBOUND_TO, elInboundInitSpawnEnv, isoVor, spawnSeedWartenderElCall, starteAnbieterAttrappe } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const EINMAL = 1;
const ZWEIMAL = 2;
const WARTE = { timeoutMs: 15_000, pollIntervalMs: 20 };
const MS_JE_SEKUNDE = 1000;
const AUDIO_BYTES = 200_000;
const APP_ID = "cc_app_6161";
const AGENT_ID = "agent_6161";
const PUBLIC_URL = "https://agent.test";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const NUMMER = "+4915112396101";
const GESTARTET = "2026-01-01T10:00:00.000Z";
const ABGEHOBEN = "2026-01-01T10:00:01.000Z";
const KONVERSATION_START_S = Date.parse("2026-01-01T10:00:02.000Z") / MS_JE_SEKUNDE;
const ERSTE_REDE_NACH_S = 3.0004;
const AGENT_TEXT = "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel.";
const KONVERSATION = "conv_6161_init";
const ZEILEN = ["agent_erste_rede", "first_message_ergebnis"];

let zaehler = 0;
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const istEl = (anfrage) => koerper(anfrage).command_id.endsWith("-el");
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
const zeilenMit = (srv, name) => srv.stdout.split("\n").filter((zeile) => zeile.includes(`[el-vorspann] ${name}`));

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
  res.end(JSON.stringify({ data: { sid: `v3:ob-6161-${(zaehler += EINMAL)}`, result: "ok" } }));
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
    TELNYX_CALL_CONTROL_APP_ID: APP_ID,
    ELEVENLABS_API_KEY: "test-key-6161",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_6161",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: "KEYtest-6161",
    TELNYX_CONNECTION_ID: "conn_6161",
    TELNYX_ACCOUNT_SID: "acct_6161",
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

const anrufIn = (id) => {
  const { calls } = umgebung.srv.readStore();
  return calls.find((eintrag) => eintrag.id === id);
};
const eroeffnungLaenge = ({ conversation_config_override: override }) => override.agent.first_message.length;

function sende(callId, typ) {
  const payload = { call_control_id: calleeVon(callId) };
  const roh = JSON.stringify({ data: { id: `evt-6161-${(zaehler += EINMAL)}`, event_type: typ, payload } });
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
    body: JSON.stringify({ to: `${NUMMER}${String(zaehler += EINMAL).padStart(2, "0")}`, objective: "Termin am Donnerstag vereinbaren" }),
  });
  assert.equal(antwort.status, HTTP_OK);
  return (await antwort.json()).callId;
}

const init = (call, konversation = `conv_6161_${(zaehler += EINMAL)}`) =>
  abrufMitFrist(`${umgebung.srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: konversation,
      called_number: call.from,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: call.streamToken },
    }),
  });

test("6161-K1: Init nach dem Vorspann meldet first_message_ergebnis einmal mit Override geliefert und Laenge ohne Eroeffnungstext", async () => {
  const callId = await neuerAnruf();
  assert.equal((await sende(callId, "call.answered")).status, HTTP_OK);
  await waitUntil(() => umgebung.attrappe.anfragen.some((anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage) && anfrage.roh.includes(callId)), WARTE);
  const antwort = await init(anrufIn(callId), KONVERSATION);
  assert.equal(antwort.status, HTTP_OK);
  assert.equal(eroeffnungLaenge(await antwort.json()), 0);
  assert.deepEqual(zeilenMit(umgebung.srv, ZEILEN[1]), [`[el-vorspann] first_message_ergebnis geliefert=ja laenge=0 call=${callId}`]);
  const wiederholung = await init(anrufIn(callId), KONVERSATION);
  assert.equal(wiederholung.status, HTTP_OK);
  assert.equal(zeilenMit(umgebung.srv, ZEILEN[1]).length, EINMAL);
});

const ausgehend = (id, extra = {}) =>
  seedCall({ id, provider: "telnyx", twilioSid: `v3:${id}`, maxDurationS: 3600, costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI, diagnostic: true, ...extra });
const gebunden = (id) =>
  ausgehend(id, { startedAt: GESTARTET, answeredAt: ABGEHOBEN, elevenlabsConversationId: CONV_ID, elBoundAt: isoVor(5), fristAbfrageAt: isoVor(5) });

const gespraech = ({ zeilen, metadata = { start_time_unix_secs: KONVERSATION_START_S } }) => ({
  conversation_id: CONV_ID,
  status: "done",
  transcript: zeilen,
  analysis: { call_successful: "success", transcript_summary: "Termin vereinbart.", data_collection_results: {} },
  metadata: { call_duration_secs: 60, cost_fiat: 0.12, phone_call: { direction: "inbound", call_id: "sip_6161" }, ...metadata },
});
const AGENT_ZEILE = { role: "agent", message: AGENT_TEXT, time_in_call_secs: ERSTE_REDE_NACH_S };

async function nachlaufMit(gespraechAntwort, id, nachlaeufe = EINMAL) {
  const el = await starteAnbieterAttrappe();
  const telnyx = await startTelnyxProvisioningMock();
  const srv = await startServer({
    env: { ELEVENLABS_API_BASE: el.url, ELEVENLABS_API_KEY: "test-key", ELEVENLABS_RESULT_POLL_MS: "200", FRISTEN_TAKT_MS: "40", DIAGNOSTIC_RETENTION_DAYS: "7", TELNYX_API_BASE: telnyx.url, TELNYX_API_KEY: "KEYtest-6161", TELNYX_ACCOUNT_SID: "acct_6161" },
    seed: seedState({ settings: { allowSummaries: false }, calls: [gebunden(id)] }),
  });
  try {
    await waitUntil(() => el.gets().length >= EINMAL, WARTE);
    for (let nr = 0; nr < nachlaeufe; nr += EINMAL) {
      await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${id}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "CallStatus=completed" });
      if (nr === 0) {
        await waitUntil(() => srv.stdout.includes("[el-inbound] nachlauf gestartet"), WARTE);
        el.setzeAntwort(gespraechAntwort);
      }
    }
    await waitForStoreState(srv, (stand) => Boolean(stand.calls.find((eintrag) => eintrag.id === id)?.billedAt), WARTE.timeoutMs);
    return srv.stdout;
  } finally {
    await srv.stop();
    await telnyx.close();
    await el.close();
  }
}

const zeilenIn = (ausgabe, name) => ausgabe.split("\n").filter((zeile) => zeile.includes(`[el-vorspann] ${name}`));

test("6161-K2: erste Agent-Rede im Ergebnis -> eine Zeile agent_erste_rede mit ms seit Start und seit Abheben, ohne Gespraechstext", async () => {
  const id = "call_6161_k2";
  const ausgabe = await nachlaufMit(gespraech({ zeilen: [{ role: "user", message: "Hallo", time_in_call_secs: 1 }, AGENT_ZEILE, { role: "agent", message: "Zweiter Satz", time_in_call_secs: 9 }] }), id, ZWEIMAL);
  assert.deepEqual(zeilenIn(ausgabe, ZEILEN[0]), [`[el-vorspann] agent_erste_rede ms_seit_start=5000 ms_seit_abheben=4000 call=${id}`]);
  assert.ok(!zeilenIn(ausgabe, ZEILEN[0]).join("").includes("Guten Tag"));
});

test("6161-K2b: kein Agent-Satz im Ergebnis -> keine Zeile agent_erste_rede", async () => {
  const id = "call_6161_k2b";
  const ausgabe = await nachlaufMit(gespraech({ zeilen: [{ role: "user", message: "Hallo", time_in_call_secs: 1 }, { role: "agent", message: "", time_in_call_secs: 2 }, null] }), id);
  assert.deepEqual(zeilenIn(ausgabe, ZEILEN[0]), []);
});

test("6161-K2c: Anbieter nennt keinen Gespraechsstart -> Zeile mit - statt Zahlen", async () => {
  const id = "call_6161_k2c";
  const ausgabe = await nachlaufMit(gespraech({ zeilen: [AGENT_ZEILE], metadata: { start_time_unix_secs: null } }), id);
  assert.deepEqual(zeilenIn(ausgabe, ZEILEN[0]), [`[el-vorspann] agent_erste_rede ms_seit_start=- ms_seit_abheben=- call=${id}`]);
});

const OHNE_VORSPANN_ABSENDER = "+15005550006";
const OHNE_VORSPANN_ZIEL = "+491737250000";
const bindungsToken = (nummer) => String(nummer).padStart(32, "0");
const ohneVorspann = (nummer, extra = {}) =>
  seedCall({
    id: `call_6161_${nummer}`,
    direction: "outbound",
    from: OHNE_VORSPANN_ABSENDER,
    to: OHNE_VORSPANN_ZIEL,
    goal: "Termin vereinbaren",
    answeredAt: ABGEHOBEN,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    streamToken: bindungsToken(nummer),
    ...extra,
  });

const initUeber = (srv, call, konversation) =>
  abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
    body: JSON.stringify({ agent_id: AGENT_ID, conversation_id: konversation, called_number: call.from, sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: call.streamToken } }),
  });

test("6161-K1b: Init ohne Vorspann meldet first_message_ergebnis mit Laenge der Eroeffnung, oder nein ohne Override", async () => {
  const gleicheSprache = ohneVorspann(1);
  const andereSprache = ohneVorspann(2, { language: "en" });
  const inbound = spawnSeedWartenderElCall({ callId: "call_6161_inbound", bindungsToken: bindungsToken(0), answeredVorS: 2 });
  const srv = await startServer({ env: elInboundInitSpawnEnv(AGENT_ID), seed: { ...inbound, calls: [...inbound.calls, gleicheSprache, andereSprache] } });
  try {
    assert.equal((await initUeber(srv, gleicheSprache, "conv_6161_a")).status, HTTP_OK);
    const mitText = await initUeber(srv, andereSprache, "conv_6161_b");
    assert.equal(mitText.status, HTTP_OK);
    const laenge = eroeffnungLaenge(await mitText.json());
    assert.ok(laenge > 0);
    const eingehend = { from: OHNE_VORSPANN_ABSENDER, to: INBOUND_TO, streamToken: bindungsToken(0) };
    const eingehendAntwort = await abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: INIT_TOKEN },
      body: JSON.stringify({ agent_id: AGENT_ID, conversation_id: "conv_6161_c", sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: eingehend.streamToken } }),
    });
    assert.equal(eingehendAntwort.status, HTTP_OK);
    assert.deepEqual(zeilenMit(srv, ZEILEN[1]), [
      `[el-vorspann] first_message_ergebnis geliefert=nein laenge=0 call=${gleicheSprache.id}`,
      `[el-vorspann] first_message_ergebnis geliefert=ja laenge=${String(laenge)} call=${andereSprache.id}`,
    ]);
  } finally {
    await srv.stop();
  }
});

test("6161-K2d: Ergebnis ohne Transkript -> keine Zeile agent_erste_rede, Anruf wird trotzdem abgeschlossen", async () => {
  const id = "call_6161_k2d";
  const ausgabe = await nachlaufMit(gespraech({ zeilen: undefined }), id);
  assert.deepEqual(zeilenIn(ausgabe, ZEILEN[0]), []);
});
