// Inbound-C-Telnyx (PLAN-TELNYX-AI-ASSISTANT.md, P8): der Anrufer ruft UNS an. Das
// /voice/incoming-Webhook hat Signatur (app.use "/voice", Ed25519 fail-closed), Tenant-
// Resolve (numberRecordByE164) UND das global-Tenant-Budget-Gate BEREITS durchlaufen
// (Befund 8: Inbound hat KEINE Vorab-Reserve -> Answer-Budget-Gate + P6-Max-Dauer-Timer +
// P6-Mid-Call-Token-Kill sind die drei Deckel). Reine DI-Funktion (offline mit Spies
// testbar), Schwester von originateAiAssistantCall.
import { bindAssistantToCall } from "./telnyx-origination.js";

// Telnyx-TeXML-Inbound-Body-Feld mit der call_control_id des Inbound-Legs. Doku-Stand,
// live unbestaetigt (wie der ganze P4-Adapter) - mit dem Owner in P0/P11 fixen. Fehlt es
// -> null: der Aufrufer faellt fail-safe auf den bestehenden TeXML-Greeting-Pfad zurueck
// (byte-identisch), kein kaputter Assistant-Pfad.
const INBOUND_CALL_CONTROL_ID_FIELD = "CallControlId";

export function inboundCallControlId(body) {
  const v = body && body[INBOUND_CALL_CONTROL_ID_FIELD];
  return typeof v === "string" && v ? v : null;
}

// Startet den AI-Assistant fuer einen Inbound-Leg: (1) assistantId + callControlId binden,
// persistieren (eigenes Feld -> P6-Boot-Recovery adressiert den Hangup hierueber);
// (2) deterministisches Greeting als Call-Control-Speak-Node (Regel 2, nie Modell-
// Ermessen), Owner-Name schon eingesetzt vom Aufrufer; (3) ai_assistant_start (Regel 3,
// Shim authentifiziert per statischem Shared-Secret, korreliert ueber call_control_id).
// Greeting VOR Start (await) - die Assistant-eigene Greeting ist P7-deaktiviert, die KI
// schweigt bis zum ersten Anrufer-Turn, also kein Ueberlagern (Regel 2).
export async function startInboundAiAssistant({
  store,
  voiceControl,
  config,
  call,
  callControlId,
  greeting,
  voiceProfile,
}) {
  bindAssistantToCall(call, config);
  call.callControlId = callControlId;
  store.save();
  const vc = voiceControl(call.provider);
  await vc.speak({ callControlId, text: greeting, voiceProfile });
  // afix-p2 (R2): STT-Sprach-Hint pro Call reicht auch der Inbound-Pfad durch - call.language
  // ist an dieser Stelle bereits aufgeloest (store.resolveCallLanguage, server.js, VOR dem
  // Handoff-Aufruf). Derselbe Defekt (STT ohne Hint = "multi" -> Kauderwelsch) ist hier genauso
  // erreichbar wie im Ingest-Pfad (telnyx-call-control-ingest.js) - beide reichen ihn durch.
  await vc.startAssistant({ callControlId, assistantId: call.assistantId, language: call.language });
}
