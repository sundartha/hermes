// GQ-P17: die Haltefrist gegen die fragmentierte Spracherkennung. Speichert je Call NUR
// den Freigeber des gehaltenen Turns - nie Text, nie Nummern (dieselbe PII-Klasse wie
// telnyx-turn-probe.js / telnyx-turn-supersede.js).
//
// WARUM HIER UND NICHT IM VERDRAENGUNGS-RIEGEL (telnyx-turn-supersede.js): der deckt den
// Zustand "der Vorgaenger-Turn LAEUFT schon" und muss dort aufgeben, sobald Text auf der
// Leitung war (already_spoken) - live der Regelfall, weil das Denk-Signal sofort spricht
// und die Recherche laengst gefeuert hat. Diese Frist deckt den Zustand DAVOR: der
// Vorgaenger hat noch nichts getan und kann folgenlos schweigen. Zwei Zustaende, zwei
// Riegel, keine gemeinsame Logik zum Teilen.
//
// NEBENLAEUFIGKEIT (P16): die Map wird ausschliesslich synchron mutiert; Node fuehrt jeden
// Handler bis zum naechsten await am Stueck aus. Ein Request trifft einen gehaltenen Turn
// also nie mitten in dessen Zustandswechsel an.

// Wie eine Frist geendet hat (G25: benannte Token, die Log-Auswertung greift sie ab).
export const TURN_HOLD_OUTCOME = Object.freeze({
  OFF: "off", // Frist 0 -> gar nicht gehalten (Bestandsverhalten)
  ELAPSED: "elapsed", // ausgewartet, kein Nachfolger -> der Turn faehrt
  EXTENDED: "extended", // ein fortschreibender Request kam -> dieser Turn schweigt
});

// Timer injizierbar (Muster makeConversationWatchdog): Tests fahren die Frist
// deterministisch statt gegen die Wanduhr (P12 Fast/Repeatable).
export function makeTurnHoldRegistry({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const held = new Map(); // callId -> entry - NIE Text

  // Haelt den Turn dieses Calls zurueck, bis die Frist ablaeuft oder ein fortschreibender
  // Request ihn ueberholt. Nebeneffekt (Eintrag in der Registry) im Namen (N7).
  async function holdTurn(callId, holdMs) {
    if (!(holdMs > 0)) return TURN_HOLD_OUTCOME.OFF; // kein Timer, kein Eintrag
    return await new Promise((resolve) => {
      const entry = {
        timer: null,
        release(outcome) {
          clearTimer(entry.timer);
          // Nur den EIGENEN Eintrag loeschen (Muster endTurn, GQ-P1): ein abgelaufener
          // Halter darf den Eintrag eines spaeteren nicht mitreissen.
          if (held.get(callId) === entry) held.delete(callId);
          resolve(outcome);
        },
      };
      entry.timer = setTimer(() => entry.release(TURN_HOLD_OUTCOME.ELAPSED), holdMs);
      held.set(callId, entry);
    });
  }

  // Der Riegel: ein fortschreibender Request ueberholt den gehaltenen Turn.
  // true = es gab einen, er schweigt jetzt.
  function supersedeHeldTurn(callId) {
    const entry = held.get(callId);
    if (!entry) return false;
    entry.release(TURN_HOLD_OUTCOME.EXTENDED);
    return true;
  }

  // Reine Abfrage, KEIN Nebeneffekt (P5 Command-Query-Trennung): haelt dieser Call gerade
  // einen Turn? Der Shim braucht die Antwort VOR seinen Gates, ueberholen darf er aber
  // erst DANACH.
  function hasHeldTurn(callId) {
    return held.has(callId);
  }

  return { holdTurn, supersedeHeldTurn, hasHeldTurn };
}
