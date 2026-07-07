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

export async function originateAiAssistantCall({ store, voiceControl, config, call, fromNumber, to, maxDur }) {
  // Regel 3: per-Call-Secret (Krypto-Zufall), an genau diesen callId gebunden. NIE geloggt,
  // NIE in publicCall/Portal-Projektion. Der Shim validiert es gegen call.aiAssistantToken.
  call.aiAssistantToken = randomBytes(AI_ASSISTANT_TOKEN_BYTES).toString("hex");
  // In P7 provisionierter Assistant (leer -> P4.5 onSpeakEnded skippt fail-safe). Nicht-secret.
  call.assistantId = config.telnyxAssistantId;
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
