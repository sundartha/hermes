import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { EL_CALL_BINDING_SIP_HEADER } from "../src/elevenlabs/inbound-sip-uri.js";
import { CONFIG_NAMESPACES } from "../src/config.js";
import { VORSPANN_RUECKFALL } from "../src/elevenlabs/vorspann-pruefung.js";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../src/routes/webhooks-elevenlabs-init.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  OWNER_TEST_FIRST_NAME,
  TELNYX_TEST_PEER_NUMBER,
  seedCall,
  seedState,
  startServer,
  startServerExpectExit,
  waitUntil,
} from "./helpers.js";
import { elInboundInitSpawnEnv } from "./_iel-inbound-harness.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { gebauteKonfiguration } from "./gemeinsam/gebaute-konfiguration.js";

const TENANT_ID = seedCall().tenantId;
const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;
const EINMAL = 1;
const AGENT_ID = "agent_3365_h1";
const OBJECTIVE = "Termin am Donnerstag vereinbaren";
const TRAEGER_SID = "v3:ob-3365";
const TTS_PFAD = "/v1/text-to-speech/";
const TEXML_ANRUF_PFAD = "/v2/texml/calls/conn_3365";
const CALL_CONTROL_PFAD = "/v2/calls";
const CALL_CONTROL_APP_ID = "cc_app_3365";
const CALL_CONTROL_ID = "v3:cc-3365";
const TELNYX_KEY = "KEYtest-3365";
const EL_KEY = "test-key-3365";
const AUDIO_BYTES_PLAUSIBEL = 200_000;
const AUDIO_BYTES_ZU_KURZ = 10;
const UEBER_TELNYX = KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI;
const EN_STIMME = "ZSNL4hPqCnqoMPaI4jGX";
const OWNER_NAME_IM_STORE = "Jonas Beispiel";
const dritteroeffnung = (auftraggeber, openingLine) =>
  `Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${auftraggeber}. Das Gespräch wird für meinen Auftraggeber zusammengefasst. ${openingLine}`;
const ownerEroeffnung = (openingLine) => `Hey, hier ist Hermes, dein KI-Assistent. ${openingLine}`;
const PLATZHALTER_NAME = "{{platzhalter}}";
const LEERER_NAME = " ";

const TTS_MODUS = Object.freeze({
  OK: "ok",
  FEHLER: "fehler",
  UNVOLLSTAENDIG: "unvollstaendig",
  ZU_KURZ: "zu_kurz",
});

