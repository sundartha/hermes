// Telnyx-Call-Control-Adapter (P4): originateViaCallControl / endCallViaCallControl /
// startAssistant ueber /v2/calls + Action-Endpunkte. Rein offline (global.fetch gestubbt,
// F.I.R.S.T.). Config VOR dem Import gesetzt -> echte .env beeinflusst den Test nicht
// (Key-Leak-Schutz). Kein pglite/Server-Spawn (eigene Datei).
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole, makeConfigOverrides } from "./helpers.js";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";
// BEWUSST verschiedene Werte: Telnyx fuehrt TeXML-Application und Call-Control-Application
// als getrennte Objekttypen. Nur so faellt auf, wenn der Call-Control-Pfad versehentlich die
// TeXML-ID sendet (Live-Bug 2026-07-10: HTTP 422 "10015 Invalid value for connection_id").
const CONNECTION_ID = "conn_texml_abc123";
const CALL_CONTROL_APP_ID = "ccapp_xyz789";
process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;
process.env.TELNYX_CONNECTION_ID = CONNECTION_ID;
process.env.TELNYX_CALL_CONTROL_APP_ID = CALL_CONTROL_APP_ID;
// afix-p1: volle ElevenLabs-Assistant-Stimmen-Config als Baseline (kein neues Env-Feld -
// bestehende config.telnyxElevenLabs-Keys). Einzelne Tests blenden sie ueber withConfig aus.
const EL_VOICE_ID = "voice_el_123";
const EL_API_KEY_REF = "elevenlabs_prod";
const EL_MODEL = "eleven_flash_v2_5";
process.env.TELNYX_ELEVENLABS_VOICE_ID = EL_VOICE_ID;
process.env.TELNYX_ELEVENLABS_API_KEY_REF = EL_API_KEY_REF;
process.env.TELNYX_ELEVENLABS_MODEL = EL_MODEL;

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
// fetch wird dabei gestubbt, damit ein durchrutschender Call NICHT die echte API trifft (er
// soll ohnehin vorher fail-closed werfen). Gemeinsame Implementierung in test/helpers.js (G5,
// Review-Blocker Runde 2) statt eigener Kopie - hier per Closure an das dynamisch importierte
// config-Objekt gebunden (s. Kommentar bei makeConfigOverrides).
const { withConfig, withBlankedConfig } = makeConfigOverrides(config);

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
  assert.equal(body.connection_id, CALL_CONTROL_APP_ID);
  assert.equal(body.to, CC_ORIGINATE.to);
  assert.equal(body.from, CC_ORIGINATE.from);
  assert.equal(body.webhook_url, CC_ORIGINATE.webhookUrl);
  assert.equal(body.webhook_url_method, "POST");
  assert.equal(body.time_limit_secs, 180);
});

// 1b) Regression (Live-Bug 2026-07-10): /v2/calls bekommt die Call-Control-App-ID, NIE die
// TeXML-ID. Der Vorgaenger-Code sendete telnyxConnectionId -> Telnyx lehnte JEDEN Outbound
// deterministisch ab (HTTP 422, 10015). Eigener Test, weil die Verwechslung nur auffaellt,
// wenn beide IDs verschieden sind (in 1) mitgeprueft, hier als benannte Invariante fixiert).
test("originateViaCallControl: sendet NIE die TeXML-connection_id (422/10015-Regression)", async () => {
  const calls = stubFetch({ json: { data: { call_control_id: "cc_1" } } });
  await telnyxVoice.originateViaCallControl(CC_ORIGINATE);
  const body = JSON.parse(calls[0].body);
  assert.notEqual(body.connection_id, CONNECTION_ID);
  assert.equal(body.connection_id, CALL_CONTROL_APP_ID);
});

