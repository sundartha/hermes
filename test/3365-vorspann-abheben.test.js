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
} from "./helpers.js";
import { elInboundInitSpawnEnv } from "./_iel-inbound-harness.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { echtWarten } from "./echt-warten.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVER_FEHLER = 500;
const POLL_MS = 10;
const WARTE_FRIST_MS = 5_000;
const POLL_VERSUCHE = 500;
const NUMMER_PRAEFIX = "+4915112360";
const EINMAL = 1;
const AGENT_ID = "agent_3365_h2a3";
const OBJECTIVE = "Termin am Donnerstag vereinbaren";
const TTS_PFAD = "/v1/text-to-speech/";
const WAHL_PFAD = "/v2/calls";
const AKTION_PFAD = "/v2/calls/";
const APP_ID = "cc_app_3365";
const FREMDE_ID = "cc_fremd_3365";
const TELNYX_KEY = "KEYtest-3365";
const EL_KEY = "test-key-3365";
const TRAEGER_SID = "v3:ob-3365-h2a3";
const AUDIO_BYTES = 200_000;
const PUBLIC_URL = "https://agent.test";
const SIP_PASSWORT = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD;
const FEHLER_DETAIL = "detail-mit-geheimnis";
const READ_ONLY_DIR = 0o500;
const WRITABLE_DIR = 0o700;

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const beinVon = (callId) => `cc_callee_${callId}`;
const nachPfad = (attrappe, pfad) => attrappe.anfragen.filter((anfrage) => anfrage.method === "POST" && anfrage.path === pfad);
const wahlen = (attrappe, callId) => nachPfad(attrappe, WAHL_PFAD).filter((anfrage) => koerper(anfrage).command_id.endsWith(callId));
const aktionen = (attrappe, bein, aktion) => nachPfad(attrappe, `${AKTION_PFAD}${bein}/actions/${aktion}`);
const alleAktionen = (attrappe) => attrappe.anfragen.filter((anfrage) => anfrage.path.includes("/actions/"));

async function antworteWahl(res, anfrage, steuerung) {
  await steuerung.wahlWartet;
  const callId = koerper(anfrage).command_id.replace(/^vorspann-/, "");
  if (steuerung.dialFehler) {
    res.writeHead(HTTP_UNPROCESSABLE, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errors: [{ code: "10015", title: "Invalid", detail: FEHLER_DETAIL }] }));
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: { call_control_id: beinVon(callId) } }));
}

async function starteAttrappe() {
  const anfragen = [];
  const steuerung = {};
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", async () => {
      anfragen.push({ method: req.method, path: req.url, roh });
      if (req.url.startsWith(TTS_PFAD)) {
        res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
        return res.end(Buffer.alloc(AUDIO_BYTES, 1));
      }
      if (req.url === WAHL_PFAD) return antworteWahl(res, anfragen.at(-1), steuerung);
      if (req.url.endsWith("/actions/playback_start")) await steuerung.playbackWartet;
      const fehler = [["/actions/playback_start", steuerung.playbackFehler], ["/actions/hangup", steuerung.hangupFehler]].find(([ende, an]) => an && req.url.endsWith(ende));
      if (fehler) {
        res.writeHead(HTTP_SERVER_FEHLER, { "content-type": "application/json" });
        return res.end(JSON.stringify({ errors: [{ code: "99", title: "Fehler" }] }));
      }
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
      PUBLIC_URL,
    },
    seed: seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] }),
  });
});

