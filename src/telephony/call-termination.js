// F10 Runde 2 (S1/G5): der EINE Terminierungspfad, den JEDER Beender eines aktiven
// Calls durchlaeuft (Max-Dauer-Cap-Timer UND cancel_call in server.js) - Reihenfolge
// fest: erst persistieren, dann den Provider-Leg auflegen (awaited), ERST DANACH
// billing/summary/SMS anstossen (fire-and-forget). Die umgekehrte Reihenfolge hielte
// den Anruf beim Provider technisch live, waehrend die Buchungskette (echter
// LLM-Roundtrip in summarizeCall ueber src/llm.js, Retry-Budget bis ~12s, danach der
// SMS-Versand) laeuft - Verstoss gegen den harten Max-Dauer-Cap (Absolute Regel 1,
// CLAUDE.md). Reine Ablauf-Orchestrierung: alle I/O-Effekte kommen als bereits
// gebundene Thunks rein (persistEnd/hangUp/bill), keine Abhaengigkeit auf store/
// voiceControl/finishCall aus server.js -> offline ohne Server/Store/Netz unit-
// testbar (Muster sms-summary.js).
//
// hangUp ist optional (null/undefined), wenn (noch) kein Provider-Call-Sid existiert -
// dann wird der Hangup-Versuch uebersprungen, persistiert+gebucht wird trotzdem.
// Ein hangUp-Fehler ist best-effort: onHangUpError entscheidet je Aufrufer, ob/wie
// geloggt wird (Bestandsverhalten bleibt je Aufrufer erhalten - der Cap-Timer schluckt
// bisher still, cancel_call loggt "[cancel]"). bill wird NICHT awaited (fire-and-
// forget): der Aufrufer wartet nicht auf Buchung/Summary/SMS, nur auf den Hangup.
export async function terminateAndBillCall({ persistEnd, hangUp, bill, onHangUpError }) {
  persistEnd();
  if (hangUp) {
    try {
      await hangUp();
    } catch (e) {
      onHangUpError?.(e);
    }
  }
  void bill();
}
