// Abbildung "Gespraechsergebnis -> MCP-Felder": bindet ein ConversationOutcome
// (src/conversation/conversation-ports.js, geliefert vom neuen Gespraechsfuehrungs-
// Laufwerk) plus den eigenen Anruf-Datensatz auf genau die Felder ab, die der
// MCP-Vertrag (src/mcp-tools.js) heute schon nach aussen traegt. Der Vertrag selbst
// aendert sich NICHT - diese Abbildung ist nur die neue Quelle fuer Felder, die bisher
// aus der eigenen Gespraechsfuehrung kamen und mit dem Anbieterwechsel wegfallen.
//
// Uebernommene Formen (KEINE Neuerfindung, s. Aufgabenstellung):
// - last_transcript_lines: Slice-Groesse LAST_TRANSCRIPT_LINES, importiert aus
//   src/mcp-tools.js (dieselbe Konstante wie pickCallStatus).
// - duration_s: durationS, importiert aus src/mcp-tools.js (dieselbe Umrechnung,
//   dasselbe Feldpaar call.startedAt/call.endedAt).
// - status/objective_achieved: NICHT ueber die importierbaren mcp-tools.js-Formen
//   mapStatus/pickTranscript uebernommen - beide erwarten eine andere Objektform
//   (call.status/answeredAt bzw. eine ganze Call-Record-Sicht mit summary/result),
//   die ConversationOutcome nicht traegt. Nur das jeweilige Muster ist gleich, s.
//   statusFromConnected/objectiveAchievedFromOutcome unten.
// - failure_reason ohne rohen Anbieter-Anhang: failureReasonBase
//   (src/telephony/failure-reason.js)
import { failureReasonBase } from "../telephony/failure-reason.js";
import { LAST_TRANSCRIPT_LINES, durationS } from "../mcp-tools.js";

// Wie pickCallStatus (mcp-tools.js): letzte LAST_TRANSCRIPT_LINES Zeilen im
// Format "<Rolle>: <Text>".
function lastTranscriptLines(transcript, texts) {
  return transcript
    .slice(-LAST_TRANSCRIPT_LINES)
    .map((entry) => `${entry.role === "agent" ? texts.roleAgent : texts.roleCounterparty}: ${entry.text}`);
}

// status kommt NICHT aus dem importierbaren mapStatus (mcp-tools.js): das bildet
// call.status/answeredAt auf dialing|in_progress|... ab, ein Feldpaar, das
// ConversationOutcome nicht hat. Quelle hier ist stattdessen
// conversationOutcome.connected: verbunden -> completed, nie verbunden -> failed. Die
// feinere Klassifikation (no-answer/busy/canceled) traegt failure_reason, nicht status.
function statusFromConnected(connected) {
  return connected ? "completed" : "failed";
}

// Wie pickTranscript (mcp-tools.js) NICHT direkt uebernehmbar: das baut eine ganze
// Call-Record-Sicht (call_id, Fallbacktext, resultCardView-Spread) aus einem Objekt mit
// summary/objectiveAchieved/result - ConversationOutcome traegt davon nichts. Nur das
// dreiwertige Muster ist gleich: unbekannt (null) wird NIE zu false.
function objectiveAchievedFromOutcome(achieved) {
  if (achieved === null) return "unclear";
  return achieved;
}

// failure_reason nur bei !connected, auf den Basis-Token gekappt (failureReasonBase) -
// eine rohe Anbieter-Kennung ("failed:<detail>") reist nie unveraendert nach aussen.
function failureReasonFromOutcome(conversationOutcome) {
  if (conversationOutcome.connected) return null;
  return failureReasonBase(conversationOutcome.neverConnectedReason ?? null);
}

/**
 * Bildet ein ConversationOutcome (Laufwerk-Meldung) plus den eigenen Anruf-Datensatz auf
 * die MCP-Felder ab, die der bestehende Vertrag (get_call_status/get_transcript,
 * src/mcp-tools.js) nach aussen traegt. Rein synchron, kein I/O.
 * @param {import("./conversation-ports.js").ConversationOutcome} conversationOutcome
 * @param {object} call - eigener Anruf-Datensatz (transcript, startedAt, endedAt, result)
 * @param {object} texts - Rollen-Praefixe (roleAgent/roleCounterparty)
 */
export function mapConversationOutcomeToMcpFields(conversationOutcome, call, texts) {
  return {
    status: statusFromConnected(conversationOutcome.connected),
    duration_s: durationS(call),
    last_transcript_lines: lastTranscriptLines(call.transcript, texts),
    failure_reason: failureReasonFromOutcome(conversationOutcome),
    result_summary: conversationOutcome.summary,
    objective_achieved: objectiveAchievedFromOutcome(conversationOutcome.achieved),
    outcome: call.result?.outcome ?? null,
  };
}
