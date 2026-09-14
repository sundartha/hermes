// IEL-B7: Dial-Direktive (directives.js), TeXML-Renderer (<Dial><Sip>) und Umleitungs-Port
// (redirectCall). Rein offline: global.fetch wird gestubbt (Muster test/telnyx-voice.test.js).
// Die Telnyx-Config wird VOR dem Import gesetzt (dotenv ueberschreibt gesetzte Vars NICHT).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConfigOverrides } from "./helpers.js";

const XML = '<?xml version="1.0" encoding="UTF-8"?>';
const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";
const ACCOUNT_SID = "acct_xyz789";
const DID = "+4930123456789";
const TOKEN = "0123456789abcdef0123456789abcdef";
const STUB_DEFAULT_STATUS = 200;
const HTTP_UNPROCESSABLE = 422;
// Dieselben Grenzwerte wie DIAL_TIME_LIMIT_MIN_S/_MAX_S im Renderer (render.js) - hier
// als Testkonstanten benannt, damit keine nackte Zahl im Testkoerper steht (G25).
const DIAL_TIME_LIMIT_MIN_S = 60;
const DIAL_TIME_LIMIT_MAX_S = 14400;
const FAR_ABOVE_DIAL_TIME_LIMIT_MAX_S = 86400;
const DEFAULT_TIME_LIMIT_S = 1800; // liegt innerhalb der Grenzen, aendert sich also nicht
// IEL-B7-S1a-Nachtrag: dieselben Grenzwerte wie DIAL_TIMEOUT_MIN_S/_MAX_S im Renderer
// (render.js), hier als Testkonstanten benannt (G25).
const DIAL_TIMEOUT_MIN_S = 5;
const DIAL_TIMEOUT_MAX_S = 600;
const FAR_ABOVE_DIAL_TIMEOUT_MAX_S = 3600;

process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;
process.env.TELNYX_ACCOUNT_SID = ACCOUNT_SID;

// Dynamischer Import NACH dem Env-Setzen (config liest process.env beim Eval).
const { telnyxVoice } = await import("../src/telephony/adapters/telnyx/voice.js");
const { renderDirectives } = await import("../src/telephony/adapters/telnyx/render.js");
const { say, redirect, dialSip } = await import("../src/telephony/directives.js");
const { elSipUri, EL_CALL_BINDING_SIP_HEADER } = await import("../src/elevenlabs/inbound-sip-uri.js");
const initiation = await import("../src/elevenlabs/inbound-initiation.js");
const { config } = await import("../src/config.js");

const { withBlankedConfig } = makeConfigOverrides(config);

function stubFetch(response) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts, body: opts?.body?.toString() });
    return {
      ok: response.ok ?? true,
      status: response.status ?? STUB_DEFAULT_STATUS,
      json: async () => response.json ?? {},
      text: async () => response.text ?? JSON.stringify(response.json ?? {}),
    };
  };
  return calls;
}

function baueDialSip(overrides = {}) {
  return dialSip({
    uri: elSipUri({ did: DID, token: TOKEN }),
    username: "hermes-sip",
    password: "pw-geheim",
    callerId: DID,
    timeoutS: 20,
    timeLimitS: DEFAULT_TIME_LIMIT_S,
    statusCallbackUrl: "https://agent.test/voice/el-bein?callId=call_1",
    ...overrides,
  });
}

// Rendert eine Direktivenliste ohne den XML+<Response>-Rahmen (Vergleichshilfe).
function renderEinzeln(directives) {
  return renderDirectives(directives).slice((XML + "<Response>").length, -"</Response>".length);
}

test("IEL-B7-1: Abnahme-Form exakt", () => {
  const inner = renderEinzeln([baueDialSip()]);
  assert.equal(
    inner,
    '<Dial callerId="+4930123456789" timeout="20" timeLimit="1800">' +
      '<Sip username="hermes-sip" password="pw-geheim" statusCallback="https://agent.test/voice/el-bein?callId=call_1" statusCallbackEvent="answered">' +
      "sip:+4930123456789@sip.rtc.elevenlabs.io:5060;transport=tcp?X-Hermes-Call-Binding=0123456789abcdef0123456789abcdef" +
      "</Sip></Dial>",
  );
});

test("IEL-B7-2: Escape aller Attribute und der URI", () => {
  const inner = renderEinzeln([
    baueDialSip({
      username: "u&<",
      password: 'p&w<o"r\'d>',
      callerId: '+49"1',
      statusCallbackUrl: "https://a.test/x?callId=c&quelle=q",
      uri: "sip:a&b<c>@h",
    }),
  ]);
  assert.match(inner, /password="p&amp;w&lt;o&quot;r&apos;d&gt;"/);
  assert.match(inner, /username="u&amp;&lt;"/);
  assert.match(inner, /callerId="\+49&quot;1"/);
  assert.match(inner, /statusCallback="https:\/\/a\.test\/x\?callId=c&amp;quelle=q"/);
  assert.match(inner, /sip:a&amp;b&lt;c&gt;@h/);
  assert.ok(!inner.includes(`<o"r`), "Rohfolge <o\" darf nicht auftauchen");
});