async function starteAttrappe({ ttsModus = TTS_MODUS.OK, ersteTtsAntwortNach = Promise.resolve() } = {}) {
  const anfragen = [];
  const zustand = { ttsModus };
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", async () => {
      anfragen.push({ method: req.method, path: req.url, roh });
      if (req.url.startsWith(TTS_PFAD)) {
        const warteAufFreigabe = nach({ anfragen }, TTS_PFAD).length === EINMAL ? ersteTtsAntwortNach : undefined;
        await warteAufFreigabe;
        return antworteTts(res, zustand.ttsModus);
      }
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      if (req.url === CALL_CONTROL_PFAD) return res.end(JSON.stringify({ data: { call_control_id: CALL_CONTROL_ID } }));
      res.end(JSON.stringify({ data: { sid: TRAEGER_SID } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    anfragen,
    setzeTtsModus: (modus) => {
      zustand.ttsModus = modus;
    },
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function antworteTts(res, modus) {
  if (modus === TTS_MODUS.FEHLER) {
    res.writeHead(HTTP_SERVICE_UNAVAILABLE, { "content-type": "application/json" });
    return res.end("{}");
  }
  res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
  if (modus === TTS_MODUS.ZU_KURZ) return res.end(Buffer.alloc(AUDIO_BYTES_ZU_KURZ, 1));
  if (modus === TTS_MODUS.OK) return res.end(Buffer.alloc(AUDIO_BYTES_PLAUSIBEL, 1));
  res.write(Buffer.alloc(AUDIO_BYTES_PLAUSIBEL, 1), () => res.destroy());
}

const nach = (attrappe, pfad) =>
  attrappe.anfragen.filter((anfrage) => anfrage.method === "POST" && anfrage.path.startsWith(pfad));

const SCHALTER_AN = { ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true" };
const VORSPANN_AN = { ELEVENLABS_OUTBOUND_VORSPANN: "true", TELNYX_CALL_CONTROL_APP_ID: CALL_CONTROL_APP_ID };

async function mitServer({ env = {}, seed, ttsModus, ersteTtsAntwortNach }, run) {
  const attrappe = await starteAttrappe({ ttsModus, ersteTtsAntwortNach });
  const srv = await startServer({
    env: {
      ...elInboundInitSpawnEnv(AGENT_ID),
      ELEVENLABS_OUTBOUND_ENABLED: "true",
      ELEVENLABS_API_KEY: EL_KEY,
      ELEVENLABS_API_BASE: attrappe.url,
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_global_3365",
      ELEVENLABS_RESULT_POLL_MS: "60000",
      TELNYX_API_BASE: attrappe.url,
      TELNYX_API_KEY: TELNYX_KEY,
      TELNYX_CONNECTION_ID: "conn_3365",
      TELNYX_ACCOUNT_SID: "acct_3365",
      ...SCHALTER_AN,
      ...env,
    },
    seed,
  });
  try {
    await run({ srv, attrappe });
  } finally {
    await srv.stop();
    await attrappe.close();
  }
}

const ANDERE_NUMMER = "+4915112345679";
const DRITTE_NUMMER = "+4915112345680";

const anrufStarten = (srv, wartezeitMs = 0, to = TELNYX_TEST_PEER_NUMBER) =>
  abrufMitFrist(
    `${srv.localUrl}/api/calls`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, objective: OBJECTIVE }),
    },
    { wartezeitMs },
  );
const anrufIn = (srv, id) => srv.readStore().calls.find((eintrag) => eintrag.id === id);

const voiceOutbound = (srv, callId) =>
  abrufMitFrist(`${srv.localUrl}/voice/outbound?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallSid: TRAEGER_SID }).toString(),
  });

const rueckfallZeile = (grund, callId) => `[el-vorspann] rueckfall grund=${grund} call=${callId}`;

function mitEigentuemer({ ownerName = OWNER_NAME_IM_STORE, privateNumber } = {}) {
  return seedState({
    tenants: [
      {
        id: TENANT_ID,
        status: "active",
        ownerName,
        firstName: OWNER_TEST_FIRST_NAME,
        ...(privateNumber ? { privateNumber } : {}),
      },
    ],
  });
}

const TTS_QUOTE = 39981;
const ALARM_NUMMER = "+4915100000099";
const ZYKLUS_ANKER_TAG = "1";

function mitTtsVerbrauch(zeichen) {
  const jetzt = new Date();
  const zyklus = `${jetzt.getUTCFullYear()}-${String(jetzt.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    ...mitEigentuemer(),
    platformTtsUsage: { cycleKey: zyklus, characters: zeichen, warnedCycle: null },
  };
}

const zeichenGebucht = (srv) => srv.readStore().platformTtsUsage?.characters ?? 0;

function normalisiert(text, call) {
  return text.replaceAll(call.id, "call_X").replaceAll(call.streamToken ?? "kein-token", "TOKEN");
}

async function telnyxWahlUndTeXml(env) {
  let ergebnis;
  await mitServer({ env }, async ({ srv, attrappe }) => {
    const antwort = await anrufStarten(srv);
    const { callId } = await antwort.json();
    const call = anrufIn(srv, callId);
    const formular = Object.fromEntries(new URLSearchParams(nach(attrappe, TEXML_ANRUF_PFAD)[0].roh));
    ergebnis = {
      formular: JSON.parse(normalisiert(JSON.stringify(formular), call)),
      texml: normalisiert(await (await voiceOutbound(srv, callId)).text(), call),
      ttsAufrufe: nach(attrappe, TTS_PFAD).length,
      callControlAufrufe: nach(attrappe, CALL_CONTROL_PFAD).length,
      wahlen: nach(attrappe, TEXML_ANRUF_PFAD).length,
      vorspannLog: srv.stdout.includes("[el-vorspann]"),
    };
  });
  return ergebnis;
}

test("3365-K1: Schalter aus (auch mit gesetzter Call-Control-App) -> genau ein TeXML-Wahlversuch, kein TTS, kein POST /v2/calls, TeXML byte-gleich, keine el-vorspann-Logzeile", async () => {
  const heute = await telnyxWahlUndTeXml({});
  const mitAppId = await telnyxWahlUndTeXml({
    TELNYX_CALL_CONTROL_APP_ID: CALL_CONTROL_APP_ID,
    ELEVENLABS_OUTBOUND_VORSPANN: "",
  });
  for (const lauf of [heute, mitAppId]) {
    assert.equal(lauf.wahlen, EINMAL);
    assert.equal(lauf.ttsAufrufe, 0);
    assert.equal(lauf.callControlAufrufe, 0);
    assert.equal(lauf.vorspannLog, false);
  }
  assert.deepEqual(mitAppId.formular, heute.formular);
  assert.equal(mitAppId.texml, heute.texml);
});

test("3365-K2: Schalter an ohne Call-Control-App -> TeXML wie heute plus Rueckfall-Logzeile keine_call_control_app", async () => {
  await mitServer({ env: { ELEVENLABS_OUTBOUND_VORSPANN: "true" } }, async ({ srv, attrappe }) => {
    const antwort = await anrufStarten(srv);
    const { callId } = await antwort.json();
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(nach(attrappe, TEXML_ANRUF_PFAD).length, EINMAL);
    assert.equal(nach(attrappe, TTS_PFAD).length, 0);
    assert.equal(nach(attrappe, CALL_CONTROL_PFAD).length, 0);
    assert.ok(srv.stdout.includes(rueckfallZeile(VORSPANN_RUECKFALL.KEINE_CALL_CONTROL_APP, callId)), srv.stdout);
    assert.equal(anrufIn(srv, callId).costProfile, UEBER_TELNYX);
  });
});

test("3365-K3: Vorspann-Text und Stimme stammen aus der Init-Eroeffnung -> TTS 1x, danach TeXML, Logzeile bereit, Zeichen gebucht, keine Geheimnisse im Log", async () => {
  const env = { ...VORSPANN_AN, ELEVENLABS_TOOL_TOKEN: "el-tool-token-3365" };
  await mitServer({ env, seed: mitEigentuemer() }, async ({ srv, attrappe }) => {
    const antwort = await anrufStarten(srv);
    const { callId } = await antwort.json();
    assert.equal(antwort.status, HTTP_OK);
    const call = anrufIn(srv, callId);
    const tts = nach(attrappe, TTS_PFAD);
    assert.equal(tts.length, EINMAL);
    assert.equal(call.language, "en");
    assert.equal(new URL(tts[0].path, attrappe.url).pathname, `${TTS_PFAD}${EN_STIMME}/stream`);
    const text = JSON.parse(tts[0].roh).text;
    assert.equal(text, dritteroeffnung(OWNER_NAME_IM_STORE, call.openingLine));
    assert.equal(nach(attrappe, TEXML_ANRUF_PFAD).length, 0);
    assert.equal(nach(attrappe, CALL_CONTROL_PFAD).length, EINMAL);
    assert.equal(call.callControlId, CALL_CONTROL_ID);
    assert.ok(srv.stdout.includes(`[el-vorspann] bereit call=${callId}`), srv.stdout);
    assert.ok(srv.stdout.includes(`[el-outbound-weg] weg=telnyx_vorspann call=${callId}`), srv.stdout);
    assert.equal(call.costProfile, UEBER_TELNYX);
    assert.equal(zeichenGebucht(srv), text.length, "K4: die Vorspann-Zeichen stehen auf der Plattform-TTS-Quote");
    keineGeheimnisseIm(srv.stdout, call);
    await voiceOutbound(srv, callId);
    const init = await initAntwort(srv, call);
    assert.equal(init.conversation_config_override.agent.first_message, "", "der Anbieter spricht die Eroeffnung nicht noch einmal");
    assert.equal(init.dynamic_variables.eroeffnung_gesagt, text, "wortgleich der gesprochene Vorspann");
  });
});

async function initAntwort(srv, call) {
  const antwort = await abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INIT_TOKEN_HEADER]: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN,
    },
    body: JSON.stringify({
      agent_id: AGENT_ID,
      conversation_id: "conv_3365_init",
      called_number: call.from,
      sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: call.streamToken },
    }),
  });
  const init = await antwort.json();
  assert.equal(antwort.status, HTTP_OK, JSON.stringify(init));
  return init;
}