afterEach(async () => {
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
const anrufeImStore = () => {
  const { calls } = umgebung.srv.readStore();
  return calls;
};
const anrufIn = (id) => anrufeImStore().find((eintrag) => eintrag.id === id);
const abbrechen = (callId) => abrufMitFrist(`${umgebung.srv.localUrl}/api/calls/${callId}/cancel`, { method: "POST" });

let ereignisZaehler = 0;
function sendeEreignis({ callId, typ, bein, signatur = true }) {
  ereignisZaehler += EINMAL;
  const roh = JSON.stringify({ data: { id: `evt-${ereignisZaehler}`, event_type: typ, payload: { call_control_id: bein ?? beinVon(callId) } } });
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

async function neuerAnruf() {
  const { callId } = await (await anrufStarten()).json();
  return callId;
}

async function starteUndHebeAb() {
  const callId = await neuerAnruf();
  assert.equal((await sendeEreignis({ callId, typ: "call.answered" })).status, HTTP_OK);
  await waitUntil(() => aktionen(umgebung.attrappe, beinVon(callId), "playback_start").length === EINMAL);
  return callId;
}

function audioPfad(callId) {
  const [start] = aktionen(umgebung.attrappe, beinVon(callId), "playback_start");
  return new URL(koerper(start).audio_url).pathname;
}

test("3365-C1: call.answered -> Antwort 200, playback_start mit der Vorspann-Adresse, Anruf als abgehoben vermerkt", async () => {
  const callId = await neuerAnruf();
  assert.equal(anrufIn(callId).answeredAt ?? null, null);
  assert.equal((await sendeEreignis({ callId, typ: "call.answered" })).status, HTTP_OK);
  await waitUntil(() => aktionen(umgebung.attrappe, beinVon(callId), "playback_start").length === EINMAL);
  assert.match(koerper(aktionen(umgebung.attrappe, beinVon(callId), "playback_start")[0]).audio_url, new RegExp(`^${PUBLIC_URL}/voice/tts/[A-Za-z0-9_-]{43}$`));
  await bis(() => anrufIn(callId).answeredAt);
});

test("3365-C1: die 200 kommt an, solange playback_start beim Anbieter noch haengt", async () => {
  const { attrappe } = umgebung;
  let freigeben;
  const playbackWartet = new Promise((resolve) => (freigeben = resolve));
  await mitSteuerung({ playbackWartet }, async () => {
    const callId = await neuerAnruf();
    try {
      assert.equal((await sendeEreignis({ callId, typ: "call.answered" })).status, HTTP_OK);
      await waitUntil(() => aktionen(attrappe, beinVon(callId), "playback_start").length === EINMAL);
    } finally {
      freigeben();
    }
    await bis(() => anrufIn(callId).answeredAt);
  });
});

test("3365-C2: zweites call.answered mit neuer Ereigniskennung -> kein zweites playback_start", async () => {
  const callId = await starteUndHebeAb();
  assert.equal((await sendeEreignis({ callId, typ: "call.answered" })).status, HTTP_OK);
  await sendeEreignis({ callId, typ: "call.playback.ended" });
  await bis(async () => (await abrufMitFrist(`${umgebung.srv.localUrl}${audioPfad(callId)}`)).status === HTTP_NOT_FOUND);
  assert.equal(aktionen(umgebung.attrappe, beinVon(callId), "playback_start").length, EINMAL);
  assert.equal(wahlen(umgebung.attrappe, callId).length, EINMAL);
});

test("3365-C3: Ereignis eines fremden Beins oder zu unbekanntem Anruf -> 200 ohne Telnyx-Aktion", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await neuerAnruf();
  const vorher = alleAktionen(attrappe).length;
  assert.equal((await sendeEreignis({ callId, typ: "call.answered", bein: FREMDE_ID })).status, HTTP_OK);
  assert.equal((await sendeEreignis({ callId: "gibt-es-nicht", typ: "call.answered" })).status, HTTP_OK);
  await echtWarten(POLL_MS * 5);
  assert.equal(alleAktionen(attrappe).length, vorher);
  assert.equal(anrufIn(callId).answeredAt ?? null, null);
  assert.doesNotMatch(srv.stdout, /\[error\]/);
});

test("3365-C3: event_type wie constructor oder toString -> 200 und keine Aktion", async () => {
  const { attrappe } = umgebung;
  const callId = await neuerAnruf();
  const vorher = alleAktionen(attrappe).length;
  for (const typ of ["constructor", "toString", "__proto__", "hasOwnProperty"])
    assert.equal((await sendeEreignis({ callId, typ })).status, HTTP_OK);
  await echtWarten(POLL_MS * 5);
  assert.equal(alleAktionen(attrappe).length, vorher);
  assert.equal(anrufIn(callId).answeredAt ?? null, null);
});

test("3365-C4: ungueltige Signatur -> 403 ohne Aktion; gueltige Signatur -> 200 und playback_start", async () => {
  const { attrappe } = umgebung;
  const callId = await neuerAnruf();
  assert.equal((await sendeEreignis({ callId, typ: "call.answered", signatur: false })).status, HTTP_FORBIDDEN);
  await echtWarten(POLL_MS * 5);
  assert.equal(aktionen(attrappe, beinVon(callId), "playback_start").length, 0);
  assert.equal((await sendeEreignis({ callId, typ: "call.answered" })).status, HTTP_OK);
  await waitUntil(() => aktionen(attrappe, beinVon(callId), "playback_start").length === EINMAL);
});

test("3365-C5: Vorspann-Datei ist mehrfach abrufbar bis call.playback.ended, danach 404", async () => {
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

test("3365-C6: Angerufener legt nach dem Abheben auf -> completed und abgerechnet, Datei frei, kein Auflegen", async () => {
  const callId = await starteUndHebeAb();
  await sendeEreignis({ callId, typ: "call.hangup" });
  await bis(() => anrufIn(callId).status === "completed" && Boolean(anrufIn(callId).billedAt));
  assert.ok(!anrufIn(callId).failureReason);
  assert.equal(aktionen(umgebung.attrappe, beinVon(callId), "hangup").length, 0);
  assert.equal((await abrufMitFrist(`${umgebung.srv.localUrl}${audioPfad(callId)}`)).status, HTTP_NOT_FOUND);
});

test("3365-C6: Angerufener legt auf, bevor abgehoben wurde -> failed mit no-answer", async () => {
  const callId = await neuerAnruf();
  await sendeEreignis({ callId, typ: "call.hangup" });
  await bis(() => anrufIn(callId).status === "failed");
  assert.equal(anrufIn(callId).failureReason, "no-answer");
});

test("3365-C6: cancel_call vor dem Abheben, danach call.hangup -> Status cancelled ohne Fehlergrund", async () => {
  const callId = await neuerAnruf();
  assert.equal((await abbrechen(callId)).status, HTTP_OK);
  assert.equal(anrufIn(callId).status, "cancelled");
  assert.equal((await sendeEreignis({ callId, typ: "call.hangup" })).status, HTTP_OK);
  await sendeEreignis({ callId, typ: "call.hangup" });
  await echtWarten(POLL_MS * 5);
  assert.equal(anrufIn(callId).status, "cancelled");
  assert.ok(!anrufIn(callId).failureReason);
});

test("3365-C6: Abheben nach cancel_call -> keine Wiedergabe", async () => {
  const callId = await neuerAnruf();
  assert.equal((await abbrechen(callId)).status, HTTP_OK);
  assert.equal((await sendeEreignis({ callId, typ: "call.answered" })).status, HTTP_OK);
  await echtWarten(POLL_MS * 5);
  assert.equal(aktionen(umgebung.attrappe, beinVon(callId), "playback_start").length, 0);
});

test("3365-C6: cancel_call nach dem Abheben, dann call.hangup -> Status bleibt, nichts wird abgerechnet", async () => {
  const callId = await starteUndHebeAb();
  assert.equal((await abbrechen(callId)).status, HTTP_OK);
  const vorher = anrufIn(callId);
  await sendeEreignis({ callId, typ: "call.hangup" });
  await bis(async () => (await abrufMitFrist(`${umgebung.srv.localUrl}${audioPfad(callId)}`)).status === HTTP_NOT_FOUND);
  assert.equal(anrufIn(callId).status, vorher.status);
  assert.equal(anrufIn(callId).endedAt, vorher.endedAt);
});

test("3365-C6: scheitert die Wiedergabe -> Bein aufgelegt und Grund im Log; scheitert auch das Auflegen, steht das daneben", async () => {
  const { attrappe, srv } = umgebung;
  await mitSteuerung({ playbackFehler: true, hangupFehler: true }, async () => {
    const callId = await neuerAnruf();
    await sendeEreignis({ callId, typ: "call.answered" });
    await waitUntil(() => aktionen(attrappe, beinVon(callId), "hangup").length === EINMAL);
    await waitUntil(() => srv.stdout.includes(`[el-vorspann] auflegen fehlgeschlagen call=${callId}:`));
    assert.ok(srv.stdout.includes(`[el-vorspann] abheben fehlgeschlagen call=${callId}:`), srv.stdout);
  });
  await mitSteuerung({ playbackFehler: true }, async () => {
    const callId = await neuerAnruf();
    await sendeEreignis({ callId, typ: "call.answered" });
    await waitUntil(() => aktionen(attrappe, beinVon(callId), "hangup").length === EINMAL);
    assert.ok(srv.stdout.includes(`[el-vorspann] abheben fehlgeschlagen call=${callId}:`), srv.stdout);
    assert.ok(!srv.stdout.includes(`[el-vorspann] auflegen fehlgeschlagen call=${callId}:`), srv.stdout);
  });
});

test("3365-C6: ein Fehler beim Verarbeiten eines Ereignisses wird protokolliert und der Server laeuft weiter", async () => {
  const { srv } = umgebung;
  const callId = await neuerAnruf();
  fs.chmodSync(srv.dataDir, READ_ONLY_DIR);
  try {
    assert.equal((await sendeEreignis({ callId, typ: "call.answered" })).status, HTTP_OK);
    await waitUntil(() => srv.stdout.includes(`[el-vorspann] ereignis fehlgeschlagen call=${callId}:`));
  } finally {
    fs.chmodSync(srv.dataDir, WRITABLE_DIR);
  }
  assert.equal((await sendeEreignis({ callId: "gibt-es-nicht", typ: "call.answered" })).status, HTTP_OK);
});

test("3365-C7: keine Geheimnisse in Anfragepfaden, Webhook-URLs und Log", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await starteUndHebeAb();
  const audioToken = audioPfad(callId).replace("/voice/tts/", "");
  const geheimnisse = [SIP_PASSWORT, TELNYX_KEY, EL_KEY, anrufIn(callId).streamToken, EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN];
  const antworten = [await sendeEreignis({ callId, typ: "call.answered" }), await sendeEreignis({ callId, typ: "call.answered", signatur: false })];
  assert.deepEqual(antworten.map((antwort) => antwort.status), [HTTP_OK, HTTP_FORBIDDEN]);
  for (const antwort of antworten) {
    const text = await antwort.text();
    for (const geheimnis of [...geheimnisse, audioToken]) assert.ok(!text.includes(geheimnis), "Geheimnis in der Antwort");
  }
  for (const anfrage of attrappe.anfragen)
    for (const geheimnis of geheimnisse) assert.ok(!anfrage.path.includes(geheimnis), `Geheimnis im Pfad ${anfrage.path}`);
  for (const geheimnis of [...geheimnisse, audioToken]) assert.ok(!srv.stdout.includes(geheimnis), "Geheimnis im Log");
});

test("3487: scheitert die Wahl, entsteht keine abrufbare Vorspann-Datei und spaetere Ereignisse bewirken keine Wiedergabe", async () => {
  const { attrappe } = umgebung;
  const to = naechsteNummer();
  await mitSteuerung({ dialFehler: true }, async () => {
    const antwort = await anrufStarten(to);
    assert.notEqual(antwort.status, HTTP_OK);
  });
  const { id: callId } = anrufeImStore().find((eintrag) => eintrag.to === to);
  assert.equal(anrufIn(callId).status, "failed");
  assert.equal((await sendeEreignis({ callId, typ: "call.answered", bein: beinVon(callId) })).status, HTTP_OK);
  await echtWarten(POLL_MS * 5);
  assert.equal(aktionen(attrappe, beinVon(callId), "playback_start").length, 0);
  assert.ok(!umgebung.srv.stdout.includes(FEHLER_DETAIL), "Anbieter-Detail im Log");
});

test("3365-C3: Ereignistyp ohne Behandlung (call.initiated) -> 200, keine Aktion und kein Fehler im Log", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await neuerAnruf();
  const vorher = alleAktionen(attrappe).length;
  assert.equal((await sendeEreignis({ callId, typ: "call.initiated" })).status, HTTP_OK);
  await echtWarten(POLL_MS * 5);
  assert.equal(alleAktionen(attrappe).length, vorher);
  assert.ok(!srv.stdout.includes(`[el-vorspann] ereignis fehlgeschlagen call=${callId}:`), srv.stdout);
});

test("3523: scheitert das Speichern beim Abheben -> das Bein wird genau einmal aufgelegt, der Fehler steht im Log, der Server laeuft weiter", async () => {
  const { attrappe, srv } = umgebung;
  const callId = await neuerAnruf();
  fs.chmodSync(srv.dataDir, READ_ONLY_DIR);
  try {
    assert.equal((await sendeEreignis({ callId, typ: "call.answered" })).status, HTTP_OK);
    await waitUntil(() => aktionen(attrappe, beinVon(callId), "hangup").length === EINMAL);
    await waitUntil(() => srv.stdout.includes(`[el-vorspann] ereignis fehlgeschlagen call=${callId}:`));
  } finally {
    fs.chmodSync(srv.dataDir, WRITABLE_DIR);
  }
  assert.equal(aktionen(attrappe, beinVon(callId), "playback_start").length, 0);
  assert.equal((await sendeEreignis({ callId: "gibt-es-nicht", typ: "call.answered" })).status, HTTP_OK);
});
