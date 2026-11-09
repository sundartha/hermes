import { after, before, test } from "node:test";
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
} from "./helpers.js";
import { elInboundInitSpawnEnv } from "./_iel-inbound-harness.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { echtWarten } from "./echt-warten.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_SERVER_FEHLER = 500;
const WARTE_FRIST_MS = 8_000;
const WIEDERGABE_FRIST_MS = 1_500;
const EL_FRIST_MS = 3_000;
const VOR_DER_FRIST_MS = 300;
const NACH_DER_FRIST_MS = 800;
const STANDARD_WIEDERGABE_FRIST_MS = 20_000;
const STANDARD_EL_FRIST_MS = 30_000;
const EINMAL = 1;
const NIE = 0;
const NUMMER_PRAEFIX = "+4915112395";
const AUDIO_BYTES = 200_000;
const NUR_LESEN = 0o555;
const SCHREIBBAR = 0o755;

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const istEl = (anfrage) => koerper(anfrage).command_id.endsWith("-el");
const calleeVon = (callId) => `cc_callee_${callId}`;
const elVon = (callId) => `cc_el_${callId}`;
const aktionen = (attrappe, bein, aktion) =>
  attrappe.anfragen.filter((anfrage) => anfrage.path === `/v2/calls/${bein}/actions/${aktion}`);
const aufleger = (attrappe, callId) => [
  aktionen(attrappe, calleeVon(callId), "hangup").length,
  aktionen(attrappe, elVon(callId), "hangup").length,
];
const bruecken = (attrappe, callId) => aktionen(attrappe, calleeVon(callId), "bridge").length;
const vorkommen = (text, teil) => text.split(teil).length - EINMAL;

function beantworte({ req, res }, anfrage) {
  if (req.url.startsWith("/v1/text-to-speech/")) {
    res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
    return res.end(Buffer.alloc(AUDIO_BYTES, 1));
  }
  if (umgebung.hangupFehler && req.url.endsWith("/actions/hangup")) {
    res.writeHead(HTTP_SERVER_FEHLER);
    return res.end("{}");
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  if (req.url === "/v2/calls") {
    const kennung = koerper(anfrage)
      .command_id.replace(/^vorspann-/, "")
      .replace(/-el$/, "");
    return res.end(
      JSON.stringify({
        data: { call_control_id: istEl(anfrage) ? elVon(kennung) : calleeVon(kennung) },
      }),
    );
  }
  res.end(JSON.stringify({ data: { sid: "v3:ob-3365-fristen", result: "ok" } }));
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

const umgebung = { nummer: 0 };

before(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.signer = makeTelnyxSigner();
  const env = {
    ...elInboundInitSpawnEnv("agent_3365_fristen"),
    ...EL_INBOUND_ACCESS_BOOT_ENV,
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    TELNYX_CALL_CONTROL_APP_ID: "cc_app_3365_fristen",
    ELEVENLABS_API_KEY: "test-key-3365",
    ELEVENLABS_API_BASE: umgebung.attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3365_fristen",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: umgebung.attrappe.url,
    TELNYX_API_KEY: "KEYtest-3365",
    TELNYX_CONNECTION_ID: "conn_3365",
    TELNYX_ACCOUNT_SID: "acct_3365",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: umgebung.signer.publicKeyBase64,
    PUBLIC_URL: "https://agent.test",
    VORSPANN_WIEDERGABE_FRIST_MS: String(WIEDERGABE_FRIST_MS),
    EL_BRIDGE_START_DEADLINE_MS: String(EL_FRIST_MS),
  };
  umgebung.srv = await startServer({
    env,
    seed: seedState({
      tenants: [
        {
          id: TENANT_ID,
          status: "active",
          ownerName: "Jonas Beispiel",
          firstName: OWNER_TEST_FIRST_NAME,
        },
      ],
    }),
  });
});

after(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

const anrufIn = (id) => {
  const { calls } = umgebung.srv.readStore();
  return calls.find((eintrag) => eintrag.id === id);
};
const rueckfallLog = (grund, callId) => `[el-vorspann] rueckfall grund=${grund} call=${callId}`;
const logZeileMit = (callId, aktion) => `[el-vorspann] ${aktion} fehlgeschlagen call=${callId}:`;
const abrechnungLog = (callId) => `[terminateAndBillCall] Settlement fehlgeschlagen (call=${callId}):`;
const abgerechnet = (callId) => Boolean(anrufIn(callId).billedAt);

function sende(callId, typ, { bein = calleeVon(callId), status = "completed" } = {}) {
  umgebung.nummer += EINMAL;
  const roh = JSON.stringify({
    data: {
      id: `evt-fristen-${umgebung.nummer}`,
      event_type: typ,
      payload: { call_control_id: bein, status },
    },
  });
  const zeit = String(nowSeconds());
  return abrufMitFrist(`${umgebung.srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "telnyx-timestamp": zeit,
      "telnyx-signature-ed25519": umgebung.signer.sign(zeit, roh),
    },
    body: roh,
  });
}

async function abgehobenerAnruf() {
  const antwort = await abrufMitFrist(`${umgebung.srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      to: `${NUMMER_PRAEFIX}${String((umgebung.nummer += EINMAL)).padStart(3, "0")}`,
      objective: "Termin am Donnerstag vereinbaren",
    }),
  });
  const { callId } = await antwort.json();
  assert.equal((await sende(callId, "call.answered")).status, HTTP_OK);
  const { attrappe } = umgebung;
  await waitUntil(() =>
    attrappe.anfragen.some(
      (anfrage) => anfrage.path === "/v2/calls" && istEl(anfrage) && anfrage.roh.includes(callId),
    ),
  );
  await waitUntil(() => aktionen(attrappe, calleeVon(callId), "playback_start").length === EINMAL);
  return callId;
}