test("3365-K3: leerer Auftraggebername -> Offenlegung mit Ersatzname, nie leer", async () => {
  await mitServer({ env: VORSPANN_AN, seed: mitEigentuemer({ ownerName: LEERER_NAME }) }, async ({ srv, attrappe }) => {
    const { callId } = await (await anrufStarten(srv)).json();
    const call = anrufIn(srv, callId);
    const text = JSON.parse(nach(attrappe, TTS_PFAD)[0].roh).text;
    assert.equal(text, dritteroeffnung("meinem Auftraggeber", call.openingLine));
  });
});

test("3365-K3: Eroeffnung mit Platzhalter -> Rueckfall grund=eroeffnung, kein TTS, TeXML wie heute", async () => {
  await mitServer({ env: VORSPANN_AN, seed: mitEigentuemer({ ownerName: PLATZHALTER_NAME }) }, async ({ srv, attrappe }) => {
    const antwort = await anrufStarten(srv);
    const { callId } = await antwort.json();
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(nach(attrappe, TTS_PFAD).length, 0);
    assert.equal(nach(attrappe, TEXML_ANRUF_PFAD).length, EINMAL);
    assert.ok(srv.stdout.includes(rueckfallZeile(VORSPANN_RUECKFALL.EROEFFNUNG, callId)), srv.stdout);
  });
});

