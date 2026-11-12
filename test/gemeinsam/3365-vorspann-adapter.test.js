import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole } from "../helpers.js";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-3365-adapter";
const CALLEE_BEIN = "cc_callee_1";
const HTTP_OK = 200;
const HTTP_UNPROCESSABLE = 422;
const FAKE_KENNUNG_HEX = "[0-9a-f]{16}";
const FAKE_BEIN_KENNUNG = "[0-9a-f-]{36}";
process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;

const { voiceControl } = await import("../../src/telephony/registry.js");
const { config } = await import("../../src/config.js");

const telnyxVoice = voiceControl("telnyx");

function stubFetch({ status = HTTP_OK, json = {} } = {}) {
  const aufrufe = [];
  global.fetch = async (url, optionen) => {
    aufrufe.push({ url, optionen, koerper: JSON.parse(optionen.body) });
    return { ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json) };
  };
  return aufrufe;
}

const WAHL_ANFRAGE = Object.freeze({
  connectionId: "app_1",
  to: "+4915112345678",
  from: "+4915255555555",
  webhookUrl: "https://agent.test/voice/vorspann?callId=call_1",
  timeLimitS: 300,
  commandId: "vorspann-call_1",
});

test("3365-K7: dialCallControl waehlt per POST /v2/calls mit genau den Wahlfeldern und liefert die Bein-Kennung", async () => {
  const aufrufe = stubFetch({ json: { data: { call_control_id: CALLEE_BEIN } } });
  const zeilen = await captureConsole(async () => {
    assert.deepEqual(await telnyxVoice.dialCallControl(WAHL_ANFRAGE), { callControlId: CALLEE_BEIN });
  });
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].url, `${API_BASE}/v2/calls`);
  assert.equal(aufrufe[0].optionen.method, "POST");
  assert.deepEqual(aufrufe[0].optionen.headers, { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" });
  assert.deepEqual(aufrufe[0].koerper, {
    connection_id: "app_1",
    to: "+4915112345678",
    from: "+4915255555555",
    webhook_url: "https://agent.test/voice/vorspann?callId=call_1",
    time_limit_secs: 300,
    command_id: "vorspann-call_1",
  });
  assert.deepEqual(zeilen, ["[telnyx/voice] dialCallControl ok status=200 ccid=true"]);
  assert.ok(aufrufe[0].optionen.signal instanceof AbortSignal);
});

test("3365-K7: dialCallControl ohne Kennung in der Antwort meldet ccid=false, ein HTTP-Fehler nennt Vorgang und Status ohne Schluessel", async () => {
  stubFetch({ json: { data: {} } });
  const zeilen = await captureConsole(async () => {
    assert.deepEqual(await telnyxVoice.dialCallControl(WAHL_ANFRAGE), { callControlId: undefined });
  });
  assert.deepEqual(zeilen, ["[telnyx/voice] dialCallControl ok status=200 ccid=false"]);
  stubFetch({ status: HTTP_UNPROCESSABLE, json: { errors: [{ code: "10015", title: "Invalid", detail: "geheimes-detail" }] } });
  await assert.rejects(telnyxVoice.dialCallControl(WAHL_ANFRAGE), (fehler) => {
    assert.match(fehler.message, /^Telnyx dialCallControl fehlgeschlagen: HTTP 422 \(10015 Invalid\)$/);
    assert.equal(fehler.providerStatus, HTTP_UNPROCESSABLE);
    assert.ok(!fehler.message.includes(API_KEY));
    return true;
  });
});

test("3365-K8: playbackStart startet die Wiedergabe der Audio-Adresse auf dem Bein und loggt unter seinem Vorgang", async () => {
  const aufrufe = stubFetch({ json: { data: { result: "ok" } } });
  const zeilen = await captureConsole(() => telnyxVoice.playbackStart(CALLEE_BEIN, { audioUrl: "https://agent.test/voice/tts/abc" }));
  assert.equal(aufrufe[0].url, `${API_BASE}/v2/calls/${CALLEE_BEIN}/actions/playback_start`);
  assert.equal(aufrufe[0].optionen.method, "POST");
  assert.deepEqual(aufrufe[0].koerper, { audio_url: "https://agent.test/voice/tts/abc" });
  assert.deepEqual(zeilen, ["[telnyx/voice] playbackStart ok status=200 ccid=true"]);
});

test("3365-K8: playbackStart scheitert mit Vorgangsnamen und Status", async () => {
  stubFetch({ status: HTTP_UNPROCESSABLE, json: {} });
  await assert.rejects(telnyxVoice.playbackStart(CALLEE_BEIN, { audioUrl: "https://agent.test/voice/tts/abc" }), /^Error: Telnyx playbackStart fehlgeschlagen: HTTP 422$/);
});

test("3365-K7: die netzfreie Attrappe liefert Kennungen fuer Anruf und Bein, jede Wahl eine neue", async () => {
  const gespeichert = config.safety.fakeOriginate;
  config.safety.fakeOriginate = true;
  try {
    const attrappe = voiceControl();
    assert.match((await attrappe.originateCall()).sid, new RegExp(`^fake_${FAKE_KENNUNG_HEX}$`));
    const erste = await attrappe.dialCallControl(WAHL_ANFRAGE);
    const zweite = await attrappe.dialCallControl(WAHL_ANFRAGE);
    assert.match(erste.callControlId, new RegExp(`^fake_cc_${FAKE_BEIN_KENNUNG}$`));
    assert.notEqual(erste.callControlId, zweite.callControlId);
    assert.equal(await attrappe.playbackStart(CALLEE_BEIN, { audioUrl: "https://agent.test/voice/tts/abc" }), undefined);
  } finally {
    config.safety.fakeOriginate = gespeichert;
  }
});

test("3365-K7: eine Zeitueberschreitung beim Waehlen wird zum Fehler ohne Schluessel in Text und Log", async () => {
  global.fetch = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  let fehlertext = "";
  const zeilen = await captureConsole(async () => {
    await assert.rejects(telnyxVoice.dialCallControl(WAHL_ANFRAGE), (fehler) => {
      fehlertext = fehler.message;
      return true;
    });
  });
  assert.ok(fehlertext.length > 0);
  assert.ok(!fehlertext.includes(API_KEY));
  assert.ok(!zeilen.join("\n").includes(API_KEY));
});
