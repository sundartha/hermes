// P8 (PLAN-TELNYX-AI-ASSISTANT.md, Inbound-Pfad + Inbound-Budget-Gate): deckt
// tasks/telnyx-p8-inbound-Checks 2/3/4/5(i). (A) Unit gegen startInboundAiAssistant +
// inboundCallControlId mit Spy-Store/-VoiceControl (kein Netz, offline, F.I.R.S.T.) -
// exakte Aufrufreihenfolge speak->startAssistant + Persistenz + Grenzfaelle. (B) Spawn:
// der Branch in /voice/incoming ERBT Signatur (app.use "/voice") + Tenant-Resolve +
// Answer-Budget-Gate, statt sie zu duplizieren (Befund 8) - Flag aus bzw. kein
// callControlId im Body bleiben byte-identisch auf dem TeXML-Gather-Pfad.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startServer,
  postTelnyxIncoming,
  seedWithTelnyxNumber,
  TELNYX_ASSISTANT_BOOT_ENV,
} from "./helpers.js";
import { startInboundAiAssistant, inboundCallControlId } from "../src/telnyx-inbound.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

// === A: startInboundAiAssistant + inboundCallControlId (DI, offline) ==================

function spyStore() {
  const saveCalls = [];
  return { saveCalls, save: () => saveCalls.push(true) };
}

function spyVoiceControl() {
  const order = [];
  const voiceControl = (provider) => ({
    async speak(params) {
      order.push({ op: "speak", provider, params });
    },
    async startAssistant(params) {
      order.push({ op: "startAssistant", provider, params });
    },
  });
  voiceControl.order = order;
  return voiceControl;
}

test("startInboundAiAssistant: assistantId + callControlId + EIN store.save()", async () => {
  const store = spyStore();
  const voiceControl = spyVoiceControl();
  const call = { id: "call_in1", provider: "telnyx" };
  const config = withConfigNamespaces({ telnyxAssistant: { assistantId: "asst_x" } });

  await startInboundAiAssistant({
    store,
    voiceControl,
    config,
    call,
    callControlId: "cc_inbound_9",
    greeting: "Hallo, hier ist der KI-Assistent von Jonas.",
    voiceProfile: "de-DE-KatjaNeural",
  });

  assert.equal(call.assistantId, "asst_x", "aus config.telnyxAssistant.assistantId");
  assert.equal(call.callControlId, "cc_inbound_9");
  assert.equal(store.saveCalls.length, 1, "store.save() genau einmal");
});

test("startInboundAiAssistant: speak EINMAL, startAssistant EINMAL, Reihenfolge speak -> startAssistant", async () => {
  const store = spyStore();
  const voiceControl = spyVoiceControl();
  const call = { id: "call_in2", provider: "telnyx" };
  const config = withConfigNamespaces({ telnyxAssistant: { assistantId: "asst_x" } });

  await startInboundAiAssistant({
    store,
    voiceControl,
    config,
    call,
    callControlId: "cc_inbound_9",
    greeting: "Hallo, hier ist der KI-Assistent von Jonas.",
    voiceProfile: "de-DE-KatjaNeural",
  });

  assert.equal(voiceControl.order.length, 2, "genau zwei Provider-Aufrufe");
  assert.equal(voiceControl.order[0].op, "speak", "Greeting VOR Assistant-Start (Regel 2)");
  assert.deepEqual(voiceControl.order[0].params, {
    callControlId: "cc_inbound_9",
    text: "Hallo, hier ist der KI-Assistent von Jonas.",
    voiceProfile: "de-DE-KatjaNeural",
  });
  assert.equal(voiceControl.order[1].op, "startAssistant");
  assert.deepEqual(
    voiceControl.order[1].params,
    { callControlId: "cc_inbound_9", assistantId: "asst_x" },
    "startAssistant traegt KEIN Auth-Feld (Shim authentifiziert per statischem Shared-Secret)",
  );
});

// afix-p2 (Review-Blocker Runde 2): der Inbound-Pfad bleibt in dieser Phase BYTE-IDENTISCH
// (STT-Sprach-Hint ist P6-Scope). call.language ist auf Inbound-Legs IMMER gesetzt
// (createCall-Default "de", server.js loest es vor dem Handoff auf) - der Test setzt
// bewusst einen Nicht-Default-Wert ("fr"), damit ein versehentlicher Passthrough sicher
// auffliegt und nicht durch einen Default-Treffer maskiert wird.
test("startInboundAiAssistant: call.language gesetzt -> startAssistant OHNE language-Feld (Inbound-Byte-Identitaet, afix-p2)", async () => {
  const store = spyStore();
  const voiceControl = spyVoiceControl();
  const call = { id: "call_in2b", provider: "telnyx", language: "fr" };
  const config = withConfigNamespaces({ telnyxAssistant: { assistantId: "asst_x" } });

  await startInboundAiAssistant({
    store,
    voiceControl,
    config,
    call,
    callControlId: "cc_inbound_9",
    greeting: "Hallo, hier ist der KI-Assistent von Jonas.",
    voiceProfile: "de-DE-KatjaNeural",
  });

  assert.deepEqual(
    voiceControl.order[1].params,
    { callControlId: "cc_inbound_9", assistantId: "asst_x" },
    "kein language-Feld trotz gesetztem call.language - Inbound bleibt byte-identisch bis P6",
  );
});

