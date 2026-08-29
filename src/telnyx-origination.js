// C-Telnyx-Origination (PLAN-TELNYX-AI-ASSISTANT.md, P5): Call-Control-Originate HINTER
// der kompletten Outbound-Gate-Kette (Aufrufer server.js /api/calls, KEIN zweiter Einstieg,
// Regel 1). Reine DI-Funktion: offline mit Spies testbar (exakte webhookUrl + Persistenz),
// ohne server.js zu importieren. KEIN Max-Dauer-Timer hier (P6 verdrahtet ihn callControlId-
// korrekt); der provider-seitige time_limit_secs-Cap (voice.js) UND der Reserve-Backstop
// (armReserveReleaseTimer, Aufrufer) greifen daneben.
import { FROM_SOURCE } from "./store/state-ops.js";

// Regel 3 / G5: EINE Quelle fuer die assistantId-Bindung, geteilt von Outbound-Origination
// (hier) UND Inbound-Answer (telnyx-inbound.js). Mutiert den LEBENDEN Call; der Aufrufer
// persistiert nach dem Origination-/Answer-Schritt (store.save). assistantId aus
// P7-Provisioning (leer -> P4.5 onSpeakEnded/startAssistant fail-safe, nicht-secret). Der
// Shim authentifiziert per statischem Shared-Secret (E2), nicht mehr per-Call.
export function bindAssistantToCall(call, config) {
  call.assistantId = config.telnyx.telnyxAssistant.assistantId;
}

export async function originateAiAssistantCall({ store, voiceControl, config, call, fromNumber, to, maxDur }) {
  bindAssistantToCall(call, config);
  const { callControlId } = await voiceControl(call.provider).originateViaCallControl({
    from: fromNumber,
    to,
    webhookUrl: `${config.server.publicUrl}/voice/call-control?callId=${call.id}`,
    method: "POST",
    timeLimit: maxDur,
  });
  // callControlId als EIGENES Feld (P6-Boot-Recovery adressiert den Hangup ueber diese
  // ID-Form, NICHT twilioSid).
  call.callControlId = callControlId;
  // OUTBOUND-E5 (F3): auf diesem Weg reist die Absendernummer als Port-Parameter
  // (telephony/ports.js:127) unveraendert in das Provider-Feld, und die benutzte
  // Call-Control-Connection traegt keinen ani_override - der gesendete Absender IST
  // fromNumber. Deshalb ist "tenant_did" hier ein Struktur-Beleg, keine Behauptung.
  store.recordActualSender(call.id, { e164: fromNumber, source: FROM_SOURCE.TENANT_DID });
  store.save();
}
