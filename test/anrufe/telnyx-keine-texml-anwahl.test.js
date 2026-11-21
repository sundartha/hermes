import assert from "node:assert/strict";
import { test } from "node:test";

const API_BASE = "https://telnyx.test";
const CONNECTION_ID = "conn_keine_texml_anwahl";
const ACCOUNT_SID = "acct_keine_texml_anwahl";

process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = "KEYtest-keine-texml-anwahl";
process.env.TELNYX_CONNECTION_ID = CONNECTION_ID;
process.env.TELNYX_ACCOUNT_SID = ACCOUNT_SID;

const { voiceControl } = await import("../../src/telephony/registry.js");
const { config } = await import("../../src/config.ts");

function stubFetch() {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: opts?.body?.toString() });
    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
  };
  return calls;
}

test("Telnyx-Anbindung: es gibt keine TeXML-Anwahl mehr, nur Call Control waehlt", () => {
  assert.equal(voiceControl("telnyx").originateCall, undefined);
  assert.equal(typeof voiceControl("telnyx").dialCallControl, "function");
});

test("Telnyx-Attrappe: es gibt keine TeXML-Anwahl, die Call-Control-Wahl bleibt", async () => {
  config.safety.fakeOriginate = true;
  try {
    const attrappe = voiceControl("telnyx");
    assert.equal(attrappe.originateCall, undefined);
    assert.match((await attrappe.dialCallControl({})).callControlId, /^fake_cc_/);
  } finally {
    config.safety.fakeOriginate = false;
  }
});

test("Telnyx-Anbindung: Beenden und Umleiten eines Eingangsanrufs laufen weiter ueber TeXML", async () => {
  const calls = stubFetch();
  await voiceControl("telnyx").endCall("CA_texml_1");
  await voiceControl("telnyx").redirectCall("CA_texml_2", "https://agent.test/voice/x");
  assert.deepEqual(
    calls.map((c) => c.url),
    [
      `${API_BASE}/v2/texml/Accounts/${ACCOUNT_SID}/Calls/CA_texml_1`,
      `${API_BASE}/v2/texml/Accounts/${ACCOUNT_SID}/Calls/CA_texml_2`,
    ],
  );
  assert.equal(new URLSearchParams(calls[0].body).get("Status"), "completed");
  assert.equal(new URLSearchParams(calls[1].body).get("Url"), "https://agent.test/voice/x");
});
