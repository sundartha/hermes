// Phase telnyx-p9 (PLAN-TELNYX-AI-ASSISTANT.md P9): ORTHOGONALITAETS-MATRIX.
// Pinnt Flag x Provider -> Pfad ueber ALLE DREI Origination-Oberflaechen
// (Outbound /api/calls, Inbound /voice/incoming, Shim /v1/chat/completions) auf
// EINEM laufenden Server je Flag-Zustand. Assertiert bewusst NUR den groben Pfad-
// Diskriminator; die per-Oberflaeche-TIEFE (exakte URL/Token/Budget/Billing) ist
// Eigentum von telnyx-p5-origination / telnyx-p8-inbound / telnyx-shim-route.
// Der Befund-1-Boot-Re-Arm/hangUp-ID-Beweis (callControlId gewinnt, endCall NIE)
// ist Eigentum von telnyx-p6-cap-callcontrol (T1/T2/T5) + telnyx-p6-boot-rearm
// (R1/R2, beide flag-aus zur Boot-Zeit) - hier nur per Quelltext-Wiring-Guard
// gegen Drift gesichert. Netto-neu: die Orthogonalitaets-Zelle flag-an + NICHT-
// Telnyx -> Bestand (Outbound; die Inbound-Zelle entfiel mit C-P3). Spawn/Fake, kein Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startServer,
  placeCall,
  postTelnyxIncoming,
  seedWithTelnyxNumber,
  TELNYX_TEST_OWNER_NUMBER,
  TELNYX_ASSISTANT_BOOT_ENV,
} from "./helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_NOT_FOUND = 404; // Flag aus -> Shim existiert nicht
const HTTP_FORBIDDEN = 403; // Flag an, kein per-Call-Token -> Shim erreichbar, fail-closed
const SHIM_ROUTE = "/v1/chat/completions";

// --- Oberflaechen-Helper, die NUR diese Datei braucht (Rohstoffe/POST-Primitive
// teilt test/helpers.js: placeCall, postTelnyxIncoming, seedWithTelnyxNumber, G5) ---

function outboundCall(srv, callId) {
  return srv.readStore().calls.find((c) => c.id === callId);
}

async function probeShim(srv) {
  const res = await fetch(`${srv.localUrl}${SHIM_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return res.status;
}

test("Flag AUS + Telnyx: Outbound=TeXML, Inbound=Gather, Shim=404 (Bestand, byte-identisch)", async () => {
  const srv = await startServer({
    env: { FAKE_ORIGINATE: "true" }, // TELNYX_AI_ASSISTANT_ENABLED bleibt BASE_ENV-Default (false)
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
    seed: seedWithTelnyxNumber(),
  });
  try {
    const { callId } = await (await placeCall(srv)).json();
    const c = outboundCall(srv, callId);
    assert.match(c.twilioSid, /^fake_/, "TeXML-Fake-Praefix (nicht fake_cc_)");
    assert.doesNotMatch(c.twilioSid, /^fake_cc_/);
    assert.equal(c.callControlId, null);

    const xml = await (await postTelnyxIncoming(srv, { callSid: "cc_x" })).text();
    assert.match(xml, /<Gather/, "Bestand-Inbound (Flag aus)");

    assert.equal(await probeShim(srv), HTTP_NOT_FOUND, "Shim dunkel");
  } finally {
    await srv.stop();
  }
});

test("Flag AN + Telnyx: Outbound=Call-Control, Inbound(Telnyx)=Handoff, Shim=403", async () => {
  const srv = await startServer({
    env: {
      FAKE_ORIGINATE: "true",
      TELNYX_AI_ASSISTANT_ENABLED: "true",
      ...TELNYX_ASSISTANT_BOOT_ENV,
    },
    ownerNumber: TELNYX_TEST_OWNER_NUMBER,
    seed: seedWithTelnyxNumber(),
  });
  try {
    const { callId } = await (await placeCall(srv)).json();
    const c = outboundCall(srv, callId);
    assert.match(
      c.callControlId,
      /^fake_cc_/,
      "Call-Control-Praefix beweist den Call-Control-Pfad",
    );
    assert.equal(c.twilioSid, null);

    const handoff = await (await postTelnyxIncoming(srv, { callSid: "cc_in" })).text();
    assert.doesNotMatch(handoff, /<Gather/, "Assistant uebernimmt den Leg (kein TeXML-Gather)");

    assert.equal(
      await probeShim(srv),
      HTTP_FORBIDDEN,
      "Shim erreichbar (fail-closed, kein per-Call-Token)",
    );
  } finally {
    await srv.stop();
  }
});

// C-P4: hier stand die Zelle "Flag AN + NICHT-Telnyx (Twilio-Owner) -> Outbound faellt auf
// TeXML zurueck". Ihre Aussage war die ORTHOGONALITAET von Flag und Anbieter: das Flag
// allein entscheidet nicht, der Provider auch. Mit genau EINEM Anbieter gibt es zwischen
// beiden keine Orthogonalitaet mehr - die Zelle hat keinen Gegenstand und ist entfallen,
// nicht "gruen gemacht". Die verbleibenden Zellen (Flag AUS -> TeXML, Flag AN + Telnyx ->
// Call-Control) tragen die Flag-Achse unveraendert. TWILIO_TEST_OWNER_NUMBER
// (test/helpers.js, C-P2) war die Fixture NUR dieser Zelle und ist mit ihr gefallen.

// ---- Regressions-Lock (Quelltext-Wiring, Muster T6/T8 telnyx-p6-cap-callcontrol) ----
// Kein Klon der P6-Runtime-Tests: sichert nur, dass rearmActiveCallTimers die
// Hangup-Endpunktwahl weiterhin an hangUpAction delegiert (Befund 1) statt sie
// inline nach voiceEngine zu verzweigen.
// P5 (Server-Slim): rearmActiveCallTimers wanderte nach telephony/call-lifecycle.js.
const lifecycleSrc = fs.readFileSync(path.join(ROOT, "src", "telephony", "call-lifecycle.js"), "utf8");

test("Wiring: rearmActiveCallTimers terminalisiert C-Telnyx ausschliesslich ueber terminateCappedCall/scheduleMaxDurationEnd (kein direkter voiceEngine-getriebener endCall)", () => {
  const marker = "function rearmActiveCallTimers()";
  const block = lifecycleSrc.slice(lifecycleSrc.indexOf(marker), lifecycleSrc.indexOf(marker) + 1200);
  // Der realtime-Guard bleibt (Budget-only), aber KEIN C-Telnyx-Sonderpfad ueber voiceEngine:
  // (P8: "realtime"-Literal -> VOICE_ENGINE.REALTIME-Konstante, G25 - Regex mitgezogen;
  // PA-16: config.voiceEngine -> config.voice.voiceEngine-Zugriffspfad, Regex mitgezogen)
  assert.match(block, /config\.voice\.voiceEngine === VOICE_ENGINE\.REALTIME\) return/);
  assert.match(block, /terminateCappedCall\(call\.id, call\.twilioSid/);
  assert.match(block, /scheduleMaxDurationEnd\(call, call\.twilioSid/);
  assert.doesNotMatch(
    block,
    /endCallViaCallControl|\.endCall\(/,
    "Hangup-Endpunktwahl bleibt in hangUpAction (Befund 1), NIE inline in rearm",
  );
});
