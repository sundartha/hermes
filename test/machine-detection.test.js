// GAP-21 (tasks/i18n-tests/11-luecken-und-e2e.md, kanonisch per
// tasks/i18n-tests/00-kanonische-liste.md Cluster D24): Anrufbeantworter/IVR werden von
// Hermes nicht erkannt - jeder Outbound-Call, der auf eine Mailbox laeuft, wird trotzdem
// als vollwertiges Gespraech behandelt und bezahlt.
//
// Scope-Begrenzung dieses Tests (s. Workflow-Auftrag): fuer ein greenfield-Feature ohne
// jeden Bestandscode waere ein Webhook-/Store-Integrationstest (Schritt 2/3 der
// Katalog-Spezifikation) reine Spekulation ueber eine noch nicht existierende Form. Der
// SOLL-Beweis wird deshalb auf Schritt 1 begrenzt: BEIDE Origination-Pfade (TeXML +
// Call-Control) muessen ein Machine-Detection-Feld im gesendeten Body tragen - das ist
// bereits ausreichend, um den Launch-Blocker rot zu zeigen (0 Treffer heute, grep-belegt:
// tasks/i18n-tests/11-luecken-und-e2e.md:539-541).
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

const { telnyxVoice } = await import("../src/telephony/adapters/telnyx/voice.js");

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

// Breiter, namensneutraler Treffer statt eines geratenen exakten Feldnamens (das Feature
// existiert noch nicht - ein spekulativer Literal-Pin waere selbst Ist-Pin-Risiko).
const MACHINE_DETECTION_KEY = /answering_machine|machine_detection/i;

function hasMachineDetectionField(obj) {
  return Object.keys(obj).some((k) => MACHINE_DETECTION_KEY.test(k));
}

test("GAP-21 (SOLL rot, TeXML): originateCall traegt ein Machine-Detection-Feld", async () => {
  const calls = stubFetch({ json: { sid: "tnx_gap21" } });
  await telnyxVoice.originateCall({
    from: "+13125550100",
    to: "+4917312345678",
    url: "https://agent.test/voice/outbound?callId=call_gap21",
    method: "POST",
  });
  const form = new URLSearchParams(calls[0].body.toString());
  assert.ok(
    hasMachineDetectionField(Object.fromEntries(form.entries())),
    `originateCall-Body traegt kein Machine-Detection-Feld (Launch-Blocker): ${form.toString()}`,
  );
});

test("GAP-21 (SOLL rot, Call-Control): originateViaCallControl traegt ein Machine-Detection-Feld", async () => {
  const calls = stubFetch({ json: { call_control_id: "cc_gap21" } });
  await telnyxVoice.originateViaCallControl({
    from: "+13125550100",
    to: "+4917312345678",
  });
  const body = JSON.parse(calls[0].body);
  assert.ok(
    hasMachineDetectionField(body),
    `originateViaCallControl-Body traegt kein Machine-Detection-Feld (Launch-Blocker): ${JSON.stringify(body)}`,
  );
});
