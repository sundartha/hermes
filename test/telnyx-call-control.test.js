// Telnyx-Call-Control-Adapter: originateCall (TeXML) / endCallViaCallControl (Hangup-
// Altbestand) ueber /v2/calls + Action-Endpunkte. Rein offline (global.fetch gestubbt,
// F.I.R.S.T.). Config VOR dem Import gesetzt -> echte .env beeinflusst den Test nicht
// (Key-Leak-Schutz). Kein pglite/Server-Spawn (eigene Datei).
//
// IE6-S1: originateViaCallControl/startAssistant/speak sind mit dem Assistant-Pfad
// entfernt. endCallViaCallControl bleibt (Altbestand: Legs mit persistierter
// callControlId, s. hangUpAction) - dieselben Tests laufen unveraendert weiter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole, makeConfigOverrides } from "./helpers.js";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";
const CONNECTION_ID = "conn_texml_abc123";
process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;
process.env.TELNYX_CONNECTION_ID = CONNECTION_ID;

// Dynamischer Import NACH dem Env-Setzen (config liest process.env beim Eval).
const { telnyxVoice } = await import("../src/telephony/adapters/telnyx/voice.js");
const { voiceControl } = await import("../src/telephony/registry.js");
const { config } = await import("../src/config.js");

// fetch-Stub: zeichnet den letzten Aufruf auf und liefert eine konfigurierbare Antwort.
function stubFetch(response) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts, body: opts?.body?.toString() });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json ?? {},
      // assertTelnyxOk liest im Fehlerfall res.text() (robuster Pfad, gemeinsamer Helper).
      // Faithful Response-Double: echtes fetch hat immer text(); ohne explizites text faellt
      // der Stub auf den JSON-Body zurueck -> Bestandstests unveraendert.
      text: async () => response.text ?? JSON.stringify(response.json ?? {}),
    };
  };
  return calls;
}

// Config fuer die Dauer eines Tests auf einen Wert setzen (Adapter liest config bei jedem
// Aufruf), danach restaurieren; withBlankedConfig simuliert fehlende Config mit dem Leerwert.
const { withBlankedConfig } = makeConfigOverrides(config);

test("originateCall (TeXML): nutzt weiterhin die TeXML-connection_id in der URL", async () => {
  const calls = stubFetch({ json: { data: { sid: "CA1" } } });
  await telnyxVoice.originateCall({
    from: "+13125550100",
    to: "+4917312345678",
    url: "https://agent.test/voice/outbound?callId=call_1",
  });
  assert.equal(calls[0].url, `${API_BASE}/v2/texml/calls/${CONNECTION_ID}`);
});

// Hangup: korrekter Call-Control-Endpunkt (NICHT TeXML), POST, JSON-Header
test("endCallViaCallControl: /v2/calls/<id>/actions/hangup, POST", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.endCallViaCallControl("cc_1");
  assert.equal(calls[0].url, `${API_BASE}/v2/calls/cc_1/actions/hangup`);
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
});

// Hangup Fehlerpfad ohne Key-Leak
test("endCallViaCallControl: HTTP-Fehler ohne Key-Leak", async () => {
  stubFetch({ ok: false, status: 404 });
  await assert.rejects(
    () => telnyxVoice.endCallViaCallControl("nope"),
    (err) => {
      assert.match(err.message, /HTTP 404/);
      assert.ok(!err.message.includes(API_KEY));
      return true;
    },
  );
});

// Hangup fail-closed: fehlender API_KEY / leere callControlId (falscher Endpunkt-Schutz)
test("endCallViaCallControl: fail-closed ohne API_KEY / callControlId", async () => {
  stubFetch({ json: {} });
  await withBlankedConfig("telnyxApiKey", () =>
    assert.rejects(() => telnyxVoice.endCallViaCallControl("cc_1"), /TELNYX_API_KEY fehlt/),
  );
  await assert.rejects(() => telnyxVoice.endCallViaCallControl(""), /callControlId fehlt/);
});

// fakeVoice-Seam: fakeOriginate -> Hangup-Methode netzfrei (kein Crash im Gate-Testpfad)
test("fakeVoice: Call-Control-Methoden sind netzfrei", async () => {
  const saved = config.safety.fakeOriginate;
  config.safety.fakeOriginate = true;
  try {
    const v = voiceControl();
    await v.endCallViaCallControl("cc_1"); // resolve, kein throw, kein Netz
  } finally {
    config.safety.fakeOriginate = saved;
  }
});

// OBS-2: endCallViaCallControl loggt unter seinem Op-Namen (Op+Status+ccid-Praesenz, NIE
// den callControlId-Wert und NIE den API-Key, Regel 4).
test("OBS-2: endCallViaCallControl loggt unter seinem Op-Namen", async () => {
  stubFetch({ status: 200, json: {} });
  const endLines = await captureConsole(() => telnyxVoice.endCallViaCallControl("cc_1"));
  assert.ok(endLines.some((l) => l === "[telnyx/voice] endCallViaCallControl ok status=200 ccid=true"));
});

// OBS-2: kein [telnyx/voice]-Log auf dem Fehlerpfad (assertTelnyxOk wirft VOR dem Log).
test("OBS-2: kein [telnyx/voice]-Log auf dem Fehlerpfad (assertTelnyxOk wirft vorher)", async () => {
  stubFetch({ ok: false, status: 403, json: { errors: [{ code: "10015", title: "nope" }] } });
  const lines = await captureConsole(() =>
    assert.rejects(() => telnyxVoice.endCallViaCallControl("cc_1")),
  );
  assert.ok(!lines.some((l) => l.includes("[telnyx/voice]")), "kein Erfolgs-Log bei HTTP-Fehler");
});