async function mitGesperrtemSpeicher(run) {
  fs.chmodSync(umgebung.srv.dataDir, NUR_LESEN);
  try {
    return await run();
  } finally {
    fs.chmodSync(umgebung.srv.dataDir, SCHREIBBAR);
  }
}

const gleich = (attrappe, callId, soll) => aufleger(attrappe, callId).join() === soll.join();

test("3365-F2: ohne Wiedergabe-Rueckmeldung werden beide Beine nach der Frist aufgelegt, keine Bruecke", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await abgehobenerAnruf();
  await waitUntil(() => gleich(attrappe, callId, [EINMAL, EINMAL]));
  assert.equal(vorkommen(srv.stdout, rueckfallLog("vorspann_nicht_abgespielt", callId)), EINMAL);
  assert.equal(bruecken(attrappe, callId), NIE);
  await echtWarten(EL_FRIST_MS + NACH_DER_FRIST_MS);
  assert.deepEqual(aufleger(attrappe, callId), [EINMAL, EINMAL]);
  assert.notEqual(anrufIn(callId).failureReason, "el_frist");
});

test("3365-F2b: nicht vollstaendiges Wiedergabe-Ende nach dem Fristabbruch legt nicht noch einmal auf und meldet den Rueckfall nicht doppelt", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await abgehobenerAnruf();
  await waitUntil(() => gleich(attrappe, callId, [EINMAL, EINMAL]));
  await sende(callId, "call.playback.ended", { status: "failed" });
  await echtWarten(NACH_DER_FRIST_MS);
  assert.deepEqual(aufleger(attrappe, callId), [EINMAL, EINMAL]);
  assert.equal(vorkommen(srv.stdout, rueckfallLog("vorspann_nicht_abgespielt", callId)), EINMAL);
});

test("3365-F9: Auflegen des Anbieters nach dem Fristabbruch legt kein Bein noch einmal auf und beendet den Anruf", async () => {
  const { attrappe } = umgebung;
  const callId = await abgehobenerAnruf();
  await waitUntil(() => gleich(attrappe, callId, [EINMAL, EINMAL]));
  await sende(callId, "call.hangup");
  await waitUntil(() => anrufIn(callId).status === "completed");
  await waitUntil(() => abgerechnet(callId));
  assert.deepEqual(aufleger(attrappe, callId), [EINMAL, EINMAL]);
});

