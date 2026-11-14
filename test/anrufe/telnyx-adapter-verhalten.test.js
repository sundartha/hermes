import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole, makeConfigOverrides, makeTelnyxSigner } from "../helpers.js";
import { dialSip, say, gather, redirect } from "../../src/telephony/directives.ts";
import { TELNYX_RESERVIERUNG_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";

const API_BASE = "https://telnyx.adapter.test";
const API_KEY = TELNYX_RESERVIERUNG_SCHLUESSEL;
const CONNECTION_ID = "conn_adapter_1";
const ACCOUNT_SID = "acct_adapter_1";
process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;
process.env.TELNYX_CONNECTION_ID = CONNECTION_ID;
process.env.TELNYX_ACCOUNT_SID = ACCOUNT_SID;

const { config } = await import("../../src/config.js");
const registry = await import("../../src/telephony/registry.js");

const { withConfig } = makeConfigOverrides(config);
const voice = registry.voiceControl("telnyx");

function stubFetch(response = {}) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts, body: opts?.body?.toString() });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json ?? {},
      text: async () => response.text ?? JSON.stringify(response.json ?? {}),
    };
  };
  return calls;
}

const NOW_S = 1_700_000_000;
const REPLAY_WINDOW_S = 300;

function verify(signer, { ts, body, headerTs = ts, signedTs = ts }) {
  const rawBody = Buffer.from(body);
  return registry.inboundSignatureVerifier().verifyInboundSignature({
    headers: {
      "telnyx-signature-ed25519": signer.sign(signedTs, rawBody),
      "telnyx-timestamp": String(headerTs),
    },
    rawBody,
  });
}

test("Signatur: das Replay-Fenster gilt auf den Punkt, in beide Richtungen", async (t) => {
  t.mock.method(Date, "now", () => NOW_S * 1000);
  const signer = makeTelnyxSigner();
  await withConfig("telnyxPublicKey", signer.publicKeyBase64, () => {
    const faelle = [
      [NOW_S - REPLAY_WINDOW_S, true],
      [NOW_S - REPLAY_WINDOW_S - 1, false],
      [NOW_S + REPLAY_WINDOW_S, true],
      [NOW_S + REPLAY_WINDOW_S + 1, false],
      [NOW_S, true],
    ];
    for (const [ts, erwartet] of faelle) {
      assert.equal(verify(signer, { ts: String(ts), body: "{}" }), erwartet, `ts=${ts - NOW_S}`);
    }
  });
});

test("Signatur: ein nicht numerischer Zeitstempel wird auch mit gueltiger Signatur abgelehnt", async () => {
  const signer = makeTelnyxSigner();
  await withConfig("telnyxPublicKey", signer.publicKeyBase64, () => {
    assert.equal(verify(signer, { ts: "abc", body: "{}" }), false);
  });
});

test("Signatur: Schluessel mit falscher Laenge oder kaputtes PEM lehnt ab statt zu werfen", async () => {
  const signer = makeTelnyxSigner();
  const kurzerSchluessel = Buffer.alloc(16, 7).toString("base64");
  const langerSchluessel = Buffer.alloc(33, 7).toString("base64");
  const ts = String(Math.floor(Date.now() / 1000));
  for (const key of [kurzerSchluessel, langerSchluessel, "-----BEGIN PUBLIC KEY-----\nkaputt\n-----END PUBLIC KEY-----"]) {
    await withConfig("telnyxPublicKey", key, () => {
      assert.equal(verify(signer, { ts, body: "{}" }), false, key.slice(0, 12));
    });
  }
});

test("Signatur: Signatur ueber anderen Zeitstempel oder fremden Schluessel gilt nicht", async () => {
  const signer = makeTelnyxSigner();
  const ts = String(Math.floor(Date.now() / 1000));
  await withConfig("telnyxPublicKey", signer.publicKeyBase64, () => {
    assert.equal(verify(signer, { ts, body: "{}", signedTs: String(Number(ts) - 1) }), false);
    assert.equal(verify(signer, { ts, body: "{}" }), true);
  });
  await withConfig("telnyxPublicKey", makeTelnyxSigner().publicKeyBase64, () => {
    assert.equal(verify(signer, { ts, body: "{}" }), false);
  });
});