test("IEL-B7-3: timeLimit-Grenzen, tabellengetrieben", () => {
  const min = DIAL_TIME_LIMIT_MIN_S;
  const max = DIAL_TIME_LIMIT_MAX_S;
  const faelle = [
    [1, min],
    [min - 1, min],
    [min, min],
    [DEFAULT_TIME_LIMIT_S, DEFAULT_TIME_LIMIT_S],
    [max, max],
    [max + 1, max],
    [FAR_ABOVE_DIAL_TIME_LIMIT_MAX_S, max],
  ];
  for (const [eingabe, erwartet] of faelle) {
    const inner = renderEinzeln([baueDialSip({ timeLimitS: eingabe })]);
    assert.match(inner, new RegExp(`timeLimit="${erwartet}"`), `timeLimitS=${eingabe}`);
  }
});

test("IEL-B7-4: timeLimit keine Zahl -> wirft ohne Wert", () => {
  for (const kaputt of [undefined, NaN, "1800"]) {
    assert.throws(
      () => renderDirectives([baueDialSip({ timeLimitS: kaputt })]),
      (err) => {
        assert.ok(!err.message.includes("pw-geheim"));
        assert.ok(!err.message.includes("hermes-sip"));
        assert.ok(!err.message.includes(DID));
        return true;
      },
    );
  }
});

// IEL-B7-S1a-Nachtrag (Review-Blocker Runde 2): timeoutS lief bislang OHNE die Pruef-/
// Klemm-Funktion durch attrString und erzeugte bei fehlendem Wert woertlich
// timeout="undefined" im TeXML. Diese beiden Tests decken das ab (Muster IEL-B7-3/-4).
test("IEL-B7-14: timeout-Grenzen, tabellengetrieben", () => {
  const min = DIAL_TIMEOUT_MIN_S;
  const max = DIAL_TIMEOUT_MAX_S;
  const faelle = [
    [1, min],
    [min - 1, min],
    [min, min],
    [max, max],
    [max + 1, max],
    [FAR_ABOVE_DIAL_TIMEOUT_MAX_S, max],
  ];
  for (const [eingabe, erwartet] of faelle) {
    const inner = renderEinzeln([baueDialSip({ timeoutS: eingabe })]);
    assert.match(inner, new RegExp(`timeout="${erwartet}"`), `timeoutS=${eingabe}`);
  }
});

test("IEL-B7-15: fehlendes/kaputtes timeoutS -> wirft statt timeout=\"undefined\" zu rendern", () => {
  for (const kaputt of [undefined, NaN, "20"]) {
    assert.throws(
      () => renderDirectives([baueDialSip({ timeoutS: kaputt })]),
      (err) => {
        assert.match(err.message, /timeoutS/);
        assert.ok(!err.message.includes("pw-geheim"));
        assert.ok(!err.message.includes("hermes-sip"));
        assert.ok(!err.message.includes(DID));
        return true;
      },
      `timeoutS=${kaputt}`,
    );
  }
});

test("IEL-B7-4b: fehlendes Pflichtfeld -> wirft ohne 'undefined' im TeXML", () => {
  for (const feld of ["uri", "username", "password", "callerId", "statusCallbackUrl"]) {
    assert.throws(
      () => renderDirectives([baueDialSip({ [feld]: undefined })]),
      (err) => {
        assert.match(err.message, new RegExp(feld));
        assert.ok(!err.message.includes("pw-geheim"));
        assert.ok(!err.message.includes("hermes-sip"));
        assert.ok(!err.message.includes(DID));
        return true;
      },
      `Feld ${feld} fehlt`,
    );
  }
});

test("IEL-B7-4c: leerer String beim Pflichtfeld -> wirft ebenso", () => {
  for (const feld of ["uri", "username", "password", "callerId", "statusCallbackUrl"]) {
    assert.throws(() => renderDirectives([baueDialSip({ [feld]: "" })]), new RegExp(feld), `Feld ${feld} leer`);
  }
});

test("IEL-B7-5: Dial in der Erstantwort-Reihenfolge", () => {
  const inner = renderEinzeln([
    say("Pflicht"),
    baueDialSip(),
    redirect("/voice/el-rueckfall?callId=c&quelle=dial_ende"),
  ]);
  const dialIndex = inner.indexOf("<Dial");
  const sayIndex = inner.indexOf("<Say");
  const redirectIndex = inner.indexOf("<Redirect");
  assert.ok(sayIndex < dialIndex && dialIndex < redirectIndex);
  assert.match(inner, /<Redirect method="POST">\/voice\/el-rueckfall\?callId=c&amp;quelle=dial_ende<\/Redirect>/);
});

