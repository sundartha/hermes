import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.js";
import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.js";
import { EL_INBOUND_ACCESS_BOOT_ENV, OWNER_TEST_FIRST_NAME, makeTelnyxSigner, nowSeconds, seedCall, seedState, startServer, waitUntil as wartebis } from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { CONVERSATION_DONE_WITH_ANALYSIS } from "../fixtures/elevenlabs-conversations.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const WARTE_FRIST_MS = 5_000;
const EINMAL = 1;
const AGENT_ID = "agent_3603";
const APP_ID = "cc_app_3603";
const PUBLIC_URL = "https://agent.test";
const FERTIG = "completed";
const NUMMER_PRAEFIX = "+4915112390";
const GESPRAECHSZEILEN = CONVERSATION_DONE_WITH_ANALYSIS.transcript.length;
const MIT_VORSPANN_ZEILE = GESPRAECHSZEILEN + EINMAL;

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const istEl = (anfrage) => koerper(anfrage).command_id.endsWith("-el");
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
const aktionen = (attrappe, bein, aktion) => attrappe.anfragen.filter((anfrage) => anfrage.path === `/v2/calls/${bein}/actions/${aktion}`);

function beantworte({ req, res }, anfrage, steuerung) {
  if (req.url.startsWith("/v1/text-to-speech/")) {
    res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
    return res.end(Buffer.alloc(200_000, 1));
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  if (req.url.startsWith("/v1/convai/conversations/")) {
    return res.end(JSON.stringify(steuerung.antwort[steuerung.ergebnis]));
  }
  if (req.url === "/v2/calls") {
    const kennung = koerper(anfrage).command_id.replace(/^vorspann-/, "").replace(/-el$/, "");
    return res.end(JSON.stringify({ data: { call_control_id: istEl(anfrage) ? elVon(kennung) : calleeVon(kennung) } }));
  }
  res.end(JSON.stringify({ data: { sid: "v3:ob-3603", result: "ok" } }));
}

async function starteAttrappe() {
  const anfragen = [];
  const steuerung = {
    ergebnis: "fertig",
    antwort: {
      fertig: CONVERSATION_DONE_WITH_ANALYSIS,
      offen: { conversation_id: "x", status: "processing" },
      kaputt: { ...CONVERSATION_DONE_WITH_ANALYSIS, transcript: [{ role: "agent", message: 5 }] },
    },
  };
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

before(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...elInboundInitSpawnEnv(AGENT_ID),
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    TELNYX_CALL_CONTROL_APP_ID: APP_ID,
    ELEVENLABS_API_KEY: "test-key-3603",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3603",
    ELEVENLABS_RESULT_POLL_MS: "100",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: "KEYtest-3603",
    TELNYX_CONNECTION_ID: "conn_3603",
    TELNYX_ACCOUNT_SID: "acct_3603",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
    PUBLIC_URL,
  };
  const seed = seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] });
  umgebung.srv = await startServer({ env, seed });
});

after(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

let zaehler = 0;
const anrufIn = (id) => {
  const { calls } = umgebung.srv.readStore();
  return calls.find((eintrag) => eintrag.id === id);
};
const anbieterAnfragen = () => umgebung.attrappe.anfragen;
const elAnrufe = () => anbieterAnfragen().filter((anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage));
const abrufe = () => anbieterAnfragen().filter((anfrage) => anfrage.path.startsWith("/v1/convai/conversations/"));

function sende(callId, typ, { bein = calleeVon(callId), status } = {}) {
  const payload = { call_control_id: bein, ...(status ? { status } : {}) };
  const roh = JSON.stringify({ data: { id: `evt-3603-${(zaehler += EINMAL)}`, event_type: typ, payload } });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json", "telnyx-timestamp": zeit, "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh) },
    body: roh,
  });
}

async function binde(callId) {
  const call = anrufIn(callId);
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: `conv_3603_${callId}`,
      called_number: call.from,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: call.streamToken },
    }),
  });
  assert.equal(antwort.status, HTTP_OK, await antwort.text());
}

