// GQ-S1 Sonde B (Befund B-9/O-1): den bislang stummen TeXML-Gather-Rueckfall LAUT machen,
// wenn Flag+Capability an sind, aber das erwartete Feld fehlt. Ebene (A) reine
// inboundHandoffFallbackFinding/logInboundHandoffFallback-Logik (kein Netz), Ebene (B) der
// Draht im echten Server (ein einziger Spawn, Muster telnyx-p8-inbound.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole } from "./helpers.js";
import {
  inboundHandoffFallbackFinding,
  logInboundHandoffFallback,
} from "../src/telnyx-inbound.js";
import {
  startServer,
  postTelnyxIncoming,
  seedWithTelnyxNumber,
  TELNYX_ASSISTANT_BOOT_ENV,
  waitForLog,
} from "./helpers.js";

// === Ebene A: reine Logik ================================================================

test("GQ-S1-9: Feld vorhanden -> kein Befund, keine Logzeile (Gegenbeispiel der Abnahme)", async () => {
  const body = { CallControlId: "cc_1", From: "+491701234567" };
  assert.equal(inboundHandoffFallbackFinding(body), null);

  const lines = await captureConsole(() => logInboundHandoffFallback({ callId: "call_x", body }));
  assert.equal(lines.length, 0, "Erfolgsfall bleibt geraeuschlos");
});

test("GQ-S1-10: Feld fehlt -> expectedField/bodyKeys/lookalikeFields korrekt, Grenzfaelle robust", () => {
  const finding = inboundHandoffFallbackFinding({
    To: "+4915112345678",
    From: "+491701234567",
    call_control_id: "cc_1",
  });
  assert.equal(finding.expectedField, "CallControlId");
  assert.deepEqual(finding.bodyKeys, ["From", "To", "call_control_id"], "sortiert");
  assert.deepEqual(finding.lookalikeFields, ["call_control_id"]);

  const emptyFinding = inboundHandoffFallbackFinding({});
  assert.deepEqual(emptyFinding.bodyKeys, []);
  assert.deepEqual(emptyFinding.lookalikeFields, []);

  assert.doesNotThrow(() => inboundHandoffFallbackFinding(null));
});

test("GQ-S1-11: die geloggte Zeile traegt keinen einzigen Body-WERT, nur Namen + Handlungsanweisung", async () => {
  const body = { CallSid: "CAtest", From: "+491701234567", To: "+4915112345678" };
  const lines = await captureConsole(() =>
    logInboundHandoffFallback({ callId: "call_probe1", body }),
  );
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.ok(line.includes("handoff_fallback"));
  assert.ok(line.includes("INBOUND_CALL_CONTROL_ID_FIELD"), "muss die Handlungsanweisung tragen");
  assert.ok(!line.includes("+491701234567"), "kein Rufnummern-Wert");
  assert.ok(!line.includes("CAtest"), "kein CallSid-Wert");
});

// === Ebene B: Draht im echten Server (ein Spawn) ========================================

test("GQ-S1-12: Handoff-Erfolg keine Zeile; fehlendes Feld -> laute handoff_fallback-Zeile mit echten Body-Keys", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      TELNYX_AI_ASSISTANT_ENABLED: "true",
      ...TELNYX_ASSISTANT_BOOT_ENV,
    },
    seed: seedWithTelnyxNumber(),
  });
  try {
    const okRes = await postTelnyxIncoming(srv, { callControlId: "cc_inbound_9" });
    assert.equal(okRes.status, 200);
    assert.doesNotMatch(srv.stdout, /\[telnyx-inbound\] handoff_fallback/, "Erfolgsfall bleibt still");

    const fallbackRes = await postTelnyxIncoming(srv); // kein callControlId im Body
    assert.equal(fallbackRes.status, 200);
    const xml = await fallbackRes.text();
    assert.match(xml, /<Gather/, "Rueckfall-Verhalten unveraendert");

    await waitForLog(srv, /\[telnyx-inbound\] handoff_fallback/);
    const match = srv.stdout.match(/\[telnyx-inbound\] handoff_fallback (\{.*?\}) ->/);
    assert.ok(match, "Zeile muss die Befund-Payload tragen");
    const payload = JSON.parse(match[1]);
    assert.equal(payload.expectedField, "CallControlId");
    assert.ok(payload.bodyKeys.includes("CallSid"));
    assert.ok(payload.bodyKeys.includes("From"));
    assert.ok(payload.bodyKeys.includes("To"));
  } finally {
    await srv.stop();
  }
});