test("3365-F9b: Auflegen des EL-Beins nach dem Fristabbruch legt das Callee-Bein nicht noch einmal auf", async () => {
  const { attrappe } = umgebung;
  const callId = await abgehobenerAnruf();
  await waitUntil(() => gleich(attrappe, callId, [EINMAL, EINMAL]));
  await sende(callId, "call.hangup", { bein: elVon(callId) });
  await waitUntil(() => anrufIn(callId).status === "completed");
  await waitUntil(() => abgerechnet(callId));
  assert.deepEqual(aufleger(attrappe, callId), [EINMAL, EINMAL]);
});

test("3365-F10: scheitert das Auflegen eines Beins beim Fristabbruch, wird es nach dem Auflegen des anderen Beins noch einmal versucht", async () => {
  const { attrappe } = umgebung;
  umgebung.hangupFehler = true;
  let callId;
  try {
    callId = await abgehobenerAnruf();
    await waitUntil(() => gleich(attrappe, callId, [EINMAL, EINMAL]));
  } finally {
    umgebung.hangupFehler = false;
  }
  await sende(callId, "call.hangup");
  await waitUntil(() => anrufIn(callId).status === "completed");
  await waitUntil(() => abgerechnet(callId));
  assert.deepEqual(aufleger(attrappe, callId), [EINMAL, EINMAL + EINMAL]);
});

test("3365-F2a: vor der Wiedergabe-Frist wird noch nichts aufgelegt", async () => {
  const { attrappe } = umgebung;
  const callId = await abgehobenerAnruf();
  await echtWarten(VOR_DER_FRIST_MS);
  assert.deepEqual(aufleger(attrappe, callId), [NIE, NIE]);
});

test("3365-F1: Rueckmeldung vor der Frist fuehrt zur Bruecke, nach der Frist wird nicht aufgelegt", async () => {
  const { attrappe } = umgebung;
  const callId = await abgehobenerAnruf();
  await sende(callId, "call.playback.ended");
  await sende(callId, "call.answered", { bein: elVon(callId) });
  await waitUntil(() => bruecken(attrappe, callId) === EINMAL);
  await echtWarten(EL_FRIST_MS + NACH_DER_FRIST_MS);
  assert.deepEqual(aufleger(attrappe, callId), [NIE, NIE]);
});

test("3365-F3: spaetes completed nach der Frist ergibt keine Bruecke und kein zweites Auflegen", async () => {
  const { attrappe } = umgebung;
  const callId = await abgehobenerAnruf();
  await waitUntil(() => gleich(attrappe, callId, [EINMAL, EINMAL]));
  await sende(callId, "call.playback.ended");
  await sende(callId, "call.answered", { bein: elVon(callId) });
  await echtWarten(EL_FRIST_MS + NACH_DER_FRIST_MS);
  assert.equal(bruecken(attrappe, callId), NIE);
  assert.deepEqual(aufleger(attrappe, callId), [EINMAL, EINMAL]);
});

test("3365-F4: schon aufgelegter Anruf wird bei Fristablauf nicht noch einmal aufgelegt", async () => {
  const { attrappe } = umgebung;
  const callId = await abgehobenerAnruf();
  await sende(callId, "call.hangup");
  await waitUntil(() => aktionen(attrappe, elVon(callId), "hangup").length === EINMAL);
  await waitUntil(() => anrufIn(callId).status === "completed");
  await waitUntil(() => abgerechnet(callId));
  const gebucht = anrufIn(callId).billedAt;
  await echtWarten(EL_FRIST_MS + NACH_DER_FRIST_MS);
  assert.deepEqual(aufleger(attrappe, callId), [NIE, EINMAL]);
  assert.equal(anrufIn(callId).billedAt, gebucht);
});

