// P5 (PLAN-TELNYX-AI-ASSISTANT.md, Origination-Integration): deckt tasks/telnyx-p5-spec.md
// Checks 2/3/5(i). (A) Unit gegen originateAiAssistantCall mit Spy-Store/-VoiceControl
// (kein Netz, offline, F.I.R.S.T.) - exakte webhookUrl + Token-Mint + Persistenz. (B) Spawn:
// Flag aus bleibt TeXML byte-identisch (auch bei Telnyx-Provider), Flag an + Telnyx nimmt den
// Call-Control-Pfad (fakeVoice-Praefixe als Pfad-Diskriminator, Muster [[i8-design-decisions]]).
// (C) publicCall-Unit: aiAssistantToken verlaesst den Server nie (Muster streamToken).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { originateAiAssistantCall } from "../src/telnyx-origination.js";
import { publicCall } from "../src/store/views.js";

const TELNYX_OWNER_NUMBER = { e164: "+4915005551234", provider: "telnyx" };
const TO = "+4915112345678";

// === A: originateAiAssistantCall (DI, offline) ===================================

function spyStore() {
  const saveCalls = [];
  return { saveCalls, save: () => saveCalls.push(true) };
}

function spyVoiceControl(callControlId = "cc_spy_1") {
  const calls = [];
  const voiceControl = (provider) => ({
    async originateViaCallControl(params) {
      calls.push({ provider, params });
      return { callControlId };
    },
  });
  voiceControl.calls = calls;
  return voiceControl;
}

test("originateAiAssistantCall: exakte webhookUrl + Token-Mint (64-hex) + Persistenz, EIN Aufruf", async () => {
  const store = spyStore();
  const voiceControl = spyVoiceControl("cc_1");
  const call = { id: "call_abc", provider: "telnyx" };
  const config = { publicUrl: "https://agent.test", telnyxAssistantId: "asst_9" };

  await originateAiAssistantCall({
    store,
    voiceControl,
    config,
    call,
    fromNumber: "+4930000000",
    to: TO,
    maxDur: 180,
  });

  assert.equal(voiceControl.calls.length, 1, "originateViaCallControl genau EINMAL");
  assert.equal(voiceControl.calls[0].provider, "telnyx", "voiceControl(call.provider)");
  assert.deepEqual(voiceControl.calls[0].params, {
    from: "+4930000000",
    to: TO,
    webhookUrl: "https://agent.test/voice/call-control?callId=call_abc",
    method: "POST",
    timeLimit: 180,
  });
  assert.match(call.aiAssistantToken, /^[0-9a-f]{64}$/, "64-hex per-Call-Secret (32 Byte)");
  assert.equal(call.assistantId, "asst_9", "aus config.telnyxAssistantId");
  assert.equal(call.callControlId, "cc_1", "aus der originateViaCallControl-Rueckgabe");
  assert.equal(store.saveCalls.length, 1, "store.save() genau einmal");
});

// === B: Spawn - Pfadwahl ueber server.js /api/calls ================================

async function placeCall(srv, to = TO) {
  return fetch(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });
}

test("Flag aus (byte-identisch): TeXML-Pfad auch bei Telnyx-Provider, kein Call-Control", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true" }, // TELNYX_AI_ASSISTANT_ENABLED bleibt BASE_ENV-Default (false)
    ownerNumber: TELNYX_OWNER_NUMBER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, 200);
    const { callId } = await res.json();

    const call = srv.readStore().calls.find((c) => c.id === callId);
    assert.match(call.twilioSid, /^fake_/, "TeXML-Fake-Praefix (nicht fake_cc_)");
    assert.equal(call.callControlId, null);
    assert.equal(call.assistantId, null);
    assert.equal(call.aiAssistantToken, null);
  } finally {
    await srv.stop();
  }
});

