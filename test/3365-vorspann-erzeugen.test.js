import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { VORSPANN_TTS_FRIST_MS, eroeffnungRueckfall } from "../src/elevenlabs/vorspann-pruefung.js";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  OWNER_TEST_FIRST_NAME,
  TELNYX_TEST_PEER_NUMBER,
  seedCall,
  seedState,
  startServer,
} from "./helpers.js";
import { elInboundInitSpawnEnv } from "./_iel-inbound-harness.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";

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
const TELNYX_KEY = "KEYtest-3365";
const EL_KEY = "test-key-3365";
const AUDIO_BYTES_PLAUSIBEL = 200_000;
const AUDIO_BYTES_ZU_KURZ = 10;
const HALTEZEIT_MS = 60_000;
const UNTERBRECHUNGS_VERZUG_MS = 50;
const UEBER_TELNYX = KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI;
const EN_STIMME = "ZSNL4hPqCnqoMPaI4jGX";
const OWNER_NAME_IM_STORE = "Jonas Beispiel";
const dritteroeffnung = (auftraggeber, openingLine) =>
  `Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${auftraggeber}. Das Gespräch wird für meinen Auftraggeber zusammengefasst. ${openingLine}`;
const ownerEroeffnung = (vorname, openingLine) => `Hallo ${vorname}, hier ist dein KI-Assistent. ${openingLine}`;
const PLATZHALTER_NAME = "{{platzhalter}}";
const LEERER_NAME = " ";

const TTS_MODUS = Object.freeze({
  OK: "ok",
  FEHLER: "fehler",
  UNVOLLSTAENDIG: "unvollstaendig",
  HAENGT: "haengt",
  ZU_KURZ: "zu_kurz",
});

