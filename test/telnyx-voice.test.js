// Telnyx-VoiceControl-Adapter (originateCall/endCall ueber die TeXML-REST-API).
// Rein offline: global.fetch wird gestubbt (keine echte Telnyx-API, F.I.R.S.T.).
// Die Telnyx-Config wird VOR dem Import gesetzt (dotenv ueberschreibt gesetzte
// Vars NICHT) -> die echte .env beeinflusst den Test nicht (Key-Leak-Schutz).
// Kein pglite/Server-Spawn hier (eigene Datei -> kein Test-Worker-Stall).
import { test } from "node:test";
import assert from "node:assert/strict";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";
const CONNECTION_ID = "conn_abc123";
const ACCOUNT_SID = "acct_xyz789";

process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;
process.env.TELNYX_CONNECTION_ID = CONNECTION_ID;
process.env.TELNYX_ACCOUNT_SID = ACCOUNT_SID;

// Dynamischer Import NACH dem Env-Setzen (config liest process.env beim Eval).
const { telnyxVoice } = await import("../src/telephony/adapters/telnyx/voice.js");
const { voiceControl } = await import("../src/telephony/registry.js");
const { PROVIDER } = await import("../src/store/defaults.js");
const { twilioVoice } = await import("../src/telephony/adapters/twilio/voice.js");
const { config } = await import("../src/config.js");

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

const ORIGINATE = {
  from: "+13125550100",
  to: "+4917312345678",
  url: "https://agent.test/voice/outbound?callId=call_1",
  statusCallback: "https://agent.test/voice/status?callId=call_1",
  statusCallbackEvent: ["answered", "completed"],
  method: "POST",
  timeLimit: 180,
};

test("originateCall: richtige TeXML-URL (connection_id), Form-Felder, Bearer, returns sid", async () => {
  const calls = stubFetch({ json: { sid: "tnx_call_1" } });
  const res = await telnyxVoice.originateCall(ORIGINATE);
  assert.equal(res.sid, "tnx_call_1");
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, `${API_BASE}/v2/texml/calls/${CONNECTION_ID}`);
  assert.equal(c.opts.method, "POST");
  assert.equal(c.opts.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(c.opts.headers["Content-Type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(c.body);
  assert.equal(form.get("From"), ORIGINATE.from);
  assert.equal(form.get("To"), ORIGINATE.to);
  assert.equal(form.get("Url"), ORIGINATE.url);
  assert.equal(form.get("StatusCallback"), ORIGINATE.statusCallback);
  assert.equal(form.get("UrlMethod"), "POST");
  assert.equal(form.get("StatusCallbackMethod"), "POST");
  assert.deepEqual(form.getAll("StatusCallbackEvent"), ["answered", "completed"]);
  assert.equal(form.get("TimeLimit"), "180");
});

test("originateCall: gewrappte {data:{sid}}-Antwort wird auch erkannt", async () => {
  stubFetch({ json: { data: { sid: "tnx_call_2" } } });
  const res = await telnyxVoice.originateCall(ORIGINATE);
  assert.equal(res.sid, "tnx_call_2");
});

test("originateCall: HTTP-Fehler wirft MIT Status, OHNE API-Key (Regel 4)", async () => {
  stubFetch({ ok: false, status: 422 });
  await assert.rejects(
    () => telnyxVoice.originateCall(ORIGINATE),
    (err) => {
      assert.match(err.message, /HTTP 422/);
      assert.ok(!err.message.includes(API_KEY), "API-Key darf nicht in der Fehlermeldung stehen");
      return true;
    },
  );
});

test("originateCall: 403 mit Telnyx-errors[] haengt code+title + providerStatus an, ohne Key/Roh-Body", async () => {
  // Telnyx liefert bei einer Konfig-Ablehnung einen errors[]-Body. Der Adapter
  // soll NUR code+title sichtbar machen (Diagnose im Log), NIE detail/Roh-Body
  // (kann Auth-/Nummern-Fragmente tragen) und NIE den API-Key (Regel 4/5).
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
    () => telnyxVoice.originateCall(ORIGINATE),
    (err) => {
      assert.match(err.message, /HTTP 403/);
      assert.match(err.message, /10015/, "Telnyx-Fehlercode sichtbar (Diagnose)");
      assert.match(err.message, /Caller ID not allowed/, "Telnyx-Titel sichtbar");
      assert.equal(
        err.providerStatus,
        403,
        "Status strukturiert fuer die Aufrufer-Kategorisierung",
      );
      assert.ok(!err.message.includes(API_KEY), "API-Key darf nicht leaken");
      assert.ok(
        !err.message.includes("detail"),
        "rohes detail-Feld nicht durchreichen (Allowlist code/title)",
      );
      assert.ok(!err.message.includes("secret-fragment"), "kein Roh-Body-Fragment");
      return true;
    },
  );
});

test("endCall: Twilio-kompatible URL (Accounts/.../Calls), Status=completed", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.endCall("tnx_call_1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_BASE}/v2/texml/Accounts/${ACCOUNT_SID}/Calls/tnx_call_1`);
  assert.equal(new URLSearchParams(calls[0].body).get("Status"), "completed");
});

test("endCall: HTTP-Fehler wirft ohne Key-Leak", async () => {
  stubFetch({ ok: false, status: 404 });
  await assert.rejects(
    () => telnyxVoice.endCall("nope"),
    (err) => {
      assert.match(err.message, /HTTP 404/);
      assert.ok(!err.message.includes(API_KEY));
      return true;
    },
  );
});

test("originateCall: fail-closed bei fehlendem TELNYX_API_KEY / CONNECTION_ID", async () => {
  stubFetch({ json: { sid: "should_not_reach" } });
  await withBlankedConfig("telnyxApiKey", () =>
    assert.rejects(() => telnyxVoice.originateCall(ORIGINATE), /TELNYX_API_KEY fehlt/),
  );
  await withBlankedConfig("telnyxConnectionId", () =>
    assert.rejects(() => telnyxVoice.originateCall(ORIGINATE), /TELNYX_CONNECTION_ID fehlt/),
  );
});

test("endCall: fail-closed bei fehlendem TELNYX_ACCOUNT_SID", async () => {
  stubFetch({ json: {} });
  await withBlankedConfig("telnyxAccountSid", () =>
    assert.rejects(() => telnyxVoice.endCall("tnx_1"), /TELNYX_ACCOUNT_SID fehlt/),
  );
});

test("voiceControl(provider): telnyx -> telnyxVoice, twilio/Default -> twilioVoice", () => {
  assert.equal(voiceControl(PROVIDER.TELNYX), telnyxVoice);
  assert.equal(voiceControl(PROVIDER.TWILIO), twilioVoice);
  assert.equal(voiceControl(), twilioVoice, "arg-los -> Twilio-Default (byte-identisch)");
  assert.equal(voiceControl(undefined), twilioVoice, "fail-safe: undefined -> Twilio");
});
