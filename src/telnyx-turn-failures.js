// GQ-P4 (Befund B-10, Teil A2): wie viele Modell-Turns EINES Calls unmittelbar
// nacheinander gescheitert sind. Am 2026-08-04 lief ein Outbound-Anruf 52 Sekunden mit
// SIEBEN aufeinanderfolgenden "agentTurn fehlgeschlagen" weiter, waehrend der Owner
// sprach und Carrier-Minuten liefen. Dieser Zaehler ist die Grundlage dafuer, statt
// dessen hoerbar und hoeflich zu beenden.
//
// KONSEKUTIV, nicht kumulativ: jeder erfolgreiche Turn setzt zurueck - ein einzelner
// Ausrutscher zwischen zwei guten Turns darf kein Gespraech beenden (Spec A2).
// Gemerkt wird je Call NUR eine Zahl, nie Text - dieselbe PII-Klasse wie
// telnyx-turn-probe.js.

// Wie lange ein Zaehlerstand vorgehalten wird. Ein Call, der einmal scheitert und dann
// auflegt, meldet sich nie wieder ab; ohne Verfall bliebe sein Eintrag fuer immer stehen.
// Deutlich laenger als ein Gespraech, kurz genug gegen unbegrenztes Wachstum.
const FAILURE_RETENTION_MS = 30 * 60_000;

// Fabrik statt Modul-Zustand (P15): der Shim haelt EINE Instanz, jeder Test eine frische -
// Muster wie makeTurnTextProbe / makeInFlightTurnRegistry im selben Aufrufer.
export function makeConsecutiveFailureCounter() {
  const byCall = new Map(); // callId -> { atMs, failures } - NIE Text

  // Bewusst KEIN Intervall-Timer (Muster telnyx-turn-probe.js): die Map waechst
  // ausschliesslich beim Zaehlen, also raeumt das Zaehlen selbst. Eine gemeinsame
  // "ablaufende Call-Map" mit der Sonde waere erst ab dem dritten Nutzer gerechtfertigt -
  // hier sind es vier Zeilen ueber unterschiedlichem Zustand, keine Duplizierung von Logik.
  function dropExpired(nowMs) {
    for (const [callId, seen] of byCall)
      if (nowMs - seen.atMs >= FAILURE_RETENTION_MS) byCall.delete(callId);
  }

  return {
    // Zaehlt EINEN gescheiterten Turn und liefert den neuen Stand der Staffel zurueck.
    // Nebeneffekt steht im Namen (N7). Namenskonvention wie store countNoSpeechTurn (N3).
    countFailedTurn(callId) {
      const nowMs = Date.now();
      dropExpired(nowMs);
      const failures = (byCall.get(callId)?.failures ?? 0) + 1;
      byCall.set(callId, { atMs: nowMs, failures });
      return failures;
    },
    // Ein erfolgreicher Turn - die Staffel beginnt von vorn. Idempotent.
    // Namenskonvention wie store clearNoSpeechStreak.
    clearFailedTurns(callId) {
      byCall.delete(callId);
    },
  };
}