test("Flag an + Telnyx: Call-Control-Pfad - callControlId gesetzt, twilioSid null, originateCall NICHT gerufen", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true", TELNYX_AI_ASSISTANT_ENABLED: "true" },
    ownerNumber: TELNYX_OWNER_NUMBER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, 200);
    const { callId, twilioSid } = await res.json();
    assert.equal(twilioSid, null, "Response spiegelt call.twilioSid (im Call-Control-Pfad nie gesetzt)");

    const stored = srv.readStore().calls.find((c) => c.id === callId);
    assert.match(stored.callControlId, /^fake_cc_/, "fakeVoice-Praefix beweist den Call-Control-Pfad");
    assert.equal(stored.twilioSid, null, "kein TeXML-Originate gerufen (kein fake_-Praefix ohne _cc_)");
    assert.match(stored.aiAssistantToken, /^[0-9a-f]{64}$/);
    assert.equal(stored.assistantId, "", "TELNYX_ASSISTANT_ID neutral leer (BASE_ENV) -> leerer assistantId");
  } finally {
    await srv.stop();
  }
});

test("Flag an + Telnyx: aiAssistantToken verlaesst GET /api/calls/:id nie", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true", TELNYX_AI_ASSISTANT_ENABLED: "true" },
    ownerNumber: TELNYX_OWNER_NUMBER,
  });
  try {
    const { callId } = await (await placeCall(srv)).json();
    const apiCall = await (await fetch(`${srv.localUrl}/api/calls/${callId}`)).json();
    assert.ok(!("aiAssistantToken" in apiCall), "Secret nie ueber /api/calls/:id (publicCall-Strip)");
  } finally {
    await srv.stop();
  }
});

// === D: Fehlerpfad - originateViaCallControl schlaegt fehl (gemeinsamer catch-Block) ==
// Blocker S1-1: originateAiAssistantCall setzt call.aiAssistantToken/assistantId auf dem
// LEBENDEN Call VOR dem await auf originateViaCallControl. Schlaegt der Aufruf fehl, muss
// derselbe try/catch wie der TeXML-Zweig greifen (releaseReserve + endCallRecord('failed')),
// NICHT nur der bereits getestete Erfolgsfall (A) oder die 14 Gate-Denies (gate-proof, die
// alle VOR der Origination greifen). KEIN FAKE_ORIGINATE hier: der echte Telnyx-Adapter
// wirft synchron+netzfrei bei fehlendem TELNYX_API_KEY (BASE_ENV-Default leer) - deterministisch,
// ohne Netz oder Mock-Server (F.I.R.S.T.).
test("Flag an + Telnyx: originateViaCallControl-Fehlschlag -> 500, call failed, Reserve freigegeben", async () => {
  const srv = await startServer({
    env: {
      TELNYX_AI_ASSISTANT_ENABLED: "true",
      VOICE_TARIFF_DOMESTIC_CENTS: "20", // reserveCents muss > 0 sein, sonst ist releaseOutboundReserve ein No-op
    },
    ownerNumber: TELNYX_OWNER_NUMBER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, 500, "kein providerStatus (Fehler VOR jedem Netz-Call) -> generischer 500");
    const body = await res.json();
    assert.equal(body.error, "Anruf konnte nicht gestartet werden.");
    assert.ok(!JSON.stringify(body).includes("TELNYX_API_KEY"), "keine Provider-/Config-Details an den Client");

    const calls = srv.readStore().calls;
    assert.equal(calls.length, 1, "genau EIN Call-Record (kein Retry/Doppel-Create)");
    const stored = calls[0];
    assert.equal(stored.status, "failed", "gemeinsamer catch-Block terminiert wie der TeXML-Zweig");
    assert.equal(stored.reserveReleased, true, "releaseReserve lief VOR endCallRecord (OUT-05)");
    assert.equal(stored.callControlId, null, "kein callControlId, da originateViaCallControl vor der Rueckgabe warf");
  } finally {
    await srv.stop();
  }
});

// === C: publicCall-Unit (Token-Schutz an der Quelle) ================================

test("publicCall: aiAssistantToken NIE in der Ausgabe (Muster streamToken)", () => {
  const call = { id: "c1", aiAssistantToken: "super-secret", streamToken: "x", summary: "s" };
  const out = publicCall(call);
  assert.ok(!("aiAssistantToken" in out));
  assert.equal(out.summary, "s");
});