test("3365-K3: Anruf an die eigene Nummer -> Vorspann ist die Owner-Eroeffnung, nicht der Dritt-Satz", async () => {
  const env = {
    ...VORSPANN_AN,
    OWNER_SELF_CALL_ENABLED: "true",
    OWNER_SELF_CALL_TENANT_IDS: TENANT_ID,
  };
  await mitServer({ env, seed: mitEigentuemer({ privateNumber: TELNYX_TEST_PEER_NUMBER }) }, async ({ srv, attrappe }) => {
    const { callId } = await (await anrufStarten(srv)).json();
    const call = anrufIn(srv, callId);
    assert.equal(call.calleeIsOwner, true);
    const text = JSON.parse(nach(attrappe, TTS_PFAD)[0].roh).text;
    assert.equal(text, ownerEroeffnung(call.openingLine));
  });
});

test("3365-K4: Plattform-TTS-Quote erschoepft -> Rueckfall grund=tts_quote ohne TTS-Aufruf", async () => {
  await mitServer({ env: { ...VORSPANN_AN, TTS_QUOTA_CYCLE_ANCHOR_DAY: ZYKLUS_ANKER_TAG }, seed: mitTtsVerbrauch(TTS_QUOTE) }, async ({ srv, attrappe }) => {
    const antwort = await anrufStarten(srv);
    const { callId } = await antwort.json();
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(nach(attrappe, TTS_PFAD).length, 0);
    assert.equal(nach(attrappe, TEXML_ANRUF_PFAD).length, EINMAL);
    assert.ok(srv.stdout.includes(rueckfallZeile(VORSPANN_RUECKFALL.TTS_QUOTE, callId)), srv.stdout);
  });
});

const TTS_RUECKFAELLE = [
  [VORSPANN_RUECKFALL.TTS_FEHLER, TTS_MODUS.FEHLER, TELNYX_TEST_PEER_NUMBER],
  [VORSPANN_RUECKFALL.TTS_UNVOLLSTAENDIG, TTS_MODUS.UNVOLLSTAENDIG, ANDERE_NUMMER],
  [VORSPANN_RUECKFALL.TTS_UNPLAUSIBEL, TTS_MODUS.ZU_KURZ, DRITTE_NUMMER],
];

test("3365-K5: TTS-Fehler, abgebrochener Strom und unplausibles Audio -> heutiger TeXML-Weg, Logzeile mit Grund, keine Geheimnisse im Log", async () => {
  await mitServer({ env: VORSPANN_AN, seed: mitEigentuemer() }, async ({ srv, attrappe }) => {
    for (const [index, [grund, ttsModus, nummer]] of TTS_RUECKFAELLE.entries()) {
      attrappe.setzeTtsModus(ttsModus);
      const antwort = await anrufStarten(srv, 0, nummer);
      const { callId } = await antwort.json();
      assert.equal(antwort.status, HTTP_OK);
      assert.equal(nach(attrappe, TTS_PFAD).length, index + 1);
      assert.equal(nach(attrappe, TEXML_ANRUF_PFAD).length, index + 1);
      assert.equal(nach(attrappe, CALL_CONTROL_PFAD).length, 0);
      assert.ok(srv.stdout.includes(rueckfallZeile(grund, callId)), srv.stdout);
      if (ttsModus === TTS_MODUS.FEHLER) assert.equal(zeichenGebucht(srv), 0, "ein fehlgeschlagener Aufruf bucht keine Zeichen");
      keineGeheimnisseIm(srv.stdout, anrufIn(srv, callId));
    }
    assert.doesNotMatch(srv.stdout, /\[el-vorspann\] bereit/);
  });
});

function keineGeheimnisseIm(log, call) {
  const geheimnisse = [
    EL_KEY,
    TELNYX_KEY,
    EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INBOUND_SIP_PASSWORD,
    EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN,
    call.streamToken,
  ].filter(Boolean);
  for (const geheimnis of geheimnisse) assert.ok(!log.includes(geheimnis), "Geheimnis im Log");
  for (const zeile of log.split("\n").filter((eintrag) => eintrag.includes("[el-vorspann]")))
    assert.doesNotMatch(zeile, /key|token|passwor/i, zeile);
}