// 1c) Der TeXML-Pfad bleibt an telnyxConnectionId gebunden (Gegenprobe: die neue Var darf
// den Bestands-Outbound NICHT umlenken - beide Pfade koexistieren, Regel 1).
test("originateCall (TeXML): nutzt weiterhin die TeXML-connection_id in der URL", async () => {
  const calls = stubFetch({ json: { data: { sid: "CA1" } } });
  await telnyxVoice.originateCall({
    from: CC_ORIGINATE.from,
    to: CC_ORIGINATE.to,
    url: "https://agent.test/voice/outbound?callId=call_1",
  });
  assert.equal(calls[0].url, `${API_BASE}/v2/texml/calls/${CONNECTION_ID}`);
  assert.ok(!calls[0].url.includes(CALL_CONTROL_APP_ID));
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

// 4) fail-closed: fehlender API_KEY / CALL_CONTROL_APP_ID
test("originateViaCallControl: fail-closed ohne API_KEY / CALL_CONTROL_APP_ID", async () => {
  stubFetch({ json: { data: { call_control_id: "x" } } });
  await withBlankedConfig("telnyxApiKey", () =>
    assert.rejects(() => telnyxVoice.originateViaCallControl(CC_ORIGINATE), /TELNYX_API_KEY fehlt/),
  );
  await withConfig(
    "telnyxAssistant",
    { ...config.telnyx.telnyxAssistant, callControlAppId: "" },
    () =>
      assert.rejects(
        () => telnyxVoice.originateViaCallControl(CC_ORIGINATE),
        /TELNYX_CALL_CONTROL_APP_ID fehlt/,
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

// afix-p2 (P2-T1): STT-Sprach-Hint pro Call - Kernfall. model MUSS mitgesendet werden
// (TranscriptionConfig.model-Default ist englisch-only, s. Plan-Beleg); assistant.id ueberlebt.
test("startAssistant: transcription={model,language} bei bekannter Sprache (de)", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a", language: "de" });
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body.transcription, { model: "deepgram/flux", language: "de" });
  assert.equal(body.assistant.id, "a");
});

// afix-p2 (P2-T2): Sprache ausserhalb der flux-Hint-Liste -> "auto" (Telnyx-Detection statt
// Hint-los), Modell bleibt deepgram/flux.
test("startAssistant: unbekannte Sprache -> transcription.language=auto", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a", language: "tr" });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.transcription.language, "auto");
  assert.equal(body.transcription.model, "deepgram/flux");
});

// afix-p2 (P2-T3): Invariante der Phase - "multi" bedeutet laut Telnyx-Doku woertlich
// "no language hint" (R2-Live-Defekt) und darf NIE durchgereicht werden, auch nicht ueber
// einen durchgereichten Store-Wert.
test("startAssistant: language=multi -> NIE durchgereicht, wird zu auto", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a", language: "multi" });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.transcription.language, "auto");
});

// afix-p2 (P2-T4): Regression Inbound-Pfad - ohne language bleibt der Body byte-identisch
// zum Bestand (telnyx-inbound.js reicht language nie durch, P6 bleibt unangetastet).
test("startAssistant: ohne language -> kein transcription-Feld (Inbound-Regression)", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "assistant-77" });
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(body, { assistant: { id: "assistant-77" } });
  assert.ok(!("transcription" in body));
});

