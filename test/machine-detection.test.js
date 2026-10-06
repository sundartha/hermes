import { test } from "node:test";
import assert from "node:assert/strict";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";
const CONNECTION_ID = "conn_gap21_texml";
process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;
process.env.TELNYX_CONNECTION_ID = CONNECTION_ID;
process.env.MACHINE_DETECTION_ENABLED = "true";
process.env.MACHINE_DETECTION_TIMEOUT_S = "5";

const { telnyxVoice } = await import("../src/telephony/adapters/telnyx/voice.js");
const { config } = await import("../src/config.js");

async function withMachineDetectionOff(fn) {
  const saved = config.telephony.machineDetection;
  config.telephony.machineDetection = { enabled: false, timeoutS: saved.timeoutS };
  try {
    return await fn();
  } finally {
    config.telephony.machineDetection = saved;
  }
}

function stubFetch(response = { json: {} }) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts, body: opts?.body });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json ?? {},
      text: async () => response.text ?? JSON.stringify(response.json ?? {}),
    };
  };
  return calls;
}

const MACHINE_DETECTION_KEY = /(answering[_]?machine|machine)[_]?detection/i;

function hasMachineDetectionField(obj) {
  return Object.keys(obj).some((k) => MACHINE_DETECTION_KEY.test(k));
}

test("originateCall traegt das Machine-Detection-Feld (GAP-21)", async () => {
  const calls = stubFetch({ json: { sid: "tnx_gap21" } });
  await telnyxVoice.originateCall({
    from: "+13125550100",
    to: "+4917312345678",
    url: "https://agent.test/voice/outbound?callId=call_gap21",
    method: "POST",
  });
  const form = new URLSearchParams(calls[0].body.toString());
  const obj = Object.fromEntries(form.entries());
  assert.ok(hasMachineDetectionField(obj), `kein Machine-Detection-Feld: ${form.toString()}`);
  assert.equal(obj.AnsweringMachineDetection, "detect", "exakter TeXML-Feldname (Objekt-GET-belegt)");
});

test("Detection-Timeout wird als eigenes Feld mitgeschickt", async () => {
  const calls = stubFetch({ json: { sid: "tnx_gap21_timeout" } });
  await telnyxVoice.originateCall({
    from: "+13125550100",
    to: "+4917312345678",
    url: "https://agent.test/voice/outbound?callId=call_gap21b",
    method: "POST",
  });
  const form = new URLSearchParams(calls[0].body.toString());
  assert.equal(form.get("MachineDetectionTimeout"), "5");
});

test("Flag AUS: beide Origination-Bodies sind byte-identisch zum Bestand (GAP-21 Deploy-Sicherung)", async () => {
  await withMachineDetectionOff(async () => {
    const calls1 = stubFetch({ json: { sid: "tnx_gap21_off" } });
    await telnyxVoice.originateCall({
      from: "+13125550100",
      to: "+4917312345678",
      url: "https://agent.test/voice/outbound?callId=call_gap21c",
      method: "POST",
    });
    const form = new URLSearchParams(calls1[0].body.toString());
    assert.ok(!hasMachineDetectionField(Object.fromEntries(form.entries())), "TeXML-Body traegt kein Feld");
  });
});
