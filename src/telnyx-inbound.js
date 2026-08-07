// Inbound-C-Telnyx (PLAN-TELNYX-AI-ASSISTANT.md, P8): der Anrufer ruft UNS an. Das
// /voice/incoming-Webhook hat Signatur (app.use "/voice", Ed25519 fail-closed), Tenant-
// Resolve (numberRecordByE164) UND das global-Tenant-Budget-Gate BEREITS durchlaufen
// (Befund 8: Inbound hat KEINE Vorab-Reserve -> Answer-Budget-Gate + P6-Max-Dauer-Timer +
// P6-Mid-Call-Token-Kill sind die drei Deckel). Reine DI-Funktion (offline mit Spies
// testbar), Schwester von originateAiAssistantCall.
import { bindAssistantToCall } from "./telnyx-origination.js";

// Telnyx-TeXML-Inbound-Body-Feld mit der call_control_id des Inbound-Legs. GEMESSEN
// (GQ-P3, B-9/O-1), nicht aus der Doku uebernommen: Sonde B protokollierte am echten
// Inbound-Anruf call_mseqcvoh8bcx die vollstaendige Schluesselliste des TeXML-Bodys -
// "CallControlId" kam darin NICHT vor, und lookalikeFields war leer. Telnyx liefert
// CallSid. Gegenprobe, dass der Wert wirklich eine Call-Control-ID ist und nicht nur so
// aussieht: GET /v2/calls/<CallSid> antwortete HTTP 200 mit call_leg_id/call_session_id,
// Format "v3:..." (57 Zeichen) - identisch zur call_control_id eines Outbound-Legs.
// Derselbe Wert fuellt seit jeher call.twilioSid und armiert den Max-Dauer-Timer
// (/voice/incoming): Telnyx bedient mit EINEM Wert die Twilio-kompatible SID UND die
// Call-Control-ID. Fehlt das Feld -> null: der Aufrufer faellt fail-safe auf den
// TeXML-Greeting-Pfad zurueck (byte-identisch), kein kaputter Assistant-Pfad.
const INBOUND_CALL_CONTROL_ID_FIELD = "CallSid";

export function inboundCallControlId(body) {
  const v = body && body[INBOUND_CALL_CONTROL_ID_FIELD];
  return typeof v === "string" && v ? v : null;
}

// ---- GQ-S1 Sonde B (B-9/O-1): Feldname messen statt raten -------------------------
const INBOUND_LOG_PREFIX = "[telnyx-inbound]";
// Was der Betreiber tun soll - eine Fehlerzeile ohne Handlungsanweisung ist nur Laerm.
const HANDOFF_FALLBACK_ACTION =
  "Inbound laeuft auf der Budget-Engine; echten Feldnamen aus bodyKeys ablesen und INBOUND_CALL_CONTROL_ID_FIELD anpassen";

// Namens-Normalform fuer den Aehnlichkeitsvergleich: klein, ohne Trennzeichen
// (CallControlId / call_control_id / call-control-id -> callcontrolid).
function normalizedKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
const CALL_CONTROL_ID_SHAPE = normalizedKey(INBOUND_CALL_CONTROL_ID_FIELD);

// Der Befund zum ausbleibenden Handoff - null, wenn das erwartete Feld da ist (das ist die
// Gegenprobe der Abnahme). Ausschliesslich SCHLUESSELNAMEN, nie Werte: der TeXML-Body
// traegt Rufnummern (Regel 4). Kein Rekursions-Dump, nur die oberste Ebene.
export function inboundHandoffFallbackFinding(body) {
  if (inboundCallControlId(body)) return null;
  const keys = body && typeof body === "object" ? Object.keys(body).sort() : [];
  return {
    expectedField: INBOUND_CALL_CONTROL_ID_FIELD,
    bodyKeys: keys,
    // Mehrzahl bewusst: "der erste Treffer ist der einzige" waere eine Annahme (G26).
    lookalikeFields: keys.filter((k) => normalizedKey(k) === CALL_CONTROL_ID_SHAPE),
  };
}

// Macht den frueher stummen Rueckfall laut (Nebeneffekt im Namen, N7). Kein Befund ->
// keine Zeile: der Erfolgsfall bleibt geraeuschlos.
export function logInboundHandoffFallback({ callId, body }) {
  const finding = inboundHandoffFallbackFinding(body);
  if (!finding) return;
  console.warn(
    `${INBOUND_LOG_PREFIX} handoff_fallback ${JSON.stringify({ callId, ...finding })} -> ${HANDOFF_FALLBACK_ACTION}`,
  );
}

// ---- GQ-P3: welchen Pfad ein Inbound-Leg WIRKLICH gefahren ist ---------------------
// Das Boot-Banner kann diese Frage nicht beantworten - es kennt den Schalter, nicht den
// einzelnen Anruf. Genau diese Luecke hat B-9 wochenlang gedeckt: "Assistant-Pfad: AKTIV"
// im Banner, Budget-Engine an jedem Inbound-Leg. Die Entscheidung wird deshalb BENANNT
// (statt null/Wert) und je Leg protokolliert.
export const INBOUND_PATH = Object.freeze({
  ASSISTANT: "assistant",
  BUDGET: "budget",
});

