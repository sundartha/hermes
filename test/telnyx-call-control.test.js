// Telnyx-Call-Control-Adapter (P4): originateViaCallControl / endCallViaCallControl /
// startAssistant ueber /v2/calls + Action-Endpunkte. Rein offline (global.fetch gestubbt,
// F.I.R.S.T.). Config VOR dem Import gesetzt -> echte .env beeinflusst den Test nicht
// (Key-Leak-Schutz). Kein pglite/Server-Spawn (eigene Datei).
import { test } from "node:test";
import assert from "node:assert/strict";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";
const CONNECTION_ID = "conn_abc123";
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

// Fehlende Config simulieren (Adapter liest config bei jedem Aufruf): Wert leeren,
// Aufruf, Wert restaurieren. fetch wird dabei gestubbt, damit ein durchrutschender
// Call NICHT die echte API trifft (er soll ohnehin vorher fail-closed werfen).
async function withBlankedConfig(key, fn) {
  const saved = config[key];
  config[key] = "";
  try {
    await fn();
  } finally {
    config[key] = saved;
  }
}

const CC_ORIGINATE = {
  from: "+13125550100",
  to: "+4917312345678",
  webhookUrl: "https://agent.test/voice/telnyx/cc?callId=call_1",
  method: "POST",
  timeLimit: 180,
};

// 1) Origination: URL /v2/calls, POST, JSON-Header, Bearer, Body-Felder, Rueckgabe callControlId
test("originateViaCallControl: /v2/calls, JSON-Body-Felder, Bearer, returns callControlId", async () => {
  const calls = stubFetch({ json: { data: { call_control_id: "cc_1" } } });
  const res = await telnyxVoice.originateViaCallControl(CC_ORIGINATE);
  assert.equal(res.callControlId, "cc_1");
  const c = calls[0];
  assert.equal(c.url, `${API_BASE}/v2/calls`);
  assert.equal(c.opts.method, "POST");
  assert.equal(c.opts.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(c.opts.headers["Content-Type"], "application/json");
  const body = JSON.parse(c.body);
  assert.equal(body.connection_id, CONNECTION_ID);
  assert.equal(body.to, CC_ORIGINATE.to);
  assert.equal(body.from, CC_ORIGINATE.from);
  assert.equal(body.webhook_url, CC_ORIGINATE.webhookUrl);
  assert.equal(body.webhook_url_method, "POST");
  assert.equal(body.time_limit_secs, 180);
});

// 2) Robustheit: unwrapped {call_control_id} wird auch erkannt (Parity zu originateCall)
test("originateViaCallControl: unwrapped {call_control_id} erkannt", async () => {
  stubFetch({ json: { call_control_id: "cc_2" } });
  assert.equal((await telnyxVoice.originateViaCallControl(CC_ORIGINATE)).callControlId, "cc_2");
});

// 3) Fehlerpfad 403 mit errors[]: code+title+providerStatus, KEIN Key/detail/Roh-Body (Regel 4)
test("originateViaCallControl: 403 errors[] -> code+title+status, kein Key/detail-Leak", async () => {
  stubFetch({
    ok: false,
    status: 403,
    json: {
      errors: [
        {
          code: "10015",
          title: "Caller ID not allowed",
          detail: "from=+18643028341 secret-fragment",
        },
      ],
    },
  });
  await assert.rejects(
    () => telnyxVoice.originateViaCallControl(CC_ORIGINATE),
    (err) => {
      assert.match(err.message, /HTTP 403/);
      assert.match(err.message, /10015/);
      assert.match(err.message, /Caller ID not allowed/);
      assert.equal(err.providerStatus, 403);
      assert.ok(!err.message.includes(API_KEY));
      assert.ok(!err.message.includes("secret-fragment"));
      return true;
    },
  );
});

// 4) fail-closed: fehlender API_KEY / CONNECTION_ID
test("originateViaCallControl: fail-closed ohne API_KEY / CONNECTION_ID", async () => {
  stubFetch({ json: { data: { call_control_id: "x" } } });
  await withBlankedConfig("telnyxApiKey", () =>
    assert.rejects(() => telnyxVoice.originateViaCallControl(CC_ORIGINATE), /TELNYX_API_KEY fehlt/),
  );
  await withBlankedConfig("telnyxConnectionId", () =>
    assert.rejects(
      () => telnyxVoice.originateViaCallControl(CC_ORIGINATE),
      /TELNYX_CONNECTION_ID fehlt/,
    ),
  );
});

// 5) Hangup: korrekter Call-Control-Endpunkt (NICHT TeXML), POST, JSON-Header
test("endCallViaCallControl: /v2/calls/<id>/actions/hangup, POST", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.endCallViaCallControl("cc_1");
  assert.equal(calls[0].url, `${API_BASE}/v2/calls/cc_1/actions/hangup`);
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
});

// 6) Hangup Fehlerpfad ohne Key-Leak
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