// afix-p2 (P2-T5): Grenzfaelle - leerer/nulliger Store-Wert darf nie zu
// transcription:{model,language:""} werden (Telnyx wuerde das ablehnen).
test("startAssistant: language='' oder null -> kein transcription-Feld", async () => {
  const callsEmpty = stubFetch({ json: {} });
  await telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a", language: "" });
  assert.ok(!("transcription" in JSON.parse(callsEmpty[0].body)));

  const callsNull = stubFetch({ json: {} });
  await telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a", language: null });
  assert.ok(!("transcription" in JSON.parse(callsNull[0].body)));
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
  const saved = config.safety.fakeOriginate;
  config.safety.fakeOriginate = true;
  try {
    const v = voiceControl();
    const r = await v.originateViaCallControl(CC_ORIGINATE);
    assert.match(r.callControlId, /^fake_cc_/);
    await v.endCallViaCallControl("cc_1"); // resolve, kein throw, kein Netz
    await v.startAssistant({ callControlId: "cc_1", assistantId: "a" });
    await v.speak({ callControlId: "cc_1", text: "Hallo", voiceProfile: "de-female-neural" });
  } finally {
    config.safety.fakeOriginate = saved;
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
  // afix-p1 (T-neu 4, Regression Inbound): ohne useAssistantVoice bleibt der Body Azure-
  // Bestand, auch bei voller ElevenLabs-Config (EL_VOICE_ID/EL_API_KEY_REF oben gesetzt).
  assert.ok(!("voice_settings" in body), "kein voice_settings-Feld ohne useAssistantVoice");
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

// ---- afix-p1: speak mit useAssistantVoice (ElevenLabs-Zweig im Call-Control-speak) ----

// T-neu 1: useAssistantVoice=true + vollstaendige ElevenLabs-Config -> ElevenLabs-Voice/
// voice_settings (type+api_key_ref), KEIN language-Feld (Plan-Entscheidung B).
test("afix-p1 (T-neu 1): speak useAssistantVoice=true + volle Config -> ElevenLabs-Voice, voice_settings, KEIN language", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.speak({
    callControlId: "cc_1",
    text: "Hallo, hier ist der KI-Assistent.",
    voiceProfile: "de-female-neural",
    useAssistantVoice: true,
  });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.voice, `ElevenLabs.${EL_MODEL}.${EL_VOICE_ID}`);
  assert.deepEqual(body.voice_settings, { type: "elevenlabs", api_key_ref: EL_API_KEY_REF });
  assert.ok(!("language" in body), "kein language-Feld bei ElevenLabs-Voice");
});

// T-neu 2 (Fallback a): useAssistantVoice=true, aber die ElevenLabs-Config ist LEER ->
// Azure-Bestand byte-identisch, kein voice_settings-Feld.
test("afix-p1 (T-neu 2, Fallback a): useAssistantVoice=true + leere Config -> Azure-Bestand byte-identisch", async () => {
  await withConfig("telnyxElevenLabs", { voiceId: "", apiKeyRef: "", model: "Default" }, async () => {
    const calls = stubFetch({ json: {} });
    await telnyxVoice.speak({
      callControlId: "cc_1",
      text: "Hallo, hier ist der KI-Assistent.",
      voiceProfile: "de-female-neural",
      useAssistantVoice: true,
    });
    const body = JSON.parse(calls[0].body);
    assert.equal(body.voice, "Azure.de-DE-KatjaNeural");
    assert.equal(body.language, "de-DE");
    assert.ok(!("voice_settings" in body));
  });
});

// T-neu 3 (T5-Grenzfall): halbe ElevenLabs-Config (nur voiceId ODER nur apiKeyRef gesetzt)
// -> Azure-Bestand (hasElevenLabsVoice verlangt BEIDE Teile).
test("afix-p1 (T-neu 3, Grenzfall): halbe ElevenLabs-Config (nur voiceId bzw. nur apiKeyRef) -> Azure-Bestand", async () => {
  await withConfig("telnyxElevenLabs", { voiceId: EL_VOICE_ID, apiKeyRef: "", model: EL_MODEL }, async () => {
    const calls = stubFetch({ json: {} });
    await telnyxVoice.speak({
      callControlId: "cc_1",
      text: "Hallo",
      voiceProfile: "de-female-neural",
      useAssistantVoice: true,
    });
    const body = JSON.parse(calls[0].body);
    assert.equal(body.voice, "Azure.de-DE-KatjaNeural");
    assert.ok(!("voice_settings" in body));
  });
  await withConfig("telnyxElevenLabs", { voiceId: "", apiKeyRef: EL_API_KEY_REF, model: EL_MODEL }, async () => {
    const calls = stubFetch({ json: {} });
    await telnyxVoice.speak({
      callControlId: "cc_1",
      text: "Hallo",
      voiceProfile: "de-female-neural",
      useAssistantVoice: true,
    });
    const body = JSON.parse(calls[0].body);
    assert.equal(body.voice, "Azure.de-DE-KatjaNeural");
    assert.ok(!("voice_settings" in body));
  });
});

// T-neu 4 (Regression Inbound): OHNE useAssistantVoice bleibt der Body Azure-Bestand, auch
// bei voller ElevenLabs-Config - der Inbound-Pfad (telnyx-inbound.js) reicht das Feld nie durch.
test("afix-p1 (T-neu 4, Regression Inbound): speak OHNE useAssistantVoice -> Azure-Bestand trotz voller Config", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.speak({
    callControlId: "cc_1",
    text: "Hallo",
    voiceProfile: "de-female-neural",
  });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.voice, "Azure.de-DE-KatjaNeural");
  assert.equal(body.language, "de-DE");
  assert.ok(!("voice_settings" in body));
});