test("Signatur: ein Body, der kein Buffer ist, wirft nicht, sondern lehnt ab", async () => {
  const signer = makeTelnyxSigner();
  const ts = String(Math.floor(Date.now() / 1000));
  await withConfig("telnyxPublicKey", signer.publicKeyBase64, () => {
    const ergebnis = registry.inboundSignatureVerifier().verifyInboundSignature({
      headers: { "telnyx-signature-ed25519": signer.sign(ts, "{}"), "telnyx-timestamp": ts },
      rawBody: "{}",
    });
    assert.equal(ergebnis, false);
  });
});

test("Call-Steuerung: playbackStart und bridge senden Bearer, JSON und den genauen Aktionskoerper", async () => {
  const calls = stubFetch();
  await voice.playbackStart("cc_1", { audioUrl: "https://audio.test/a.mp3" });
  await voice.bridge("cc_1", { zielId: "cc_2" });
  assert.deepEqual(
    calls.map((c) => [c.url, c.opts.method, c.body]),
    [
      [`${API_BASE}/v2/calls/cc_1/actions/playback_start`, "POST", '{"audio_url":"https://audio.test/a.mp3"}'],
      [`${API_BASE}/v2/calls/cc_1/actions/bridge`, "POST", '{"call_control_id":"cc_2"}'],
    ],
  );
  for (const c of calls) {
    assert.equal(c.opts.headers.Authorization, `Bearer ${API_KEY}`);
    assert.equal(c.opts.headers["Content-Type"], "application/json");
    assert.ok(c.opts.signal, "jede Anfrage hat eine Frist");
  }
});

test("Call-Steuerung: Erfolg loggt Operation und Status, Fehler wirft mit Status und Telnyx-Code", async () => {
  stubFetch({ status: 202 });
  const zeilen = await captureConsole(() => voice.bridge("cc_1", { zielId: "cc_2" }));
  assert.deepEqual(zeilen, ["[telnyx/voice] bridge ok status=202 ccid=true"]);
  stubFetch({ ok: false, status: 422, json: { errors: [{ code: "90041", title: "Anruf beendet" }] } });
  await assert.rejects(
    () => voice.playbackStart("cc_1", { audioUrl: "https://audio.test/a.mp3" }),
    (err) => {
      assert.equal(err.message, "Telnyx playbackStart fehlgeschlagen: HTTP 422 (90041 Anruf beendet)");
      assert.equal(err.providerStatus, 422);
      assert.equal(err.providerCode, "90041");
      return true;
    },
  );
});

test("dialCallControl: bildet jedes Feld auf den Telnyx-Koerper ab und liefert die Leitungs-ID", async () => {
  const calls = stubFetch({ json: { data: { call_control_id: "cc_neu" } } });
  const zeilen = await captureConsole(async () => {
    const res = await voice.dialCallControl({
      connectionId: "conn_x",
      to: "sip:ziel@sip.test",
      from: "+4930123456",
      webhookUrl: "https://agent.test/hook",
      timeLimitS: 120,
      commandId: "cmd_1",
      timeoutS: 30,
      linkTo: "cc_alt",
      customHeaders: [{ name: "X-A", value: "1" }],
      sipAuthUsername: "sip-user",
      sipAuthPassword: "sip-pass",
      sipTransportProtocol: "TLS",
    });
    assert.deepEqual(res, { callControlId: "cc_neu" });
  });
  const [anfrage] = calls;
  assert.equal(anfrage.url, `${API_BASE}/v2/calls`);
  assert.equal(anfrage.opts.method, "POST");
  assert.equal(anfrage.opts.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(anfrage.body), {
    connection_id: "conn_x",
    to: "sip:ziel@sip.test",
    from: "+4930123456",
    webhook_url: "https://agent.test/hook",
    time_limit_secs: 120,
    command_id: "cmd_1",
    timeout_secs: 30,
    link_to: "cc_alt",
    custom_headers: [{ name: "X-A", value: "1" }],
    sip_auth_username: "sip-user",
    sip_auth_password: "sip-pass",
    sip_transport_protocol: "TLS",
  });
  assert.deepEqual(zeilen, ["[telnyx/voice] dialCallControl ok status=200 ccid=true"]);
  stubFetch({ json: { data: {} } });
  const ohneId = await captureConsole(() => voice.dialCallControl({ to: "x", from: "y" }));
  assert.deepEqual(ohneId, ["[telnyx/voice] dialCallControl ok status=200 ccid=false"]);
});