test("inboundCallControlId: Feld gesetzt -> Wert; fehlend/leer/nicht-string -> null", () => {
  assert.equal(inboundCallControlId({ CallControlId: "cc_1" }), "cc_1");
  assert.equal(inboundCallControlId({}), null, "Feld fehlt");
  assert.equal(inboundCallControlId({ CallControlId: "" }), null, "leerer String");
  assert.equal(inboundCallControlId({ CallControlId: 123 }), null, "nicht-string");
  assert.equal(inboundCallControlId(null), null, "body null");
});

// === B: Spawn - Pfadwahl ueber /voice/incoming =========================================

test("Flag an + Telnyx + unter Budget + callControlId im Body -> Handoff, Call-Control-Felder persistiert", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      TELNYX_AI_ASSISTANT_ENABLED: "true",
      ...TELNYX_ASSISTANT_BOOT_ENV,
    },
    seed: seedWithTelnyxNumber(),
  });
  try {
    const res = await postTelnyxIncoming(srv, { callControlId: "cc_inbound_9" });
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.doesNotMatch(xml, /<Gather/, "kein TeXML-Gather - der Assistant uebernimmt den Leg");

    const call = srv.readStore().calls[0];
    assert.equal(
      call.callControlId,
      "cc_inbound_9",
      "aus dem Body, kein fake_cc_-Praefix (Inbound != Outbound)",
    );
    assert.equal(call.assistantId, "asst_x");
    assert.equal(call.direction, "inbound");
    assert.equal(call.status, "active");
  } finally {
    await srv.stop();
  }
});

test("Flag an + Telnyx + ueber Budget -> Hangup, kein Call-Record, startAssistant unerreichbar", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      TELNYX_AI_ASSISTANT_ENABLED: "true",
      // LCT P6: kein MAX_BUDGET_EUR-Override mehr - BASE_ENV traegt bereits 30 (musste
      // damals mit der alten BASE_ENV=8 uebereinstimmen; ein niedrigerer Wert wuerde seit
      // P6 den Boot-Guard verweigern, plan_cap_inert). costEur:99 (9900 ct) uebersteigt
      // auch den 3000-ct-Cap bei weitem.
      ...TELNYX_ASSISTANT_BOOT_ENV,
    },
    seed: (() => {
      const s = seedWithTelnyxNumber();
      s.usage = {
        [BOOTSTRAP_TENANT_ID]: { inputTokens: 0, outputTokens: 0, costEur: 99, calls: 1 },
      };
      return s;
    })(),
  });
  try {
    const res = await postTelnyxIncoming(srv, { callControlId: "cc_inbound_9" });
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.match(xml, /<Hangup/, "Budget-Gate greift VOR dem Assistant-Branch");

    assert.equal(
      srv.readStore().calls.length,
      0,
      "kein Call-Record - das Gate returnt vor createCall",
    );
  } finally {
    await srv.stop();
  }
});

test("Flag an + Telnyx + bogus Ed25519-Signatur -> 403, kein Routing/Call-Record/Assistant-Kontext", async () => {
  const srv = await startServer({
    env: {
      // KEIN FAKE_ORIGINATE: der Boot-Guard verbietet die Kombination mit deaktiviertem
      // Signatur-Skip (Test-Seam nur bei SKIP_TWILIO_SIGNATURE_CHECK=true zulaessig). Der
      // Request scheitert ohnehin an der Signatur, lange bevor ein Origination-Call faellig
      // waere - kein Netzzugriff in diesem Testfall.
      TELNYX_AI_ASSISTANT_ENABLED: "true",
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      // TELNYX_PUBLIC_KEY bleibt BASE_ENV-Default leer -> verifyInboundSignature liefert
      // immer false (fail-closed, siehe telnyx-signature.test.js "fehlender Public-Key").
      ...TELNYX_ASSISTANT_BOOT_ENV,
    },
    seed: seedWithTelnyxNumber(),
  });
  try {
    const res = await postTelnyxIncoming(srv, { callControlId: "cc_inbound_9" });
    assert.equal(res.status, 403, "ohne gueltige Signatur kein Zugriff aufs Routing");
    assert.equal(srv.readStore().calls.length, 0);
  } finally {
    await srv.stop();
  }
});

test("Flag aus (byte-identisch): TeXML-Gather-Pfad auch bei Telnyx-Provider, kein Call-Control-Feld gesetzt", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true" }, // TELNYX_AI_ASSISTANT_ENABLED bleibt BASE_ENV-Default (false)
    seed: seedWithTelnyxNumber(),
  });
  try {
    const res = await postTelnyxIncoming(srv, { callControlId: "cc_inbound_9" });
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.match(xml, /<Gather/, "Flag aus -> Bestandspfad unveraendert");

    const call = srv.readStore().calls[0];
    assert.equal(call.callControlId, null);
    assert.equal(call.assistantId, null);
  } finally {
    await srv.stop();
  }
});

test("Flag an + Telnyx + callControlId ABWESEND -> fail-safe TeXML-Gather-Pfad, kein Assistant-Start", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      TELNYX_AI_ASSISTANT_ENABLED: "true",
      ...TELNYX_ASSISTANT_BOOT_ENV,
    },
    seed: seedWithTelnyxNumber(),
  });
  try {
    const res = await postTelnyxIncoming(srv); // kein callControlId im Body
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.match(
      xml,
      /<Gather/,
      "fehlendes CallControlId-Feld -> Bestandspfad, kein kaputter Assistant-Pfad",
    );

    const call = srv.readStore().calls[0];
    assert.equal(call.callControlId, null);
  } finally {
    await srv.stop();
  }
});
