import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  OWNER_TEST_FIRST_NAME,
  seedCall,
  seedState,
  startServer,
  waitUntil as wartebis,
} from "../helpers.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_CONFLICT = 409;
const HTTP_BAD_GATEWAY = 502;
const HTTP_UNPROCESSABLE = 422;
const HTTP_SERVER_FEHLER = 500;
const WARTE_FRIST_MS = 5_000;
const NUMMER_PRAEFIX = "+4915112350";
const EINMAL = 1;
const KURZE_MAX_DAUER_S = 1;
const AGENT_ID = "agent_3365_h2a2";
const OBJECTIVE = "Termin am Donnerstag vereinbaren";
const TTS_PFAD = "/v1/text-to-speech/";
const TEXML_PFAD = "/v2/texml/calls/conn_3365";
const WAHL_PFAD = "/v2/calls";
const AKTION_PFAD = "/v2/calls/";
const APP_ID = "cc_app_3365";
const TELNYX_KEY = "KEYtest-3365";
const EL_KEY = "test-key-3365";
const AUDIO_BYTES = 200_000;
const PUBLIC_URL = "https://agent.test";
const SIP_PASSWORT = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD;
const FEHLER_DETAIL = "detail-mit-geheimnis";
const DEPLOY_TOKEN = "3365-vorspann-deploy-token-mindestens-32";
const TRAEGER_SID = "v3:ob-3365-h2a2";

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });
const koerper = (anfrage) => JSON.parse(anfrage.roh);
const beinVon = (callId) => `cc_callee_${callId}`;
const nachPfad = (attrappe, pfad) => attrappe.anfragen.filter((anfrage) => anfrage.method === "POST" && anfrage.path === pfad);
const wahlen = (attrappe, callId) => nachPfad(attrappe, WAHL_PFAD).filter((anfrage) => koerper(anfrage).command_id.endsWith(callId));
const aufleger = (attrappe, callId) => nachPfad(attrappe, `${AKTION_PFAD}${beinVon(callId)}/actions/hangup`);
const ttsAnfragen = (attrappe) => attrappe.anfragen.filter((anfrage) => anfrage.path.startsWith(TTS_PFAD));

async function antworteWahl(res, anfrage, steuerung) {
  await steuerung.wahlWartet;
  const callId = koerper(anfrage).command_id.replace(/^vorspann-/, "");
  if (steuerung.dialAbbruch) return res.socket.destroy();
  if (steuerung.dialFehler) {
    res.writeHead(HTTP_UNPROCESSABLE, { "content-type": "application/json" });
    return res.end(JSON.stringify({ errors: [{ code: "10015", title: "Invalid", detail: FEHLER_DETAIL }] }));
  }
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: steuerung.ohneKennung ? {} : { call_control_id: beinVon(callId) } }));
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
      if (req.url === WAHL_PFAD) return antworteWahl(res, anfrage, steuerung);
      if (req.url.endsWith("/actions/hangup") && steuerung.hangupFehler) {
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

const serverEinstellungen = (attrappe, env = {}) => ({
  env: {
    ...elInboundInitSpawnEnv(AGENT_ID),
    ELEVENLABS_OUTBOUND_ENABLED: "true",
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    TELNYX_CALL_CONTROL_APP_ID: APP_ID,
    ELEVENLABS_API_KEY: EL_KEY,
    ELEVENLABS_API_BASE: attrappe.url,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3365",
    ELEVENLABS_RESULT_POLL_MS: "60000",
    TELNYX_API_BASE: attrappe.url,
    TELNYX_API_KEY: TELNYX_KEY,
    TELNYX_CONNECTION_ID: "conn_3365",
    TELNYX_ACCOUNT_SID: "acct_3365",
    PUBLIC_URL,
    HERMES_DEPLOY_TOKEN: DEPLOY_TOKEN,
    ...env,
  },
  seed: seedState({ tenants: [{ id: TENANT_ID, status: "active", ownerName: "Jonas Beispiel", firstName: OWNER_TEST_FIRST_NAME }] }),
});

before(async () => {
  umgebung.attrappe = await starteAttrappe();
  umgebung.srv = await startServer(serverEinstellungen(umgebung.attrappe));
});

after(async () => {
  await umgebung.srv.stop();
  await umgebung.attrappe.close();
});

let anrufZaehler = 0;
const naechsteNummer = () => `${NUMMER_PRAEFIX}${String((anrufZaehler += EINMAL)).padStart(3, "0")}`;

const anrufStarten = (to = naechsteNummer(), extra = {}, srv = umgebung.srv) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to, objective: OBJECTIVE, ...extra }),
  });
const anrufZu = (to, srv = umgebung.srv) => srv.readStore().calls.find((eintrag) => eintrag.to === to);
const anrufIn = (id) => {
  const { srv } = umgebung;
  return srv.readStore().calls.find((eintrag) => eintrag.id === id);
};
const abbrechen = (callId) => abrufMitFrist(`${umgebung.srv.localUrl}/api/calls/${callId}/cancel`, { method: "POST" });