test("dialCallControl: HTTP-Fehler wirft, ohne dass der Schluessel in der Meldung steht", async () => {
  stubFetch({ ok: false, status: 403 });
  await assert.rejects(
    () => voice.dialCallControl({ to: "x", from: "y" }),
    (err) => {
      assert.equal(err.message, "Telnyx dialCallControl fehlgeschlagen: HTTP 403");
      assert.equal(err.providerStatus, 403);
      return true;
    },
  );
});

const renderer = registry.voiceRenderer("telnyx");
const SIP = {
  uri: "sip:ziel@sip.test?a=1&b=2",
  username: "sip-user",
  password: "sip-pass",
  callerId: "+4930123456",
  timeoutS: 30,
  timeLimitS: 3600,
  statusCallbackUrl: "https://agent.test/status",
};
const dial = (felder) => renderer.renderDirectives([dialSip({ ...SIP, ...felder })]);

test("Render: Dial-SIP gibt Rufnummer, Fristen und maskierte SIP-Adresse genau aus", () => {
  assert.equal(
    dial({}),
    '<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="+4930123456" timeout="30" timeLimit="3600">' +
      '<Sip username="sip-user" password="sip-pass" statusCallback="https://agent.test/status" statusCallbackEvent="answered">' +
      "sip:ziel@sip.test?a=1&amp;b=2</Sip></Dial></Response>",
  );
  const mitOptionen = dial({ answerOnBridge: true, ringbackAudioUrl: "https://audio.test/r.mp3" });
  assert.match(mitOptionen, /<Dial answerOnBridge="true" audioUrl="https:\/\/audio\.test\/r\.mp3" callerId=/);
  assert.doesNotMatch(dial({ answerOnBridge: false, ringbackAudioUrl: "" }), /answerOnBridge|audioUrl/);
  assert.doesNotMatch(dial({ answerOnBridge: "true" }), /answerOnBridge/);
});

test("Render: Dial-SIP begrenzt Klingel- und Gespraechsdauer auf die Grenzen", () => {
  const faelle = [
    [{ timeoutS: 4, timeLimitS: 59 }, 'timeout="5" timeLimit="60"'],
    [{ timeoutS: 5, timeLimitS: 60 }, 'timeout="5" timeLimit="60"'],
    [{ timeoutS: 600, timeLimitS: 14400 }, 'timeout="600" timeLimit="14400"'],
    [{ timeoutS: 601, timeLimitS: 14401 }, 'timeout="600" timeLimit="14400"'],
  ];
  for (const [felder, erwartet] of faelle) assert.ok(dial(felder).includes(erwartet), erwartet);
});

test("Render: Dial-SIP ohne Pflichtfeld oder mit unbrauchbarer Frist wirft", () => {
  for (const feld of ["uri", "username", "password", "callerId", "statusCallbackUrl"]) {
    assert.throws(() => dial({ [feld]: "" }), new RegExp(`Dial-Direktive: ${feld} fehlt oder ist kein nichtleerer String`));
    assert.throws(() => dial({ [feld]: 5 }), new RegExp(`${feld} fehlt`));
  }
  assert.throws(() => dial({ timeoutS: "30" }), /Dial-Direktive: timeoutS ist keine Zahl/);
  assert.throws(() => dial({ timeLimitS: NaN }), /Dial-Direktive: timeLimitS ist keine Zahl/);
  assert.throws(() => renderer.renderDirectives([{ kind: "unbekannt" }]), /unbekannte Direktive: unbekannt/);
});

test("Render: Weiterleitung, Ansage mit Audio und Eingabe ohne Ansage", () => {
  const xml = renderer.renderDirectives([redirect("https://agent.test/r?a=1&b=2"), say("Hallo", undefined, "https://audio.test/h.mp3")]);
  assert.ok(xml.endsWith('<Redirect method="POST">https://agent.test/r?a=1&amp;b=2</Redirect><Play>https://audio.test/h.mp3</Play></Response>'));
  const leer = renderer.renderDirectives([gather({ action: "https://agent.test/g" })]);
  assert.match(leer, /<Gather input="speech" language="de-DE"[^>]* action="https:\/\/agent\.test\/g" method="POST"\/>/);
});

