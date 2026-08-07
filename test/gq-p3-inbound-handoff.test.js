// GQ-P3 (Befund B-9/O-1): der Inbound-Handoff auf den Call-Control-Assistant. Ebene (A)
// die benannte Pfad-Entscheidung + Turn-Sonde + Boot-Sonde, rein/offline (kein Netz).
// Ebene (B) der Draht im echten Server, ein Spawn je Schalterstellung (Muster
// telnyx-p8-inbound.test.js/telnyx-p9-flag-matrix.test.js). Der dritte Abnahmefall der
// Spec ("Body ohne das Feld -> Rueckfall + laute Logzeile") ist Eigentum von GQ-S1-12 +
// telnyx-p8-inbound.test.js - hier nicht dupliziert (G5).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inboundHandoffDecision,
  logInboundPathDecision,
  INBOUND_PATH,
  INBOUND_BUDGET_REASON,
} from "../src/telnyx-inbound.js";
import { inboundHandoffProbeLine } from "../src/boot.js";
import { captureConsole, startServer, postTelnyxIncoming, seedWithTelnyxNumber, TELNYX_ASSISTANT_BOOT_ENV } from "./helpers.js";

// === Ebene A: reine Entscheidungs-/Sonden-Logik, offline =================================

test("GQ-P3-1: alle drei Bedingungen an + CallSid gesetzt -> Assistant-Pfad mit callControlId", () => {
  const decision = inboundHandoffDecision({
    assistantEnabled: true,
    handoffEnabled: true,
    providerCapable: true,
    body: { CallSid: "v3:abc" },
  });
  assert.deepEqual(decision, { path: INBOUND_PATH.ASSISTANT, reason: null, callControlId: "v3:abc" });
});

test("GQ-P3-2: die vier Budget-Gruende, je einzeln erzeugt - callControlId immer null", () => {
  const assistantDisabled = inboundHandoffDecision({
    assistantEnabled: false,
    handoffEnabled: true,
    providerCapable: true,
    body: { CallSid: "v3:abc" },
  });
  assert.equal(assistantDisabled.path, INBOUND_PATH.BUDGET);
  assert.equal(assistantDisabled.reason, INBOUND_BUDGET_REASON.ASSISTANT_DISABLED);
  assert.equal(assistantDisabled.callControlId, null);

  const handoffDisabled = inboundHandoffDecision({
    assistantEnabled: true,
    handoffEnabled: false,
    providerCapable: true,
    body: { CallSid: "v3:abc" },
  });
  assert.equal(handoffDisabled.reason, INBOUND_BUDGET_REASON.HANDOFF_DISABLED);
  assert.equal(handoffDisabled.callControlId, null);

  const providerUnsupported = inboundHandoffDecision({
    assistantEnabled: true,
    handoffEnabled: true,
    providerCapable: false,
    body: { CallSid: "v3:abc" },
  });
  assert.equal(providerUnsupported.reason, INBOUND_BUDGET_REASON.PROVIDER_UNSUPPORTED);
  assert.equal(providerUnsupported.callControlId, null);

  const noCallControlId = inboundHandoffDecision({
    assistantEnabled: true,
    handoffEnabled: true,
    providerCapable: true,
    body: {},
  });
  assert.equal(noCallControlId.reason, INBOUND_BUDGET_REASON.NO_CALL_CONTROL_ID);
  assert.equal(noCallControlId.callControlId, null);
});

test("GQ-P3-3: Reihenfolge-Gate - providerCapable:false + Body MIT CallSid -> provider_unsupported, kein Wert gelesen", () => {
  // Ein fremder Provider-CallSid (Twilio-Form "AC...") wird nie zur call_control_id:
  // die Faehigkeitspruefung laeuft VOR dem Feld-Lesen, nicht danach.
  const decision = inboundHandoffDecision({
    assistantEnabled: true,
    handoffEnabled: true,
    providerCapable: false,
    body: { CallSid: "AC1234567890" },
  });
  assert.equal(decision.path, INBOUND_PATH.BUDGET);
  assert.equal(decision.reason, INBOUND_BUDGET_REASON.PROVIDER_UNSUPPORTED);
  assert.equal(decision.callControlId, null);
});

test("GQ-P3-4: Grenzfaelle des Feldes ueber die Entscheidung - kein Wurf, immer no_call_control_id", () => {
  for (const body of [{ CallSid: "" }, { CallSid: 123 }, null]) {
    const decision = inboundHandoffDecision({
      assistantEnabled: true,
      handoffEnabled: true,
      providerCapable: true,
      body,
    });
    assert.equal(decision.path, INBOUND_PATH.BUDGET);
    assert.equal(decision.reason, INBOUND_BUDGET_REASON.NO_CALL_CONTROL_ID);
  }
});

