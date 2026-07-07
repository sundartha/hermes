// Call-Control-Event-Ingest (PLAN-TELNYX-AI-ASSISTANT.md, P4.5): signaturgeprueft
// (Ed25519 via /voice-Mount) laeuft hier die event-getriebene Zustandsmaschine.
// answered -> deterministischer Disclosure-Speak-Node (Regel 2); dessen speak.ended
// -> ai_assistant_start (Regel 2, NIE davor); hangup -> Settlement finishCall (Regel 1,
// verhindert Reserve-Leak/gesperrtes Tenant-Budget). Factory+DI wie makeTelnyxLlmShim:
// alle Seiteneffekt-Deps injiziert -> Zustandsmaschine offline mit Spies testbar.
import { parseCallControlEvent, CALL_CONTROL_EVENT } from "./telephony/adapters/telnyx/call-control-events.js";

export function makeCallControlIngest({ store, voiceControl, finishCall, disclosureSentence, localeFor }) {
  // Regel 2: Pflicht-Offenlegung als deterministischer Speak-Node ZUERST.
  async function onAnswered(call, callControlId) {
    store.markAnswered(call.id); // answeredAt -> voiceMinutesOf (Abrechnung), Muster /voice/outbound
    await voiceControl(call.provider).speak({
      callControlId,
      text: disclosureSentence(call), // fest verdrahtet (Regel 2), NIE Modell-Ermessen
      voiceProfile: localeFor(call.language).voiceProfile,
    });
  }
  // Regel 2: ai_assistant_start NUR als Reaktion auf das speak.ended des Disclosure-Nodes.
  async function onSpeakEnded(call, callControlId) {
    if (!call.assistantId) {
      // assistantId persistiert P5 bei der Origination; fehlt sie -> fail-safe skip
      // (kein Crash/Orphan; Disclosure + Settlement sind davon unabhaengig).
      console.warn(`[voice/call-control] speak.ended ohne assistantId (call=${call.id}) -> kein Assistant-Start`);
      return;
    }
    await voiceControl(call.provider).startAssistant({ callControlId, assistantId: call.assistantId });
  }
  // Regel 1: Terminal-Settlement (Ist-Minuten buchen + Reserve freigeben), idempotent
  // ueber billedAt/reserveReleased. Spiegelt den /voice/status-completed-Pfad; finishCall
  // ruft releaseReserve intern. Kein Timer-Handle-Clear noetig (billedAt/status!=active
  // machen ausstehende Max-Dauer-/Reserve-Timer zum No-op, Bestandsmuster).
  async function onHangup(call) {
    if (call.status === "active") store.endCallRecord(call.id, "completed");
    await finishCall(store.getCall(call.id));
  }

  return async function handleCallControlEvent(req, res) {
    res.sendStatus(200); // sofort ack (Telnyx retryt bei non-2xx); Actions/Settlement danach
    try {
      const call = store.getCall(req.query.callId || "");
      if (!call) return; // unbekannter/fremder callId -> still 200, kein Existenz-Leck (Muster /voice/status)
      const { eventType, callControlId } = parseCallControlEvent(req.body);
      if (eventType === CALL_CONTROL_EVENT.ANSWERED) return void (await onAnswered(call, callControlId));
      if (eventType === CALL_CONTROL_EVENT.SPEAK_ENDED) return void (await onSpeakEnded(call, callControlId));
      if (eventType === CALL_CONTROL_EVENT.HANGUP) return void (await onHangup(call));
      // unbekannt/sonstiges -> keine Wirkung (200 bereits gesendet)
    } catch (err) {
      // 200 ist raus; Fehler nur secret-frei loggen (kein Roh-Body/Key), keine unhandled rejection.
      console.error("[voice/call-control]", err.message);
    }
  };
}
