// C-Telnyx-Origination (PLAN-TELNYX-AI-ASSISTANT.md, P5): Call-Control-Originate HINTER
// der kompletten Outbound-Gate-Kette (Aufrufer server.js /api/calls, KEIN zweiter Einstieg,
// Regel 1). Reine DI-Funktion: offline mit Spies testbar (exakte webhookUrl + Token-Mint
// + Persistenz), ohne server.js zu importieren. KEIN Max-Dauer-Timer hier (P6 verdrahtet
// ihn callControlId-korrekt); der provider-seitige time_limit_secs-Cap (voice.js) UND der
// Reserve-Backstop (armReserveReleaseTimer, Aufrufer) greifen daneben.
import { randomBytes } from "node:crypto";

// 256-Bit per-Call-Bearer-Secret. Groesser als das streamToken-Geheimnis (128 Bit): dieser
// Bearer wird von Telnyx an einen internet-erreichbaren Endpunkt (Shim) gereicht (Regel 3).
const AI_ASSISTANT_TOKEN_BYTES = 32;

// Regel 3 / G5: EINE Quelle fuer den per-Call-Bearer-Mint + assistantId-Bindung, geteilt von
// Outbound-Origination (hier) UND Inbound-Answer (telnyx-inbound.js). Mutiert den LEBENDEN
// Call; der Aufrufer persistiert nach dem Origination-/Answer-Schritt (store.save). Bearer:
// per-Call-Secret (Krypto-Zufall), an genau diesen callId gebunden, NIE geloggt/projiziert
// (publicCall strippt es); der Shim validiert gegen call.aiAssistantToken. assistantId aus
// P7-Provisioning (leer -> P4.5 onSpeakEnded/startAssistant fail-safe, nicht-secret).
export function bindAssistantToCall(call, config) {
  call.aiAssistantToken = randomBytes(AI_ASSISTANT_TOKEN_BYTES).toString("hex");
  call.assistantId = config.telnyxAssistantId;
}

export async function originateAiAssistantCall({ store, voiceControl, config, call, fromNumber, to, maxDur }) {
  bindAssistantToCall(call, config);
  const { callControlId } = await voiceControl(call.provider).originateViaCallControl({
    from: fromNumber,
    to,
    webhookUrl: `${config.publicUrl}/voice/call-control?callId=${call.id}`,
    method: "POST",
    timeLimit: maxDur,
  });
  // callControlId als EIGENES Feld (P6-Boot-Recovery adressiert den Hangup ueber diese
  // ID-Form, NICHT twilioSid).
  call.callControlId = callControlId;
  store.save();
}