async function mitSteuerung(werte, run) {
  Object.assign(umgebung.attrappe.steuerung, werte);
  try {
    await run();
  } finally {
    for (const schluessel of Object.keys(werte)) delete umgebung.attrappe.steuerung[schluessel];
  }
}

const gewaehlteAnfrage = (attrappe, to) => nachPfad(attrappe, WAHL_PFAD).find((anfrage) => anfrage.roh.includes(`"to":"${to}"`));

test("3365-B1: Schalter aus oder ohne Call-Control-App -> genau ein TeXML-Aufruf, kein POST /v2/calls", async () => {
  for (const env of [{ ELEVENLABS_OUTBOUND_VORSPANN: "false" }, { TELNYX_CALL_CONTROL_APP_ID: "" }]) {
    const attrappe = await starteAttrappe();
    const srv = await startServer(serverEinstellungen(attrappe, env));
    try {
      const antwort = await anrufStarten(naechsteNummer(), {}, srv);
      assert.equal(antwort.status, HTTP_OK);
      assert.equal(nachPfad(attrappe, TEXML_PFAD).length, EINMAL);
      assert.equal(nachPfad(attrappe, WAHL_PFAD).length, 0);
    } finally {
      await srv.stop();
      await attrappe.close();
    }
  }
});

test("3365-B2: Schalter an, Vorspann bereit -> genau ein POST /v2/calls mit allen Feldern, kein TeXML, Kennung am Anruf", async () => {
  const { attrappe } = umgebung;
  const to = naechsteNummer();
  const texmlVorher = nachPfad(attrappe, TEXML_PFAD).length;
  const antwort = await anrufStarten(to);
  const { callId } = await antwort.json();
  assert.equal(antwort.status, HTTP_OK);
  assert.equal(wahlen(attrappe, callId).length, EINMAL);
  assert.equal(nachPfad(attrappe, TEXML_PFAD).length, texmlVorher);
  const call = anrufIn(callId);
  assert.equal(call.callControlId, beinVon(callId));
  assert.equal(call.status, "active");
  assert.ok(!umgebung.srv.stdout.includes(`rueckfall grund=null call=${callId}`), umgebung.srv.stdout);
  assert.deepEqual(koerper(wahlen(attrappe, callId)[0]), {
    connection_id: APP_ID,
    to,
    from: call.from,
    webhook_url: `${PUBLIC_URL}/voice/vorspann?callId=${callId}`,
    time_limit_secs: call.maxDurationS,
    command_id: `vorspann-${callId}`,
  });
});

test("3365-B2: Max-Dauer-Timer des Anrufs legt das Call-Control-Bein auf und beendet den Anruf", async () => {
  const { attrappe } = umgebung;
  const to = naechsteNummer();
  const { callId } = await (await anrufStarten(to, { max_duration_s: KURZE_MAX_DAUER_S })).json();
  assert.equal(koerper(wahlen(attrappe, callId)[0]).time_limit_secs, KURZE_MAX_DAUER_S);
  await waitUntil(() => aufleger(attrappe, callId).length === EINMAL);
  await waitUntil(() => anrufIn(callId).status === "completed");
});

test("3365-B3: Wahl scheitert (HTTP 422) -> kein TeXML-Versuch, Anruf failed, Fehlerdetail des Anbieters nicht im Log", async () => {
  const { attrappe, srv } = umgebung;
  const to = naechsteNummer();
  const texmlVorher = nachPfad(attrappe, TEXML_PFAD).length;
  await mitSteuerung({ dialFehler: true }, async () => {
    assert.equal((await anrufStarten(to)).status, HTTP_BAD_GATEWAY);
  });
  assert.equal(nachPfad(attrappe, TEXML_PFAD).length, texmlVorher);
  assert.equal(anrufZu(to).status, "failed");
  assert.ok(!srv.stdout.includes(FEHLER_DETAIL), "Anbieter-Detail im Log");
  assert.ok(!srv.stdout.includes(TELNYX_KEY), "Schluessel im Log");
});

test("3365-B3: Wahl bricht ab (Verbindung getrennt) -> kein TeXML-Versuch, Anruf failed", async () => {
  const { attrappe } = umgebung;
  const to = naechsteNummer();
  const texmlVorher = nachPfad(attrappe, TEXML_PFAD).length;
  await mitSteuerung({ dialAbbruch: true }, async () => {
    assert.equal((await anrufStarten(to)).status, HTTP_SERVER_FEHLER);
  });
  assert.equal(nachPfad(attrappe, TEXML_PFAD).length, texmlVorher);
  assert.equal(anrufZu(to).status, "failed");
});

test("3365-B3: liefert der Anbieter keine Kennung -> Wahl gescheitert, Anruf failed, kein TeXML", async () => {
  const { attrappe, srv } = umgebung;
  const to = naechsteNummer();
  const texmlVorher = nachPfad(attrappe, TEXML_PFAD).length;
  await mitSteuerung({ ohneKennung: true }, async () => {
    assert.equal((await anrufStarten(to)).status, HTTP_SERVER_FEHLER);
  });
  assert.equal(anrufZu(to).status, "failed");
  assert.ok(srv.stdout.includes("keine Kennung fuer das neue Bein"), srv.stdout);
  assert.equal(nachPfad(attrappe, TEXML_PFAD).length, texmlVorher);
});