test("IEL-B7-6: elSipUri pinnt den Host", () => {
  assert.equal(
    elSipUri({ did: DID, token: TOKEN }),
    "sip:+4930123456789@sip.rtc.elevenlabs.io:5060;transport=tcp?X-Hermes-Call-Binding=0123456789abcdef0123456789abcdef",
  );
});

test("IEL-B7-7: elSipUri fail-closed", () => {
  const didFaelle = ["+49@evil.example", "4930123456789", "+4930123456789;x", "", undefined];
  for (const did of didFaelle) {
    assert.throws(
      () => elSipUri({ did, token: TOKEN }),
      (err) => {
        assert.ok(!String(did).length || !err.message.includes(String(did)));
        return true;
      },
    );
  }
  for (const token of ["", undefined]) {
    assert.throws(() => elSipUri({ did: DID, token }));
  }
});

test("IEL-B7-8: Token wird kodiert und aendert die URI nicht", () => {
  const uri = elSipUri({ did: DID, token: "a b;c@d?e" });
  assert.ok(uri.endsWith("?X-Hermes-Call-Binding=a%20b%3Bc%40d%3Fe"));
  const host = "@sip.rtc.elevenlabs.io:5060;transport=tcp?";
  assert.equal(uri.split(host).length - 1, 1);
});

test("IEL-B7-9: Schreiber und Leser teilen den Header-Namen", () => {
  assert.equal(EL_CALL_BINDING_SIP_HEADER, "X-Hermes-Call-Binding");
  assert.equal(initiation.EL_CALL_BINDING_SIP_HEADER, EL_CALL_BINDING_SIP_HEADER);
});

test("IEL-B7-10: redirectCall mit Fake-fetch", async () => {
  const calls = stubFetch({ json: {} });
  await telnyxVoice.redirectCall("tnx_call_1", "https://agent.test/voice/el-rueckfall?callId=call_1&quelle=frist");
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, `${API_BASE}/v2/texml/Accounts/${ACCOUNT_SID}/Calls/tnx_call_1`);
  assert.equal(call.opts.method, "POST");
  assert.equal(call.opts.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(call.opts.headers["Content-Type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(call.body);
  assert.deepEqual([...form.keys()], ["Url", "Method"]);
  assert.equal(form.get("Url"), "https://agent.test/voice/el-rueckfall?callId=call_1&quelle=frist");
  assert.equal(form.get("Method"), "POST");
});

test("IEL-B7-11: redirectCall-Fehler ohne Secrets", async () => {
  stubFetch({
    ok: false,
    status: HTTP_UNPROCESSABLE,
    json: {
      errors: [{ code: "90018", title: "Call not active", detail: "secret-fragment " + API_KEY }],
    },
  });
  await assert.rejects(
    () => telnyxVoice.redirectCall("tnx_call_1", "https://agent.test/voice/x"),
    (err) => {
      assert.match(err.message, new RegExp(`HTTP ${HTTP_UNPROCESSABLE}`));
      assert.match(err.message, /90018/);
      assert.equal(err.providerStatus, HTTP_UNPROCESSABLE);
      assert.ok(!err.message.includes(API_KEY));
      assert.ok(!err.message.includes("secret-fragment"));
      assert.ok(!err.message.includes("detail"));
      return true;
    },
  );
});

test("IEL-B7-12: redirectCall fail-closed ohne Netz", async () => {
  const calls = stubFetch({ json: {} });
  await withBlankedConfig("telnyxApiKey", () =>
    assert.rejects(
      () => telnyxVoice.redirectCall("tnx_1", "https://agent.test/voice/x"),
      /TELNYX_API_KEY fehlt/,
    ),
  );
  await withBlankedConfig("telnyxAccountSid", () =>
    assert.rejects(
      () => telnyxVoice.redirectCall("tnx_1", "https://agent.test/voice/x"),
      /TELNYX_ACCOUNT_SID fehlt/,
    ),
  );
  await assert.rejects(() => telnyxVoice.redirectCall("", "https://agent.test/voice/x"), /callSid fehlt/);
  assert.equal(calls.length, 0);
});

test("IEL-B7-13: Port-Vertrag", async () => {
  const { voiceControl } = await import("../src/telephony/registry.js");
  const { PROVIDER } = await import("../src/store/defaults.js");
  assert.equal(typeof voiceControl(PROVIDER.TELNYX).redirectCall, "function");
});
