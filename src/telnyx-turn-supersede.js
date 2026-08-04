// GQ-P1 (Befund B-1): welcher Shim-Turn eines Calls laeuft gerade, und darf ein Request
// mit vollstaendigerem Text ihn verdraengen? Speichert NUR callId -> {Signal, Praedikat} -
// nie Text, nie Nummern (dieselbe PII-Klasse wie telnyx-turn-probe.js).
//
// KEIN praeemptiver Abbruch: das Signal wird an agentTurn gereicht und dort an der
// SCHLEIFENGRENZE gelesen. Die laufende Modellrunde laeuft aus und wird genau EINMAL
// gebucht - die Kosten-Buchhaltung (completeRound, claude.js) bleibt unberuehrt. Stumm
// wird der Turn nicht durch den Abbruch, sondern durch den Sprech-Draht (Shim).
//
// NEBENLAEUFIGKEIT (P16): die Map wird ausschliesslich synchron mutiert - Node fuehrt
// jeden Handler bis zum naechsten await am Stueck aus. Ein Request kann einen laufenden
// Turn also nur an einer await-Grenze antreffen, nie mitten in dessen Zustandswechsel.

// Warum NICHT verdraengt wurde (G25: benannte Token, die Log-Auswertung greift sie ab).
export const SUPERSEDE_REFUSAL = Object.freeze({
  NO_INFLIGHT: "no_inflight", // kein laufender Turn -> nichts zu verdraengen
  ALREADY_SUPERSEDED: "already_superseded", // schon verdraengt (dritter Zwischenstand)
  ALREADY_SPOKEN: "already_spoken", // Text ist raus - kein Retract-Event, kein Abbruch
});

function refused(reason) {
  return { superseded: false, refusal: reason };
}

export function makeInFlightTurnRegistry() {
  const running = new Map(); // callId -> { controller, hasSpokenText } - NIE Text

  // Meldet den beginnenden Turn als DEN laufenden Turn dieses Calls an. Nebeneffekt im
  // Namen (N7). hasSpokenText MUSS wurf-frei sein: es wird im Riegel-Pfad eines FREMDEN
  // Requests aufgerufen.
  function beginTurn(callId, { hasSpokenText }) {
    const entry = { controller: new AbortController(), hasSpokenText };
    running.set(callId, entry);
    return {
      signal: entry.controller.signal,
      // Nur den EIGENEN Eintrag abmelden. Ein verdraengter Turn endet, NACHDEM sein
      // Verdraenger begonnen hat - ein blindes delete loeschte dessen Eintrag und der
      // naechste Riegel liefe ins Leere.
      endTurn() {
        if (running.get(callId) === entry) running.delete(callId);
      },
    };
  }

  // Der Riegel. Liefert die Entscheidung samt Grund - der Aufrufer loggt sie, er raet nicht.
  function supersedeTurn(callId) {
    const entry = running.get(callId);
    if (!entry) return refused(SUPERSEDE_REFUSAL.NO_INFLIGHT);
    if (entry.controller.signal.aborted) return refused(SUPERSEDE_REFUSAL.ALREADY_SUPERSEDED);
    if (entry.hasSpokenText()) return refused(SUPERSEDE_REFUSAL.ALREADY_SPOKEN);
    entry.controller.abort();
    return { superseded: true, refusal: null };
  }

  return { beginTurn, supersedeTurn };
}
