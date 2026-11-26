import { test } from "node:test";
import assert from "node:assert/strict";
import { makeConfigOverrides } from ".././helpers.js";
import { antwortetNie, mitKurzerFrist } from ".././gemeinsam/kurze-antwortfrist.mjs";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";
const CONNECTION_ID = "conn_abc123";
const ACCOUNT_SID = "acct_xyz789";

process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;
process.env.TELNYX_CONNECTION_ID = CONNECTION_ID;
process.env.TELNYX_ACCOUNT_SID = ACCOUNT_SID;

const { telnyxVoice } = await import("../../src/telephony/adapters/telnyx/voice.js");
const { voiceControl } = await import("../../src/telephony/registry.js");
const { DEFAULT_PROVIDER, PROVIDER } = await import("../../src/begriffe/nummern-vergabe.ts");
const { config } = await import("../../src/config.ts");

const { withBlankedConfig } = makeConfigOverrides(config);

function stubFetch(response) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts, body: opts?.body?.toString() });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json ?? {},
      text: async () => response.text ?? JSON.stringify(response.json ?? {}),
    };
  };
  return calls;
}

test("endCall: TeXML-URL (Accounts/.../Calls), Status=completed", async () => {
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

test("endCall: fail-closed bei fehlendem TELNYX_ACCOUNT_SID", async () => {
  stubFetch({ json: {} });
  await withBlankedConfig("telnyxAccountSid", () =>
    assert.rejects(() => telnyxVoice.endCall("tnx_1"), /TELNYX_ACCOUNT_SID fehlt/),
  );
});

test("voiceControl(provider): telnyx -> telnyxVoice, arg-los -> DEFAULT_PROVIDER", () => {
  assert.equal(voiceControl(PROVIDER.TELNYX), telnyxVoice);
  assert.equal(voiceControl(), voiceControl(DEFAULT_PROVIDER), "arg-los folgt DEFAULT_PROVIDER");
  assert.equal(
    voiceControl(undefined),
    voiceControl(DEFAULT_PROVIDER),
    "undefined folgt DEFAULT_PROVIDER (kein eigener Anbieter-Default)",
  );
});

const ANRUF_STEUERN_FRIST_MS = 8_000;

const FRIST_FAELLE = [
  { name: "endCall", frist: ANRUF_STEUERN_FRIST_MS, ruf: () => telnyxVoice.endCall("tnx_1") },
  { name: "playbackStart", frist: ANRUF_STEUERN_FRIST_MS, ruf: () => telnyxVoice.playbackStart("cc_1", { audioUrl: "https://a.test/x.mp3" }) },
  { name: "dialCallControl", frist: ANRUF_STEUERN_FRIST_MS, ruf: () => telnyxVoice.dialCallControl({ to: "+4917312345678", from: "+13125550100" }) },
];

for (const fall of FRIST_FAELLE) {
  test(`${fall.name}: antwortet Telnyx nicht, bricht die Anfrage mit TimeoutError nach ${fall.frist} ms ab, ohne zweiten Versuch`, async () => {
    let aufrufe = 0;
    global.fetch = (url, init) => {
      aufrufe += 1;
      assert.equal("fristMs" in init, false, "fristMs darf fetch nicht erreichen");
      return antwortetNie(url, init);
    };
    const fristen = await mitKurzerFrist(() => assert.rejects(fall.ruf(), { name: "TimeoutError" }));
    assert.deepEqual(fristen, [fall.frist]);
    assert.equal(aufrufe, 1);
  });
}

test("dialCallControl: Wahlfelder gehen unveraendert in den Body", async () => {
  const calls = stubFetch({ json: { data: { call_control_id: "cc_9" } } });
  const res = await telnyxVoice.dialCallControl({ connectionId: "c1", to: "+491", from: "+492", linkTo: "cc_0" });
  assert.deepEqual(res, { callControlId: "cc_9" });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.connection_id, "c1");
  assert.equal(body.to, "+491");
  assert.equal(body.from, "+492");
  assert.equal(body.link_to, "cc_0");
});
