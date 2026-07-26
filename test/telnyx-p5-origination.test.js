// P5 (PLAN-TELNYX-AI-ASSISTANT.md, Origination-Integration): deckt tasks/telnyx-p5-spec.md
// Checks 2/3/5(i). (A) Unit gegen originateAiAssistantCall mit Spy-Store/-VoiceControl
// (kein Netz, offline, F.I.R.S.T.) - exakte webhookUrl + Persistenz. (B) Spawn: Flag aus
// bleibt TeXML byte-identisch (auch bei Telnyx-Provider), Flag an + Telnyx nimmt den
// Call-Control-Pfad (fakeVoice-Praefixe als Pfad-Diskriminator, Muster [[i8-design-decisions]]).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  placeCall,
  waitForStoreState,
  seedState,
  TELNYX_TEST_OWNER_NUMBER,
  TELNYX_TEST_PEER_NUMBER,
  TELNYX_ASSISTANT_BOOT_ENV,
} from "./helpers.js";
import { originateAiAssistantCall } from "../src/telnyx-origination.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

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

test("originateAiAssistantCall: exakte webhookUrl + Persistenz, EIN Aufruf", async () => {
  const store = spyStore();
  const voiceControl = spyVoiceControl("cc_1");
  const call = { id: "call_abc", provider: "telnyx" };
  const config = withConfigNamespaces({
    publicUrl: "https://agent.test",
    telnyxAssistant: { assistantId: "asst_9" },
  });

  await originateAiAssistantCall({
    store,
    voiceControl,
    config,
    call,
    fromNumber: "+4930000000",
    to: TELNYX_TEST_PEER_NUMBER,
    maxDur: 180,
  });

  assert.equal(voiceControl.calls.length, 1, "originateViaCallControl genau EINMAL");
  assert.equal(voiceControl.calls[0].provider, "telnyx", "voiceControl(call.provider)");
  assert.deepEqual(voiceControl.calls[0].params, {
    from: "+4930000000",
    to: TELNYX_TEST_PEER_NUMBER,
    webhookUrl: "https://agent.test/voice/call-control?callId=call_abc",
    method: "POST",
    timeLimit: 180,
  });
  assert.equal(call.assistantId, "asst_9", "aus config.telnyxAssistant.assistantId");
  assert.equal(call.callControlId, "cc_1", "aus der originateViaCallControl-Rueckgabe");
  assert.equal(store.saveCalls.length, 1, "store.save() genau einmal");
});

// === B: Spawn - Pfadwahl ueber server.js /api/calls ================================

test("Flag aus (byte-identisch): TeXML-Pfad auch bei Telnyx-Provider, kein Call-Control", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true" }, // TELNYX_AI_ASSISTANT_ENABLED bleibt BASE_ENV-Default (false)
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, 200);
    const { callId } = await res.json();

    const call = srv.readStore().calls.find((c) => c.id === callId);
    assert.match(call.twilioSid, /^fake_/, "TeXML-Fake-Praefix (nicht fake_cc_)");
    assert.equal(call.callControlId, null);
    assert.equal(call.assistantId, null);
  } finally {
    await srv.stop();
  }
});

test("Flag an + Telnyx: Call-Control-Pfad - callControlId gesetzt, twilioSid null, originateCall NICHT gerufen", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      TELNYX_AI_ASSISTANT_ENABLED: "true",
      ...TELNYX_ASSISTANT_BOOT_ENV,
    },
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(res.status, 200);
    const { callId, twilioSid } = await res.json();
    assert.equal(
      twilioSid,
      null,
      "Response spiegelt call.twilioSid (im Call-Control-Pfad nie gesetzt)",
    );

    const stored = srv.readStore().calls.find((c) => c.id === callId);
    assert.match(
      stored.callControlId,
      /^fake_cc_/,
      "fakeVoice-Praefix beweist den Call-Control-Pfad",
    );
    assert.equal(
      stored.twilioSid,
      null,
      "kein TeXML-Originate gerufen (kein fake_-Praefix ohne _cc_)",
    );
    // P10: TELNYX_ASSISTANT_ID ist bei aktivem Flag jetzt Boot-Pflicht (assertConfig) -
    // "neutral leer" ist seitdem kein erreichbarer Zustand eines LAUFENDEN Servers mehr.
    // stored.assistantId spiegelt einfach den injizierten config-Wert (bindAssistantToCall).
    assert.equal(
      stored.assistantId,
      TELNYX_ASSISTANT_BOOT_ENV.TELNYX_ASSISTANT_ID,
      "assistantId kommt aus config.telnyxAssistant.assistantId (bindAssistantToCall)",
    );
  } finally {
    await srv.stop();
  }
});