// 7) Hangup fail-closed: fehlender API_KEY / leere callControlId (falscher Endpunkt-Schutz)
test("endCallViaCallControl: fail-closed ohne API_KEY / callControlId", async () => {
  stubFetch({ json: {} });
  await withBlankedConfig("telnyxApiKey", () =>
    assert.rejects(() => telnyxVoice.endCallViaCallControl("cc_1"), /TELNYX_API_KEY fehlt/),
  );
  await assert.rejects(() => telnyxVoice.endCallViaCallControl(""), /callControlId fehlt/);
});

// 8) startAssistant: ai_assistant_start-Action auf callControlId mit assistant id im Body
test("startAssistant: /v2/calls/<id>/actions/ai_assistant_start mit assistant id", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "assistant-77" });
  assert.equal(calls[0].url, `${API_BASE}/v2/calls/cc_1/actions/ai_assistant_start`);
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(JSON.parse(calls[0].body).assistant.id, "assistant-77");
});

// 8b) startAssistant: der Body traegt NUR die assistant.id, kein Auth-Feld (Auth des
// Shims laeuft ueber das statische Telnyx-Integration-Secret, E2 - nicht mehr per-Call).
test("startAssistant: Body = { assistant: { id } }, KEIN llm_api_key-Feld", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "assistant-77" });
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body, { assistant: { id: "assistant-77" } });
  assert.ok(!("llm_api_key" in body.assistant), "kein llm_api_key-Feld im Body");
});

// 9) startAssistant Fehlerpfad ohne Key-Leak
test("startAssistant: HTTP-Fehler ohne Key-Leak", async () => {
  stubFetch({ ok: false, status: 422 });
  await assert.rejects(
    () => telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a" }),
    (err) => {
      assert.match(err.message, /HTTP 422/);
      assert.ok(!err.message.includes(API_KEY));
      return true;
    },
  );
});

// 10) startAssistant fail-closed: API_KEY / callControlId / assistantId
test("startAssistant: fail-closed ohne API_KEY / callControlId / assistantId", async () => {
  stubFetch({ json: {} });
  await withBlankedConfig("telnyxApiKey", () =>
    assert.rejects(
      () => telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a" }),
      /TELNYX_API_KEY fehlt/,
    ),
  );
  await assert.rejects(
    () => telnyxVoice.startAssistant({ callControlId: "", assistantId: "a" }),
    /callControlId fehlt/,
  );
  await assert.rejects(
    () => telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "" }),
    /assistantId fehlt/,
  );
});

// 11) fakeVoice-Seam: fakeOriginate -> neue Methoden netzfrei (kein Crash im P5-Testpfad)
test("fakeVoice: Call-Control-Methoden sind netzfrei", async () => {
  const saved = config.fakeOriginate;
  config.fakeOriginate = true;
  try {
    const v = voiceControl();
    const r = await v.originateViaCallControl(CC_ORIGINATE);
    assert.match(r.callControlId, /^fake_cc_/);
    await v.endCallViaCallControl("cc_1"); // resolve, kein throw, kein Netz
    await v.startAssistant({ callControlId: "cc_1", assistantId: "a" });
    await v.speak({ callControlId: "cc_1", text: "Hallo", voiceProfile: "de-female-neural" });
  } finally {
    config.fakeOriginate = saved;
  }
});

// 12) speak (P4.5): /v2/calls/<id>/actions/speak, POST, JSON-Header, Bearer, Body {payload,voice,language}
test("speak: /v2/calls/<id>/actions/speak, Body aus voiceAttrs(voiceProfile)", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.speak({
    callControlId: "cc_1",
    text: "Hallo, hier ist der KI-Assistent.",
    voiceProfile: "de-female-neural",
  });
  assert.equal(calls[0].url, `${API_BASE}/v2/calls/cc_1/actions/speak`);
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
  const body = JSON.parse(calls[0].body);
  assert.equal(body.payload, "Hallo, hier ist der KI-Assistent.");
  assert.equal(body.voice, "Azure.de-DE-KatjaNeural");
  assert.equal(body.language, "de-DE");
});

// 13) speak Fehlerpfad ohne Key-Leak
test("speak: HTTP-Fehler ohne Key-Leak", async () => {
  stubFetch({ ok: false, status: 500 });
  await assert.rejects(
    () =>
      telnyxVoice.speak({ callControlId: "cc_1", text: "Hallo", voiceProfile: "de-female-neural" }),
    (err) => {
      assert.match(err.message, /HTTP 500/);
      assert.ok(!err.message.includes(API_KEY));
      return true;
    },
  );
});

// 14) speak fail-closed: API_KEY / callControlId / text
test("speak: fail-closed ohne API_KEY / callControlId / text", async () => {
  stubFetch({ json: {} });
  await withBlankedConfig("telnyxApiKey", () =>
    assert.rejects(
      () =>
        telnyxVoice.speak({ callControlId: "cc_1", text: "Hallo", voiceProfile: "de-female-neural" }),
      /TELNYX_API_KEY fehlt/,
    ),
  );
  await assert.rejects(
    () => telnyxVoice.speak({ callControlId: "", text: "Hallo", voiceProfile: "de-female-neural" }),
    /callControlId fehlt/,
  );
  await assert.rejects(
    () => telnyxVoice.speak({ callControlId: "cc_1", text: "", voiceProfile: "de-female-neural" }),
    /text fehlt/,
  );
});