async function starteAttrappe({ ttsModus = TTS_MODUS.OK } = {}) {
  const anfragen = [];
  const server = http.createServer((req, res) => {
    let roh = "";
    req.on("data", (teil) => (roh += teil));
    req.on("end", () => {
      anfragen.push({ method: req.method, path: req.url, roh });
      if (req.url.startsWith(TTS_PFAD)) return antworteTts(res, ttsModus);
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { sid: TRAEGER_SID } }));
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

function antworteTts(res, modus) {
  if (modus === TTS_MODUS.FEHLER) {
    res.writeHead(HTTP_SERVICE_UNAVAILABLE, { "content-type": "application/json" });
    return res.end("{}");
  }
  res.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
  if (modus === TTS_MODUS.ZU_KURZ) return res.end(Buffer.alloc(AUDIO_BYTES_ZU_KURZ, 1));
  if (modus === TTS_MODUS.OK) return res.end(Buffer.alloc(AUDIO_BYTES_PLAUSIBEL, 1));
  res.write(Buffer.alloc(AUDIO_BYTES_PLAUSIBEL, 1));
  if (modus === TTS_MODUS.UNVOLLSTAENDIG) setTimeout(() => res.destroy(), UNTERBRECHUNGS_VERZUG_MS);
  if (modus === TTS_MODUS.HAENGT) setTimeout(() => res.end(), HALTEZEIT_MS).unref();
}

const nach = (attrappe, pfad) =>
  attrappe.anfragen.filter((anfrage) => anfrage.method === "POST" && anfrage.path.startsWith(pfad));

const SCHALTER_AN = { ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true" };
const VORSPANN_AN = { ELEVENLABS_OUTBOUND_VORSPANN: "true", TELNYX_CALL_CONTROL_APP_ID: CALL_CONTROL_APP_ID };

async function mitServer({ env = {}, seed, ttsModus }, run) {
  const attrappe = await starteAttrappe({ ttsModus });
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

const anrufStarten = (srv, wartezeitMs = 0) =>
  abrufMitFrist(
    `${srv.localUrl}/api/calls`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: TELNYX_TEST_PEER_NUMBER, objective: OBJECTIVE }),
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
const ZYKLUS_ANKER_TAG = "1";

function mitErschoepfterTtsQuote() {
  const jetzt = new Date();
  const zyklus = `${jetzt.getUTCFullYear()}-${String(jetzt.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    ...mitEigentuemer(),
    platformTtsUsage: { cycleKey: zyklus, characters: TTS_QUOTE, warnedCycle: null },
  };
}

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
    };
  });
  return ergebnis;
}

test("3365-K1: Schalter aus (auch mit gesetzter Call-Control-App) -> genau ein TeXML-Wahlversuch, kein TTS, kein POST /v2/calls, TeXML byte-gleich", async () => {
  const heute = await telnyxWahlUndTeXml({});
  const mitAppId = await telnyxWahlUndTeXml({ TELNYX_CALL_CONTROL_APP_ID: CALL_CONTROL_APP_ID });
  for (const lauf of [heute, mitAppId]) {
    assert.equal(lauf.wahlen, EINMAL);
    assert.equal(lauf.ttsAufrufe, 0);
    assert.equal(lauf.callControlAufrufe, 0);
  }
  assert.deepEqual(mitAppId.formular, heute.formular);
  assert.equal(mitAppId.texml, heute.texml);
});

test("3365-K1: Schalter aus -> keine el-vorspann-Logzeile", async () => {
  await mitServer({ env: { TELNYX_CALL_CONTROL_APP_ID: CALL_CONTROL_APP_ID } }, async ({ srv }) => {
    assert.equal((await anrufStarten(srv)).status, HTTP_OK);
    assert.doesNotMatch(srv.stdout, /\[el-vorspann\]/);
  });
});

test("3365-K2: Schalter an ohne Call-Control-App -> TeXML wie heute plus Rueckfall-Logzeile keine_call_control_app", async () => {
  await mitServer({ env: { ELEVENLABS_OUTBOUND_VORSPANN: "true" } }, async ({ srv, attrappe }) => {
    const antwort = await anrufStarten(srv);
    const { callId } = await antwort.json();
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(nach(attrappe, TEXML_ANRUF_PFAD).length, EINMAL);
    assert.equal(nach(attrappe, TTS_PFAD).length, 0);
    assert.equal(nach(attrappe, CALL_CONTROL_PFAD).length, 0);
    assert.ok(srv.stdout.includes(rueckfallZeile("keine_call_control_app", callId)), srv.stdout);
    assert.equal(anrufIn(srv, callId).costProfile, UEBER_TELNYX);
  });
});

test("3365-K3: Vorspann-Text und Stimme stammen aus der Init-Eroeffnung -> TTS 1x, danach TeXML, Logzeile bereit", async () => {
  await mitServer({ env: VORSPANN_AN, seed: mitEigentuemer() }, async ({ srv, attrappe }) => {
    const antwort = await anrufStarten(srv);
    const { callId } = await antwort.json();
    assert.equal(antwort.status, HTTP_OK);
    const call = anrufIn(srv, callId);
    const tts = nach(attrappe, TTS_PFAD);
    assert.equal(tts.length, EINMAL);
    assert.equal(call.language, "en");
    assert.equal(new URL(tts[0].path, attrappe.url).pathname, `${TTS_PFAD}${EN_STIMME}/stream`);
    assert.equal(JSON.parse(tts[0].roh).text, dritteroeffnung(OWNER_NAME_IM_STORE, call.openingLine));
    assert.equal(nach(attrappe, TEXML_ANRUF_PFAD).length, EINMAL);
    assert.equal(nach(attrappe, CALL_CONTROL_PFAD).length, 0);
    assert.ok(srv.stdout.includes(`[el-vorspann] bereit call=${callId}`), srv.stdout);
    assert.equal(call.costProfile, UEBER_TELNYX);
  });
});

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
    assert.ok(srv.stdout.includes(rueckfallZeile("eroeffnung", callId)), srv.stdout);
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
    assert.equal(text, ownerEroeffnung(OWNER_TEST_FIRST_NAME, call.openingLine));
  });
});

const EROEFFNUNGS_TABELLE = [
  ["beginnt mit dem Pflichtsatz", { text: "Hier spricht eine KI. Es geht um X.", pflichtsatz: "Hier spricht eine KI." }, null],
  ["beginnt nicht mit dem Pflichtsatz", { text: "Guten Tag. Hier spricht eine KI.", pflichtsatz: "Hier spricht eine KI." }, "eroeffnung"],
  ["leerer Text", { text: "", pflichtsatz: "Hier spricht eine KI." }, "eroeffnung"],
  ["leerer Pflichtsatz", { text: "Es geht um X.", pflichtsatz: "" }, "eroeffnung"],
];

for (const [name, eingabe, erwartet] of EROEFFNUNGS_TABELLE)
  test(`3365-K3: Pruefung der Eroeffnung - ${name} -> ${erwartet ?? "kein Rueckfall"}`, () => {
    assert.equal(eroeffnungRueckfall(eingabe), erwartet);
  });

test("3365-K4: Plattform-TTS-Quote erschoepft -> Rueckfall grund=tts_quote ohne TTS-Aufruf", async () => {
  await mitServer({ env: { ...VORSPANN_AN, TTS_QUOTA_CYCLE_ANCHOR_DAY: ZYKLUS_ANKER_TAG }, seed: mitErschoepfterTtsQuote() }, async ({ srv, attrappe }) => {
    const antwort = await anrufStarten(srv);
    const { callId } = await antwort.json();
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(nach(attrappe, TTS_PFAD).length, 0);
    assert.equal(nach(attrappe, TEXML_ANRUF_PFAD).length, EINMAL);
    assert.ok(srv.stdout.includes(rueckfallZeile("tts_quote", callId)), srv.stdout);
  });
});

test("3365-K4: Vorspann-Zeichen werden auf die Plattform-TTS-Quote gebucht", async () => {
  await mitServer({ env: VORSPANN_AN, seed: mitEigentuemer() }, async ({ srv, attrappe }) => {
    await anrufStarten(srv);
    const text = JSON.parse(nach(attrappe, TTS_PFAD)[0].roh).text;
    assert.equal(srv.readStore().platformTtsUsage.characters, text.length);
  });
});

const TTS_RUECKFAELLE = [
  ["tts_fehler", TTS_MODUS.FEHLER, 0],
  ["tts_unvollstaendig", TTS_MODUS.UNVOLLSTAENDIG, 0],
  ["tts_unplausibel", TTS_MODUS.ZU_KURZ, 0],
];

for (const [grund, ttsModus, wartezeitMs] of TTS_RUECKFAELLE) {
  test(`3365-K5: TTS ${grund} -> heutiger TeXML-Weg, Logzeile grund=${grund}, keine Geheimnisse im Log`, async () => {
    await mitServer({ env: VORSPANN_AN, seed: mitEigentuemer(), ttsModus }, async ({ srv, attrappe }) => {
      const antwort = await anrufStarten(srv, wartezeitMs);
      const { callId } = await antwort.json();
      assert.equal(antwort.status, HTTP_OK);
      assert.equal(nach(attrappe, TTS_PFAD).length, EINMAL);
      assert.equal(nach(attrappe, TEXML_ANRUF_PFAD).length, EINMAL);
      assert.equal(nach(attrappe, CALL_CONTROL_PFAD).length, 0);
      assert.ok(srv.stdout.includes(rueckfallZeile(grund, callId)), srv.stdout);
      assert.doesNotMatch(srv.stdout, /\[el-vorspann\] bereit/);
      keineGeheimnisseIm(srv.stdout, anrufIn(srv, callId));
    });
  });
}

test("3365-K5: TTS nicht innerhalb der Frist fertig -> grund=tts_frist, gewaehlt wird erst danach", async () => {
  const env = { ...VORSPANN_AN, ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS: "30000" };
  await mitServer({ env, seed: mitEigentuemer(), ttsModus: TTS_MODUS.HAENGT }, async ({ srv, attrappe }) => {
    const beginn = Date.now();
    const antwort = await anrufStarten(srv, VORSPANN_TTS_FRIST_MS);
    const { callId } = await antwort.json();
    assert.ok(Date.now() - beginn >= VORSPANN_TTS_FRIST_MS, "gewaehlt wird nicht vor Ablauf der Frist");
    assert.equal(nach(attrappe, TEXML_ANRUF_PFAD).length, EINMAL);
    assert.ok(srv.stdout.includes(rueckfallZeile("tts_frist", callId)), srv.stdout);
  });
});

test("3365-K23: bereite Vorspann-Anrufe loggen keine Schluessel, Passwoerter oder Token", async () => {
  await mitServer({ env: VORSPANN_AN, seed: mitEigentuemer() }, async ({ srv }) => {
    const { callId } = await (await anrufStarten(srv)).json();
    assert.match(srv.stdout, /\[el-vorspann\] bereit/);
    keineGeheimnisseIm(srv.stdout, anrufIn(srv, callId));
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