test("3365-B4: cancel_call waehrend des TTS-Wartens -> keine Wahl, kein TeXML, 409, Logzeile abgebrochen_vor_wahl", async () => {
  const { attrappe, srv } = umgebung;
  let freigeben;
  const ttsWartet = new Promise((resolve) => (freigeben = resolve));
  const to = naechsteNummer();
  const ttsVorher = ttsAnfragen(attrappe).length;
  const texmlVorher = nachPfad(attrappe, TEXML_PFAD).length;
  await mitSteuerung({ ttsWartet }, async () => {
    const start = anrufStarten(to);
    await waitUntil(() => ttsAnfragen(attrappe).length > ttsVorher);
    const call = anrufZu(to);
    assert.equal((await abbrechen(call.id)).status, HTTP_OK);
    freigeben();
    const antwort = await start;
    assert.equal(antwort.status, HTTP_CONFLICT);
    assert.deepEqual(await antwort.json(), { error: "Der Anruf wurde vor dem Waehlen abgebrochen. Es wurde nicht gewaehlt.", callId: call.id });
    assert.equal(wahlen(attrappe, call.id).length, 0);
    assert.equal(nachPfad(attrappe, TEXML_PFAD).length, texmlVorher);
    assert.equal(anrufIn(call.id).status, "cancelled");
    assert.ok(srv.stdout.includes(`[el-vorspann] rueckfall grund=abgebrochen_vor_wahl call=${call.id}`), srv.stdout);
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

test("3365-B4: Anrufpause waehrend des TTS-Wartens -> keine Wahl, kein TeXML, Anruf failed, Logzeile gesperrt_vor_wahl", async () => {
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
  const call = anrufZu(to);
  assert.equal(wahlen(attrappe, call.id).length, 0);
  assert.equal(nachPfad(attrappe, TEXML_PFAD).length, texmlVorher);
  assert.equal(call.status, "failed");
  assert.ok(srv.stdout.includes(`[el-vorspann] rueckfall grund=gesperrt_vor_wahl call=${call.id}`), srv.stdout);
  assert.ok(srv.stdout.includes("Ausgehende Anrufe sind gesperrt"), srv.stdout);
});

test("3365-B5: Anruf waehrend der Wahl abgebrochen -> das frisch angelegte Bein wird sofort aufgelegt; scheitert das Auflegen, steht es im Log", async () => {
  const { attrappe, srv } = umgebung;
  for (const hangupFehler of [false, true]) {
    let freigeben;
    const wahlWartet = new Promise((resolve) => (freigeben = resolve));
    const to = naechsteNummer();
    await mitSteuerung({ wahlWartet, hangupFehler }, async () => {
      const start = anrufStarten(to);
      await waitUntil(() => anrufZu(to) && gewaehlteAnfrage(attrappe, to));
      const call = anrufZu(to);
      assert.equal((await abbrechen(call.id)).status, HTTP_OK);
      assert.equal(aufleger(attrappe, call.id).length, 0);
      freigeben();
      await start;
      await waitUntil(() => aufleger(attrappe, call.id).length >= EINMAL);
      if (hangupFehler) await waitUntil(() => srv.stdout.includes(`[el-vorspann] auflegen fehlgeschlagen call=${call.id}:`));
      else assert.ok(!srv.stdout.includes(`auflegen fehlgeschlagen call=${call.id}`));
    });
  }
});

test("3365-B6: cancel_call legt das Call-Control-Bein auf", async () => {
  const { attrappe } = umgebung;
  const { callId } = await (await anrufStarten()).json();
  assert.equal(aufleger(attrappe, callId).length, 0);
  assert.equal((await abbrechen(callId)).status, HTTP_OK);
  await waitUntil(() => aufleger(attrappe, callId).length === EINMAL);
});

test("3365-B7: keine Geheimnisse in Anfragepfaden, Webhook-URLs, Rufnummern und Log", async () => {
  const { attrappe, srv } = umgebung;
  const { callId } = await (await anrufStarten()).json();
  const call = anrufIn(callId);
  const geheimnisse = [SIP_PASSWORT, TELNYX_KEY, EL_KEY, DEPLOY_TOKEN, call.streamToken, EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN];
  for (const anfrage of attrappe.anfragen)
    for (const geheimnis of geheimnisse) assert.ok(!anfrage.path.includes(geheimnis), `Geheimnis im Pfad ${anfrage.path}`);
  const feld = koerper(wahlen(attrappe, callId)[0]);
  for (const url of [feld.webhook_url, feld.to, feld.from])
    for (const geheimnis of geheimnisse) assert.ok(!url.includes(geheimnis), `Geheimnis in ${url}`);
  for (const geheimnis of geheimnisse) assert.ok(!srv.stdout.includes(geheimnis), "Geheimnis im Log");
});