// Warum die Budget-Engine lief - genau EIN Grund je Anruf, in Pruefreihenfolge.
export const INBOUND_BUDGET_REASON = Object.freeze({
  ASSISTANT_DISABLED: "assistant_disabled",
  HANDOFF_DISABLED: "handoff_disabled",
  PROVIDER_UNSUPPORTED: "provider_unsupported",
  NO_CALL_CONTROL_ID: "no_call_control_id",
});

function budgetEnginePath(reason) {
  return { path: INBOUND_PATH.BUDGET, reason, callControlId: null };
}

/**
 * Die Pfadwahl EINES Inbound-Legs, rein (DI: Schalter und Capability kommen als Booleans
 * herein, kein config-Import) - dieselbe Bedingung, die zuvor inline in /voice/incoming
 * stand, nur mit benanntem Ergebnis. Fuegt KEIN Gate hinzu und ueberspringt keines: der
 * Aufrufer hat Signatur, Tenant-Resolve und Kostendecke bereits durchlaufen.
 *
 * REIHENFOLGE IST SICHERHEIT, nicht Geschmack: der Body wird erst gelesen, wenn der
 * Provider die Faehigkeit UEBERHAUPT hat. Ein fremder Provider-CallSid (Twilio-Form
 * "AC...") ist KEINE call_control_id - wuerde das Feld zuerst gelesen, waere er ab dem
 * Tag, an dem jemand CAPABILITY.AI_ASSISTANT fuer einen zweiten Carrier eintraegt,
 * still eine.
 */
export function inboundHandoffDecision({
  assistantEnabled,
  handoffEnabled,
  providerCapable,
  body,
}) {
  if (!assistantEnabled) return budgetEnginePath(INBOUND_BUDGET_REASON.ASSISTANT_DISABLED);
  if (!handoffEnabled) return budgetEnginePath(INBOUND_BUDGET_REASON.HANDOFF_DISABLED);
  if (!providerCapable) return budgetEnginePath(INBOUND_BUDGET_REASON.PROVIDER_UNSUPPORTED);
  const callControlId = inboundCallControlId(body);
  if (!callControlId) return budgetEnginePath(INBOUND_BUDGET_REASON.NO_CALL_CONTROL_ID);
  return { path: INBOUND_PATH.ASSISTANT, reason: null, callControlId };
}

// Die Turn-Sonde (Nebeneffekt im Namen, N7): GENAU EINE Zeile je Inbound-Leg, IMMER -
// auch im Erfolgsfall. Eine Sonde, die nur den Defekt meldet, ist im Live-Log nicht von
// einem Deploy ohne Sonde zu unterscheiden (dieselbe Begruendung wie die AL-P16-
// Boot-Sonden). PII-frei: callId ist server-generiert, path/reason sind feste Token.
// Im Feldname-Defektfall kommt die laute GQ-S1-Zeile DAZU - zwei Zeilen, zwei Zwecke:
// die Sonde sagt WELCHER Pfad lief, die Forensik sagt WIE der Body wirklich aussah.
export function logInboundPathDecision({ callId, decision, body }) {
  console.log(
    `${INBOUND_LOG_PREFIX} inbound_path ${JSON.stringify({
      callId,
      path: decision.path,
      reason: decision.reason,
    })}`,
  );
  if (decision.reason === INBOUND_BUDGET_REASON.NO_CALL_CONTROL_ID)
    logInboundHandoffFallback({ callId, body });
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
  // GAP-24: der STT-Sprach-Hint haengt an der Sprache DES CALLS, auf jedem Assistant-Pfad -
  // keine neue Sprachquelle, sondern dieselbe wie der Ingest-Pfad (telnyx-call-control-ingest.js
  // #onSpeakEnded, G5). call.language ist auf Inbound-Legs gesetzt: /voice/incoming loest sie
  // ueber store.resolveCallLanguage aus dem Tenant-Kontext auf und uebergibt sie an createCall.
  // Ohne Hint entschiede die GLOBALE Assistant-Config ueber die Transkriptionssprache eines
  // EN-/FR-Tenants (dieselbe Klasse Defekt wie RCA-Wurzel R2).
  // language ist am Port OPTIONAL: laesst sich die Sprache eines Legs ausnahmsweise nicht
  // aufloesen, bleibt das Feld WEG (statt undefined) - der Adapter sendet dann wie bisher
  // KEIN transcription-Feld (Bestandsverhalten, kein halb gefuellter Hint).
  const languageHint = call.language ? { language: call.language } : {};
  await vc.startAssistant({ callControlId, assistantId: call.assistantId, ...languageHint });
}