test("3365-F5: EL-Annahme vor der EL-Frist fuehrt zur Bruecke, nach der Frist passiert nichts", async () => {
  const { attrappe } = umgebung;
  const callId = await abgehobenerAnruf();
  await sende(callId, "call.answered", { bein: elVon(callId) });
  await sende(callId, "call.playback.ended");
  await waitUntil(() => bruecken(attrappe, callId) === EINMAL);
  await echtWarten(EL_FRIST_MS + NACH_DER_FRIST_MS);
  assert.deepEqual(aufleger(attrappe, callId), [NIE, NIE]);
  assert.notEqual(anrufIn(callId).failureReason, "el_frist");
});

test("3365-F6: ohne EL-Annahme wird el_frist vermerkt und es werden beide Beine aufgelegt", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await abgehobenerAnruf();
  await sende(callId, "call.playback.ended");
  await echtWarten(WIEDERGABE_FRIST_MS + NACH_DER_FRIST_MS);
  assert.deepEqual(aufleger(attrappe, callId), [NIE, NIE]);
  await waitUntil(() => gleich(attrappe, callId, [EINMAL, EINMAL]));
  assert.equal(anrufIn(callId).failureReason, "el_frist");
  assert.equal(vorkommen(srv.stdout, rueckfallLog("el_frist", callId)), EINMAL);
  assert.equal(bruecken(attrappe, callId), NIE);
});

test("3365-F7: scheitert das Speichern des Endes nach der Wiedergabe-Frist, bleibt es beim Auflegen und einem Fehler ende im Log", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await abgehobenerAnruf();
  await waitUntil(() => gleich(attrappe, callId, [EINMAL, EINMAL]));
  assert.equal(bruecken(attrappe, callId), NIE);
  let ende;
  await mitGesperrtemSpeicher(async () => {
    ende = sende(callId, "call.hangup");
    await waitUntil(() => srv.stdout.includes(logZeileMit(callId, "ende")));
  });
  await ende;
  assert.deepEqual(aufleger(attrappe, callId), [EINMAL, EINMAL]);
  assert.equal(vorkommen(srv.stdout, logZeileMit(callId, "ende")), EINMAL);
  assert.equal(vorkommen(srv.stdout, rueckfallLog("vorspann_nicht_abgespielt", callId)), EINMAL);
  assert.equal(vorkommen(srv.stdout, abrechnungLog(callId)), EINMAL);
});

test("3365-F7a: scheitert das Speichern des Vermerks bei der EL-Frist, bleibt es beim Auflegen und einer Abrechnung", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await abgehobenerAnruf();
  await sende(callId, "call.playback.ended");
  await mitGesperrtemSpeicher(async () => {
    await waitUntil(() => gleich(attrappe, callId, [EINMAL, EINMAL]));
    await waitUntil(() => srv.stdout.includes(logZeileMit(callId, "vermerk")));
  });
  await sende(callId, "call.hangup");
  await waitUntil(() => abgerechnet(callId));
  assert.equal(vorkommen(srv.stdout, logZeileMit(callId, "vermerk")), EINMAL);
});

test("3365-F6a: spaete EL-Annahme nach der EL-Frist ergibt keine Bruecke, auch wenn der Satz abgespielt ist", async () => {
  const { attrappe } = umgebung;
  const callId = await abgehobenerAnruf();
  await sende(callId, "call.playback.ended");
  await waitUntil(() => gleich(attrappe, callId, [EINMAL, EINMAL]));
  await sende(callId, "call.answered", { bein: elVon(callId) });
  await echtWarten(NACH_DER_FRIST_MS);
  assert.equal(bruecken(attrappe, callId), NIE);
});

test("3365-F8: ohne gesetzte Variablen gelten 20000 ms und 30000 ms", async () => {
  const { config } = await import("../src/config.js");
  assert.equal(
    config.voice.elevenLabsOutbound.vorspannWiedergabeFristMs,
    STANDARD_WIEDERGABE_FRIST_MS,
  );
  assert.equal(config.voice.elevenLabsOutbound.bridgeStartDeadlineMs, STANDARD_EL_FRIST_MS);
});