async function gebundenerAnruf() {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: `${NUMMER_PRAEFIX}${String((zaehler += EINMAL)).padStart(3, "0")}`, objective: "Termin am Donnerstag vereinbaren" }),
  });
  const { callId } = await antwort.json();
  await sende(callId, "call.answered");
  await waitUntil(() => aktionen(umgebung.attrappe, calleeVon(callId), "playback_start").length === EINMAL);
  await waitUntil(() => elAnrufe().length > 0);
  await binde(callId);
  return callId;
}

async function gebrueckterAnruf() {
  const callId = await gebundenerAnruf();
  await sende(callId, "call.playback.ended", { status: FERTIG });
  await sende(callId, "call.answered", { bein: elVon(callId) });
  await waitUntil(() => anrufIn(callId).bridgedAt);
  return callId;
}

function pruefeNachlauf(callId) {
  const call = anrufIn(callId);
  assert.equal(call.status, "completed");
  assert.equal(call.transcript.length, MIT_VORSPANN_ZEILE);
  assert.equal(call.summary, CONVERSATION_DONE_WITH_ANALYSIS.analysis.transcript_summary);
}

async function wartenAufAbrechnung(callId) {
  await waitUntil(() => anrufIn(callId).billedAt);
  assert.equal(anrufIn(callId).transcript.length, MIT_VORSPANN_ZEILE);
}

test("3603-K1/K3: Angerufener legt nach der Bruecke auf -> Gespraechszeilen und Zusammenfassung stehen, bevor abgerechnet wird", async () => {
  const callId = await gebrueckterAnruf();
  await sende(callId, "call.hangup");
  await wartenAufAbrechnung(callId);
  pruefeNachlauf(callId);
});

test("3603-K2: EL-Bein legt zuerst auf -> Gespraechszeilen und Zusammenfassung stehen, Anruf completed", async () => {
  const callId = await gebrueckterAnruf();
  await sende(callId, "call.hangup", { bein: elVon(callId) });
  await wartenAufAbrechnung(callId);
  pruefeNachlauf(callId);
});

test("3603-K4: Ergebnis beim Anbieter nicht abrufbar -> trotzdem abgerechnet, Logzeile nennt den Anruf", async () => {
  umgebung.attrappe.steuerung.ergebnis = "offen";
  try {
    const callId = await gebrueckterAnruf();
    await sende(callId, "call.hangup");
    await waitUntil(() => anrufIn(callId).billedAt);
    assert.equal(anrufIn(callId).status, "completed");
    await waitUntil(() => umgebung.srv.stdout.includes(`[el-inbound] Ergebnis beim Beenden nicht abrufbar (call=${callId})`));
  } finally {
    umgebung.attrappe.steuerung.ergebnis = "fertig";
  }
});

test("3603-K5: Angerufener legt waehrend des Vorspanns auf -> kein Ergebnisabruf, keine Gespraechszeilen, trotzdem abgerechnet", async () => {
  const callId = await gebundenerAnruf();
  const abrufeVorher = abrufe().length;
  await sende(callId, "call.hangup");
  await waitUntil(() => anrufIn(callId).billedAt);
  assert.equal(abrufe().length, abrufeVorher);
  assert.equal(anrufIn(callId).transcript.length, 0);
  assert.equal(anrufIn(callId).summary ?? null, null);
});

test("3603-K6: Speichern des EL-Ergebnisses scheitert -> Logzeile nennt den Anruf, trotzdem abgerechnet", async () => {
  umgebung.attrappe.steuerung.ergebnis = "kaputt";
  try {
    const callId = await gebrueckterAnruf();
    await sende(callId, "call.hangup");
    await waitUntil(() => anrufIn(callId).billedAt);
    assert.equal(anrufIn(callId).status, "completed");
    await waitUntil(() => umgebung.srv.stdout.includes(`[el-vorspann] nachlauf fehlgeschlagen call=${callId}`));
  } finally {
    umgebung.attrappe.steuerung.ergebnis = "fertig";
  }
});
