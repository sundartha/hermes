import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog, TELNYX_TEST_SIGNATURE_HEADERS, BASE_ENV } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const TOKEN_HEX = "[0-9a-f]{16}";
const GESPROCHEN = [{ role: "caller", text: "Guten Tag, ich bin da", at: "2026-01-01T00:00:00.000Z" }];

let laufnummer = 0;
const eindeutig = () => `m${(laufnummer += 1)}`;

const post = (srv, pfad, felder) =>
  abrufMitFrist(`${srv.localUrl}${pfad}`, {
    method: "POST",
    headers: TELNYX_TEST_SIGNATURE_HEADERS,
    body: new URLSearchParams({ Marke: eindeutig(), ...felder }),
  });

const stilleRunde = async (srv, callId) => {
  const res = await post(srv, `/voice/turn?callId=${callId}&turnToken=${eindeutig()}`, { SpeechResult: "" });
  assert.equal(res.status, HTTP_OK);
  assert.match(res.headers.get("content-type"), /^text\/xml/);
  return res.text();
};

const zeilenMit = (srv, marke) => srv.stdout.split("\n").filter((zeile) => zeile.includes(marke));

async function mitAnrufen(calls, pruefe) {
  const srv = await startServer({ seed: seedState({ calls }) });
  try {
    await pruefe(srv);
  } finally {
    await srv.stop();
  }
}

test("3395-R3-1: Rueckfrage-Runde eines englischen Telnyx-Anrufs traegt Sprache, Stimme, absolute Aktions-URL und eine Marke", async () => {
  const call = seedCall({ id: "c_en", provider: "telnyx", language: "en", transcript: GESPROCHEN });
  await mitAnrufen([call], async (srv) => {
    const xml = await stilleRunde(srv, "c_en");
    const marke = xml.match(new RegExp(`turnToken=(${TOKEN_HEX})`))[1];
    const aktion = `${BASE_ENV.PUBLIC_URL}/voice/turn?callId=c_en&amp;turnToken=${marke}`;
    assert.equal(
      xml,
      `<?xml version="1.0" encoding="UTF-8"?><Response>` +
        `<Gather input="speech" language="en-GB" transcriptionEngine="Deepgram" model="deepgram/nova-3" ` +
        `speechTimeout="2" action="${aktion}" method="POST">` +
        `<Say voice="Azure.en-GB-SoniaNeural" language="en-GB">Could you repeat that?</Say></Gather>` +
        `<Redirect method="POST">${aktion}</Redirect></Response>`,
    );
    const zweite = await stilleRunde(srv, "c_en");
    assert.match(zweite, /I still can&apos;t hear you\. Are you still there\?/);
    assert.notEqual(zweite.match(new RegExp(`turnToken=(${TOKEN_HEX})`))[1], marke, "jede Runde hat eine neue Marke");
  });
});

test("3395-R3-2: Anruf ohne Anbieter bekommt eine relative Aktions-URL, nicht die oeffentliche", async () => {
  const call = seedCall({ id: "c_ohne", provider: undefined, transcript: GESPROCHEN });
  await mitAnrufen([call], async (srv) => {
    const xml = await stilleRunde(srv, "c_ohne");
    assert.match(xml, new RegExp(`action="/voice/turn\\?callId=c_ohne&amp;turnToken=${TOKEN_HEX}"`));
    assert.ok(!xml.includes(BASE_ENV.PUBLIC_URL));
  });
});

test("3395-R3-3: dritte stille Runde verabschiedet in der Stimme des Anrufs und legt auf, danach ohne Gather", async () => {
  const call = seedCall({ id: "c_ende", provider: "telnyx", language: "en", transcript: GESPROCHEN });
  await mitAnrufen([call], async (srv) => {
    await stilleRunde(srv, "c_ende");
    await stilleRunde(srv, "c_ende");
    const xml = await stilleRunde(srv, "c_ende");
    assert.equal(
      xml,
      `<?xml version="1.0" encoding="UTF-8"?><Response>` +
        `<Say voice="Azure.en-GB-SoniaNeural" language="en-GB">I&apos;m afraid I can&apos;t hear you. I&apos;ll try again later. Goodbye.</Say>` +
        `<Hangup/></Response>`,
    );
  });
});

const wiederholungen = (srv, weg) => zeilenMit(srv, `wiederholte_zustellung weg=${weg} art=antwort_wiederholt`).length;

test("3395-R3-4: Rueckfall-Zustellung wird je Anruf und Quelle erkannt, eine andere Quelle oder ein anderer Anruf ist neu", async () => {
  await mitAnrufen([], async (srv) => {
    const rueckfall = (callId, quelle) => post(srv, `/voice/el-rueckfall?callId=${callId}&quelle=${quelle}`, {});
    await rueckfall("c_a", "dial_ende");
    await rueckfall("c_a", "dial_ende");
    await waitForLog(srv, /wiederholte_zustellung weg=el-rueckfall art=antwort_wiederholt/);
    assert.equal(wiederholungen(srv, "el-rueckfall"), 1);
    await rueckfall("c_a", "andere_quelle");
    await rueckfall("c_b", "dial_ende");
    await rueckfall("c_b", "dial_ende");
    await waitForLog(srv, /voice-antwort\] weg=\/voice\/el-rueckfall/);
    assert.equal(wiederholungen(srv, "el-rueckfall"), 2);
  });
});

test("3395-R3-5: SIP-Bein-Zustellung wird je Anruf und Status erkannt, ein anderer Status ist neu", async () => {
  await mitAnrufen([], async (srv) => {
    const bein = (status) => post(srv, "/voice/el-bein?callId=c_bein", { CallStatus: status });
    await bein("ringing");
    await bein("ringing");
    await bein("answered");
    await bein("answered");
    await bein("completed");
    await waitForLog(srv, /wiederholte_zustellung weg=el-bein art=antwort_wiederholt/);
    assert.equal(wiederholungen(srv, "el-bein"), 2);
  });
});

test("3395-R3-6: Zustellung ohne Anruf-Kennung und ohne Signaturkopf hat keinen Anker und wird nie als Wiederholung behandelt", async () => {
  await mitAnrufen([], async (srv) => {
    const ohneKopf = () =>
      abrufMitFrist(`${srv.localUrl}/voice/el-bein`, { method: "POST", body: new URLSearchParams({ CallStatus: "ringing" }) });
    assert.equal((await ohneKopf()).status, HTTP_OK);
    assert.equal((await ohneKopf()).status, HTTP_OK);
    await waitForLog(srv, /voice-antwort\] weg=\/voice\/el-bein/);
    assert.equal(zeilenMit(srv, "wiederholte_zustellung").length, 0);
  });
});