// OBS-2 Test 5 (speak, PII): Erfolgs-Log traegt Op+Status+ccid-Praesenz, NIE den
// callControlId-Wert und NIE den API-Key (Regel 4).
test("OBS-2: speak ok-Log traegt status+ccid=true, NIE den callControlId-Wert/Key", async () => {
  stubFetch({ status: 200, json: {} });
  const lines = await captureConsole(() =>
    telnyxVoice.speak({
      callControlId: "cc_secret_value",
      text: "Hallo",
      voiceProfile: "de-female-neural",
    }),
  );
  const line = lines.find((l) => l.includes("[telnyx/voice] speak ok"));
  assert.ok(line, "speak-Erfolgs-Log fehlt");
  assert.match(line, /status=200/);
  assert.match(line, /ccid=true/);
  assert.ok(!line.includes("cc_secret_value"));
  assert.ok(!line.includes(API_KEY));
});

// OBS-2 Test 6 (originate, Praesenz aus Response): ccid=true kommt hier aus der Antwort
// (data.call_control_id), NIE der Wert selbst.
test("OBS-2: originateViaCallControl ok-Log traegt status+ccid=true, NIE die ccid aus der Response", async () => {
  stubFetch({ status: 201, json: { data: { call_control_id: "cc_resp_secret" } } });
  const lines = await captureConsole(() => telnyxVoice.originateViaCallControl(CC_ORIGINATE));
  const line = lines.find((l) => l.includes("[telnyx/voice] originateViaCallControl ok"));
  assert.ok(line, "originateViaCallControl-Erfolgs-Log fehlt");
  assert.match(line, /status=201/);
  assert.match(line, /ccid=true/);
  assert.ok(!line.includes("cc_resp_secret"));
});

// OBS-2 Test 6b (T5 Grenzbedingung): 2xx-Antwort OHNE call_control_id -> ccid=false.
// Deckt den bislang ungetesteten ccidPresent=false-Zweig ab (Runde 3, Review-Blocker).
test("OBS-2: originateViaCallControl ok-Log traegt ccid=false, wenn die Antwort keine call_control_id hat", async () => {
  stubFetch({ status: 200, json: { data: {} } });
  const lines = await captureConsole(() => telnyxVoice.originateViaCallControl(CC_ORIGINATE));
  const line = lines.find((l) => l.includes("[telnyx/voice] originateViaCallControl ok"));
  assert.ok(line, "originateViaCallControl-Erfolgs-Log fehlt");
  assert.match(line, /status=200/);
  assert.match(line, /ccid=false/);
});

// OBS-2 Test 7: kein Erfolgs-Log auf dem Fehlerpfad (assertTelnyxOk wirft VOR dem Log).
test("OBS-2: kein [telnyx/voice]-Log auf dem Fehlerpfad (assertTelnyxOk wirft vorher)", async () => {
  stubFetch({
    ok: false,
    status: 403,
    json: { errors: [{ code: "10015", title: "nope" }] },
  });
  const lines = await captureConsole(() =>
    assert.rejects(() =>
      telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "a" }),
    ),
  );
  assert.ok(!lines.some((l) => l.includes("[telnyx/voice]")), "kein Erfolgs-Log bei HTTP-Fehler");
});

// OBS-2 Test 8: endCallViaCallControl + startAssistant loggen unter ihrem jeweiligen Op-Namen.
test("OBS-2: endCallViaCallControl/startAssistant loggen unter ihrem Op-Namen", async () => {
  stubFetch({ status: 200, json: {} });
  const endLines = await captureConsole(() => telnyxVoice.endCallViaCallControl("cc_1"));
  assert.ok(endLines.some((l) => l === "[telnyx/voice] endCallViaCallControl ok status=200 ccid=true"));

  stubFetch({ status: 200, json: {} });
  const startLines = await captureConsole(() =>
    telnyxVoice.startAssistant({ callControlId: "cc_1", assistantId: "assistant-77" }),
  );
  assert.ok(startLines.some((l) => l === "[telnyx/voice] startAssistant ok status=200 ccid=true"));
});