test("GQ-P3-5: logInboundPathDecision im Erfolgsfall - genau eine Zeile, kein handoff_fallback", async () => {
  const decision = { path: INBOUND_PATH.ASSISTANT, reason: null, callControlId: "v3:abc" };
  const lines = await captureConsole(() =>
    logInboundPathDecision({ callId: "call_a", decision, body: { CallSid: "v3:abc" } }),
  );
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("inbound_path"));
  assert.ok(lines[0].includes('"path":"assistant"'));
  assert.ok(!lines[0].includes("handoff_fallback"));
});

test("GQ-P3-6: logInboundPathDecision - no_call_control_id loggt zwei Zeilen, handoff_disabled genau eine, keine Rufnummer", async () => {
  const noCcBody = { From: "+491701234567", To: "+4915112345678" };
  const noCc = {
    path: INBOUND_PATH.BUDGET,
    reason: INBOUND_BUDGET_REASON.NO_CALL_CONTROL_ID,
    callControlId: null,
  };
  const noCcLines = await captureConsole(() =>
    logInboundPathDecision({ callId: "call_b", decision: noCc, body: noCcBody }),
  );
  assert.equal(noCcLines.length, 2, "inbound_path + handoff_fallback");
  assert.ok(noCcLines[0].includes("inbound_path"));
  assert.ok(noCcLines[1].includes("handoff_fallback"));
  for (const line of noCcLines) assert.ok(!line.includes("+491701234567"), "keine Rufnummer im Log");

  const handoffDisabled = {
    path: INBOUND_PATH.BUDGET,
    reason: INBOUND_BUDGET_REASON.HANDOFF_DISABLED,
    callControlId: null,
  };
  const disabledLines = await captureConsole(() =>
    logInboundPathDecision({ callId: "call_c", decision: handoffDisabled, body: noCcBody }),
  );
  assert.equal(disabledLines.length, 1, "kein Feld-Defekt -> keine zweite Zeile");
  assert.ok(disabledLines[0].includes('"reason":"handoff_disabled"'));
});

test("GQ-P3-7: inboundHandoffProbeLine meldet beide Richtungen woertlich", () => {
  const on = inboundHandoffProbeLine({ inboundHandoffEnabled: true, enabled: true });
  assert.equal(
    on,
    "Inbound-Handoff: AKTIV (TELNYX_INBOUND_HANDOFF_ENABLED=true) - wirkt nur mit TELNYX_AI_ASSISTANT_ENABLED=true und Telnyx als Inbound-Provider",
  );

  const off = inboundHandoffProbeLine({ inboundHandoffEnabled: false, enabled: false });
  assert.equal(
    off,
    "Inbound-Handoff: aus (TELNYX_INBOUND_HANDOFF_ENABLED=false) - wirkt nur mit TELNYX_AI_ASSISTANT_ENABLED=false und Telnyx als Inbound-Provider",
  );
});

// === Ebene B: Spawn am echten Server (zwei Starts) ========================================

test("GQ-P3-8: beide Schalter an -> Assistant-Pfad, inbound_path-Zeile, Boot-Log AKTIV, kein handoff_fallback", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      TELNYX_AI_ASSISTANT_ENABLED: "true",
      ...TELNYX_ASSISTANT_BOOT_ENV,
      // TELNYX_INBOUND_HANDOFF_ENABLED bleibt auf dem BASE_ENV-Default (true)
    },
    seed: seedWithTelnyxNumber(),
  });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "v3:inbound-gqp3" });
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.doesNotMatch(xml, /<Gather/, "kein TeXML-Gather - der Assistant uebernimmt den Leg");

    const call = srv.readStore().calls[0];
    assert.equal(call.callControlId, "v3:inbound-gqp3");
    assert.equal(call.assistantId, "asst_x");
    assert.equal(call.direction, "inbound");

    assert.match(srv.stdout, /\[telnyx-inbound\] inbound_path \{.*"path":"assistant".*\}/);
    assert.match(srv.stdout, /Inbound-Handoff: AKTIV/);
    assert.doesNotMatch(srv.stdout, /\[telnyx-inbound\] handoff_fallback/);
  } finally {
    await srv.stop();
  }
});

test("GQ-P3-9: Inbound-Schalter aus -> Budget-Engine (Bestand), reason=handoff_disabled, Boot-Log aus", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      TELNYX_AI_ASSISTANT_ENABLED: "true",
      TELNYX_INBOUND_HANDOFF_ENABLED: "false",
      ...TELNYX_ASSISTANT_BOOT_ENV,
    },
    seed: seedWithTelnyxNumber(),
  });
  try {
    const res = await postTelnyxIncoming(srv, { callSid: "v3:inbound-gqp3" });
    assert.equal(res.status, 200);
    const xml = await res.text();
    assert.match(xml, /<Gather/, "Budget-Engine (Bestand), Schalter aus");

    const call = srv.readStore().calls[0];
    assert.equal(call.callControlId, null);
    assert.equal(call.assistantId, null);

    assert.match(srv.stdout, /"reason":"handoff_disabled"/);
    assert.match(srv.stdout, /Inbound-Handoff: aus \(TELNYX_INBOUND_HANDOFF_ENABLED=false\)/);
  } finally {
    await srv.stop();
  }
});