test("3365-K4: Quote erst zwischen Pruefung und Buchung erschoepft -> grund=tts_quote fuer den spaeteren Anruf", async () => {
  let freigeben;
  const ersteTtsAntwortNach = new Promise((resolve) => (freigeben = resolve));
  const env = { ...VORSPANN_AN, TTS_QUOTA_CYCLE_ANCHOR_DAY: ZYKLUS_ANKER_TAG, ELEVENLABS_SYNTH_TIMEOUT_MS: "10000" };
  await mitServer({ env, seed: mitTtsVerbrauch(TTS_QUOTE - 1), ersteTtsAntwortNach }, async ({ srv, attrappe }) => {
    const ersterAnruf = anrufStarten(srv);
    await waitUntil(() => nach(attrappe, TTS_PFAD).length === EINMAL);
    const zweiterAnruf = await (await anrufStarten(srv, 0, ANDERE_NUMMER)).json();
    freigeben();
    const { callId } = await (await ersterAnruf).json();
    assert.ok(srv.stdout.includes(`[el-vorspann] bereit call=${zweiterAnruf.callId}`), srv.stdout);
    assert.ok(srv.stdout.includes(rueckfallZeile(VORSPANN_RUECKFALL.TTS_QUOTE, callId)), srv.stdout);
  });
});

test("3365-K4: Vorspann-Zeichen ueber der Warnschwelle loesen die Alarm-SMS aus", async () => {
  const warnschwelleProzent = 50;
  const env = {
    ...VORSPANN_AN,
    TTS_QUOTA_CYCLE_ANCHOR_DAY: ZYKLUS_ANKER_TAG,
    TTS_CHARACTER_QUOTA_WARN_PERCENT: String(warnschwelleProzent),
    PLATFORM_ALERT_SMS_TO: ALARM_NUMMER,
  };
  const knappUnterDerSchwelle = Math.floor((TTS_QUOTE * warnschwelleProzent) / 100) - 100;
  await mitServer({ env, seed: mitTtsVerbrauch(knappUnterDerSchwelle) }, async ({ srv, attrappe }) => {
    await anrufStarten(srv);
    await waitUntil(() => nach(attrappe, "/v2/messages").length === EINMAL);
    const sms = JSON.parse(nach(attrappe, "/v2/messages")[0].roh);
    assert.equal(sms.to, ALARM_NUMMER);
    assert.match(sms.text, /Kontingent-Warnschwelle/);
  });
});

const FELDER = ["voice.elevenLabsOutbound.vorspann", "telephony.telnyxCallControlAppId"];
const SCHALTER = "voice.elevenLabsOutbound.vorspann";
const APP_ID = "telephony.telnyxCallControlAppId";

test("3365-Konfig: die Call-Control-App-Kennung ist im Namensraum telephony der Konfiguration eingetragen", () => {
  assert.ok(CONFIG_NAMESPACES.telephony.includes("telnyxCallControlAppId"));
});

test("3365-Konfig: ohne Variablen ist der Vorspann-Weg aus und keine Call-Control-App gesetzt", () => {
  const ohneVariablen = { ELEVENLABS_OUTBOUND_VORSPANN: undefined, TELNYX_CALL_CONTROL_APP_ID: undefined };
  assert.deepEqual(gebauteKonfiguration(ohneVariablen, FELDER), { [SCHALTER]: false, [APP_ID]: "" });
});

test("3365-Konfig: der Schalter kommt aus der Umgebung, die App-Kennung wird getrimmt", () => {
  assert.deepEqual(
    gebauteKonfiguration({ ELEVENLABS_OUTBOUND_VORSPANN: "true", TELNYX_CALL_CONTROL_APP_ID: "  abc  " }, FELDER),
    { [SCHALTER]: true, [APP_ID]: "abc" },
  );
});

test("3365-Konfig: eine nur aus Leerzeichen bestehende App-Kennung zaehlt als nicht gesetzt", () => {
  assert.deepEqual(
    gebauteKonfiguration({ ELEVENLABS_OUTBOUND_VORSPANN: "false", TELNYX_CALL_CONTROL_APP_ID: "   " }, FELDER),
    { [SCHALTER]: false, [APP_ID]: "" },
  );
});

test("3365-Konfig: ein ungueltiger Schalterwert verweigert den Start und nennt die Variable", async () => {
  const { code, output } = await startServerExpectExit({ env: { ELEVENLABS_OUTBOUND_VORSPANN: "vielleicht" } });
  assert.equal(code, 1);
  assert.match(output, /ELEVENLABS_OUTBOUND_VORSPANN="vielleicht" ist kein gueltiger Boolean/);
});
