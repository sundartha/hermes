// GAP-21 (tasks/i18n-tests/11-luecken-und-e2e.md, kanonisch per
// tasks/i18n-tests/00-kanonische-liste.md Cluster D24): Anrufbeantworter/IVR werden von
// Hermes erkannt (hinter MACHINE_DETECTION_ENABLED, Default AUS) - beide Origination-
// Pfade (TeXML + Call-Control) tragen ein Machine-Detection-Feld im gesendeten Body, NUR
// wenn das Flag an ist.
//
// Muster wie test/telnyx-voice.test.js: global.fetch gestubbt, Config VOR dem Import
// gesetzt (Key-Leak-Schutz), kein Server-Spawn.
import { test } from "node:test";
import assert from "node:assert/strict";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";
const CONNECTION_ID = "conn_gap21_texml";
const CALL_CONTROL_APP_ID = "ccapp_gap21";
process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;
process.env.TELNYX_CONNECTION_ID = CONNECTION_ID;
process.env.TELNYX_CALL_CONTROL_APP_ID = CALL_CONTROL_APP_ID;
// K2 (Deploy-Sicherheitsbeweis): Flag AN fuer die Feld-Praesenz-Tests, Muster
// PAYMENT_ENABLED/ELEVENLABS_PLAY_TTS_ENABLED. Der eigentliche Sicherheitsbeweis ist der
// separate "Flag AUS"-Test unten (per withConfigOverrides, kein zweiter Modul-Import).
process.env.MACHINE_DETECTION_ENABLED = "true";
process.env.MACHINE_DETECTION_TIMEOUT_S = "5";

const { telnyxVoice } = await import("../src/telephony/adapters/telnyx/voice.js");
const { config } = await import("../src/config.js");

// Eigene Save-Set-Restore-Schleife statt makeConfigOverrides().withConfigOverrides: der
// Helfer awaitet fn() NICHT (nur withConfig() tut das) - fuer einen ASYNCHRONEN Test-Body
// (originateCall/originateViaCallControl sind async) restaurierte er das Flag VOR dem
// Abschluss der Assertions. Try/finally hier bleibt explizit awaited.
async function withMachineDetectionOff(fn) {
  const saved = config.telephony.machineDetection;
  config.telephony.machineDetection = { enabled: false, timeoutS: saved.timeoutS };
  try {
    await fn();
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

// K1: der Regex traf nur den Unterstrich-Namen ("answering_machine_detection"), NIE die
// PascalCase-Formfelder des TeXML-Pfads ("AnsweringMachineDetection" - kein Unterstrich).
// Geweitet, damit BEIDE Namensformen erkannt werden, zusaetzlich zu den exakten
// Feldnamen-Assertionen je Pfad unten (namensneutral UND exakt).
const MACHINE_DETECTION_KEY = /(answering[_]?machine|machine)[_]?detection/i;

function hasMachineDetectionField(obj) {
  return Object.keys(obj).some((k) => MACHINE_DETECTION_KEY.test(k));
}

test("originateCall / originateViaCallControl traegt das Machine-Detection-Feld (GAP-21)", async (t) => {
  await t.test("TeXML: originateCall traegt AnsweringMachineDetection=detect", async () => {
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

  await t.test("Call-Control: originateViaCallControl traegt answering_machine_detection=detect", async () => {
    const calls = stubFetch({ json: { call_control_id: "cc_gap21" } });
    await telnyxVoice.originateViaCallControl({ from: "+13125550100", to: "+4917312345678" });
    const body = JSON.parse(calls[0].body);
    assert.ok(hasMachineDetectionField(body), `kein Machine-Detection-Feld: ${JSON.stringify(body)}`);
    assert.equal(body.answering_machine_detection, "detect", "exakter Call-Control-Feldname (Objekt-GET-belegt)");
  });
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

// K2 (Pre-Mortem 2): der eigentliche Deploy-Sicherheitsbeweis. Flag AUS (Bestandsdefault)
// -> BEIDE Origination-Bodies tragen KEIN Machine-Detection-Feld, byte-identisch zum
// Bestand vor GAP-21.
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

    const calls2 = stubFetch({ json: { call_control_id: "cc_gap21_off" } });
    await telnyxVoice.originateViaCallControl({ from: "+13125550100", to: "+4917312345678" });
    const body = JSON.parse(calls2[0].body);
    assert.ok(!hasMachineDetectionField(body), "Call-Control-Body traegt kein Feld");
  });
});