// === D: Fehlerpfad - originateViaCallControl schlaegt fehl (gemeinsamer catch-Block) ==
// Blocker S1-1: originateAiAssistantCall setzt call.assistantId auf dem LEBENDEN Call
// VOR dem await auf originateViaCallControl. Schlaegt der Aufruf fehl, muss
// derselbe try/catch wie der TeXML-Zweig greifen (releaseReserve + endCallRecord('failed')),
// NICHT nur der bereits getestete Erfolgsfall (A) oder die 14 Gate-Denies (gate-proof, die
// alle VOR der Origination greifen). KEIN FAKE_ORIGINATE hier: der echte Telnyx-Adapter soll
// wirklich (asynchron) scheitern. P10: TELNYX_API_KEY/CONNECTION_ID sind bei aktivem Flag
// jetzt Boot-Pflicht (assertConfig), der frueher hier genutzte "synchron+netzfrei wegen
// fehlendem TELNYX_API_KEY"-Trigger ist seitdem kein erreichbarer Zustand mehr. Stattdessen
// zeigt TELNYX_API_BASE auf einen lokalen, garantiert verweigerten Port (127.0.0.1:1) -
// fetch() schlaegt binnen Millisekunden mit ECONNREFUSED fehl, weiterhin ohne echtes Netz
// oder Mock-Server (F.I.R.S.T.), aber jetzt NACH einem gueltigen Boot.
test("Flag an + Telnyx: originateViaCallControl-Fehlschlag -> 500, call failed, Reserve freigegeben", async () => {
  const srv = await startServer({
    env: {
      TELNYX_AI_ASSISTANT_ENABLED: "true",
      VOICE_TARIFF_DOMESTIC_CENTS: "20", // reserveCents muss > 0 sein, sonst ist releaseOutboundReserve ein No-op
      ...TELNYX_ASSISTANT_BOOT_ENV,
      TELNYX_API_BASE: "http://127.0.0.1:1", // reservierter, garantiert verweigerter Port
    },
    // P11: language:"de" EXPLIZIT - der Notification-Titel unten ist ein DE-Literal-Pin
    // (WEB-14, call-finish.js postCall). Ohne diese Zeile loest der Weltdefault
    // (WORLD_DEFAULT_LANGUAGE_ENABLED=true im Test-Env) auf "en" auf und der Titel waere
    // englisch, unabhaengig vom hier getesteten Origination-Fehlerpfad.
    seed: seedState({ settings: { language: "de" } }),
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
  });
  try {
    const res = await placeCall(srv);
    assert.equal(
      res.status,
      500,
      "ECONNREFUSED traegt kein providerStatus (nur eine echte Provider-HTTP-Antwort tut das) -> generischer 500",
    );
    const body = await res.json();
    assert.equal(body.error, "Anruf konnte nicht gestartet werden.");
    assert.ok(
      !JSON.stringify(body).includes("TELNYX_API_KEY"),
      "keine Provider-/Config-Details an den Client",
    );

    let calls = srv.readStore().calls;
    assert.equal(calls.length, 1, "genau EIN Call-Record (kein Retry/Doppel-Create)");
    assert.equal(calls[0].status, "failed", "gemeinsamer catch-Block terminiert wie der TeXML-Zweig");
    // C5 (Struct-4): der catch-Block laeuft jetzt ueber terminateAndBillCall - bill (Settlement,
    // ruft releaseReserve intern) ist fire-and-forget (dieselbe Reihenfolge wie bei den anderen
    // 4 Terminierungspfaden), lief also NICHT mehr zwingend VOR der HTTP-Response ab. Muster
    // waitForStoreState wie max-duration-live-cap.test.js/telnyx-event-ingest-route.test.js.
    const s = await waitForStoreState(srv, (st) => st.calls[0]?.reserveReleased === true);
    calls = s.calls;
    assert.equal(calls[0].reserveReleased, true, "releaseReserve laeuft (async) ueber finishCall (OUT-05)");
    assert.equal(
      calls[0].callControlId,
      null,
      "kein callControlId, da originateViaCallControl vor der Rueckgabe warf",
    );
    // S1-1 (Review-Blocker Runde 1): der explizit beworbene C5-Fix-Zweck ("Notification fehlte
    // komplett bei Dial-Fehlschlag") war bisher ungetestet - nur reserveReleased/status wurden
    // geprueft. finishCall() legt bei einem nicht-completed Call (hier status=failed) genau EINE
    // Notification an (state-ops.js addNotification); s ist derselbe bereits gewartete Store-
    // Zustand wie oben (reserveReleased===true laeuft im selben finishCall-Aufruf VOR der
    // Notification, also steht sie zu diesem Zeitpunkt bereits fest).
    assert.equal(s.notifications.length, 1, "genau eine neue Notification (kein Doppel-Feuer)");
    assert.equal(
      s.notifications[0].title,
      "Anruf nicht zustande gekommen",
      "der C5-Fix erzeugt jetzt die Notification, die vor dem Umbau bei einem Dial-Fehlschlag fehlte",
    );
    assert.equal(s.notifications[0].callId, calls[0].id, "Notification haengt am fehlgeschlagenen Call");
  } finally {
    await srv.stop();
  }
});
