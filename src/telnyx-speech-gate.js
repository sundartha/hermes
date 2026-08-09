// GQ-P18: die Sprechsperre gegen die Doppelantwort auf fragmentierte Spracherkennung.
//
// WARUM SIE DIE HALTEFRIST (GQ-P17) ERSETZT: die hielt den TURN an und addierte ihre Frist
// deshalb auf jede Antwort - live gemessen 4,3 / 8,1 / 10,6 s bis zum gesprochenen Wort,
// vom Owner abgelehnt. Gewartet werden MUSS aber gar nicht vor dem Turn: die gemessenen
// Fragment-Luecken (1,3-5,5 s) sind Sprechpausen eines Menschen, und der Riegel, der ein
// Fragment abfaengt, ist laengst da - GQ-P1 (telnyx-turn-supersede.js) bricht einen
// laufenden Turn ab, SOLANGE ER NICHTS GESPROCHEN HAT. Er gibt nur deshalb auf
// (already_spoken), weil der Streaming-Pfad (AL-P7) sofort das erste Fragment auf die
// Leitung schreibt. Diese Sperre haelt genau dieses Fenster offen: der Turn laeuft sofort
// los, nur das SPRECHEN wartet.
//
// SIE VERZOEGERT NIE EINE ANTWORT. Spaetestens am Turn-Ende leert der Shim den Puffer
// (release aus respond) - ein Turn, der schneller fertig ist als die Frist, wird ueberhaupt
// nicht ausgebremst. Der Preis liegt allein beim ERSTEN WORT eines Turns, der laenger
// dauert als die Frist; die Gesamtantwort kommt unveraendert.
//
// PII: gepuffert wird gesprochener Text - derselbe, der ohne Sperre direkt auf den Draht
// ginge. Er verlaesst dieses Modul nur ueber den Draht oder gar nicht (Verdraengung), wird
// nie geloggt und nie gespeichert. Die Log-Zeile des Shims traegt ausschliesslich den
// Ausgang und Zaehler.
//
// NEBENLAEUFIGKEIT (P16): Puffer und Zustand werden ausschliesslich synchron mutiert - Node
// fuehrt jeden Handler bis zum naechsten await am Stueck aus. Der Timer-Rueckruf und ein
// fremder Request treffen den Puffer also nie mitten in einem Zustandswechsel an.

// Wie die Sperre eines Turns geendet hat (G25: benannte Token, die Log-Auswertung greift
// sie ab).
export const SPEECH_GATE_OUTCOME = Object.freeze({
  OFF: "off", // Frist 0 -> nie gepuffert, Bestandsverhalten
  SILENCED: "silenced", // der Turn wurde verdraengt -> nichts gesprochen (der Gewinn)
  RELEASED: "released", // Frist abgelaufen -> Text floss, sie hat das erste Wort gekostet
  FLUSHED: "flushed", // Turn war vor der Frist fertig -> sie war gratis
});

// Der Sprech-Draht dieses Turns, hinter eine Frist gelegt. signal ist der Abbruch-Riegel des
// Turns (GQ-P1): ist er ausgeloest, spricht dieser Turn nie wieder - weder gepuffertes noch
// neues Fragment. Timer injizierbar (Muster makeConversationWatchdog): Tests fahren die Frist
// deterministisch statt gegen die Wanduhr (P12 Fast/Repeatable).
export function makeSpeechGate({
  wire,
  holdMs,
  signal,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const gated = holdMs > 0;
  const buffered = [];
  let open = !gated; // true = Fragmente gehen direkt raus
  let outcome = gated ? null : SPEECH_GATE_OUTCOME.OFF;
  let timer = gated ? setTimer(() => release(SPEECH_GATE_OUTCOME.RELEASED), holdMs) : null;

  // Ein verdraengter Turn spricht nicht - das ist die eine Bedingung, an der beide Wege
  // (gepuffert und offen) haengen. EINE Quelle (G5) statt einer Pruefung am Draht und einer
  // zweiten am Puffer.
  function silenced() {
    return Boolean(signal?.aborted);
  }

  // Gibt den Puffer frei und schaltet auf Durchreichen. Der Nebeneffekt steht im Namen (N7).
  // Nach dem ersten Aufruf ist der Ausgang festgeschrieben: wer zuerst da war, hat recht -
  // ein spaeterer Turn-Abschluss darf ein "released" nicht zu "flushed" umschreiben.
  function release(reason) {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (open) return;
    open = true;
    // Verdraengt: der gepufferte Text ist genau der, den der Anrufer NICHT hoeren soll.
    if (silenced()) {
      buffered.length = 0;
      outcome = SPEECH_GATE_OUTCOME.SILENCED;
      return;
    }
    outcome = reason;
    for (const text of buffered) wire.writeChunk(text);
    buffered.length = 0;
  }

  return {
    // Ein sprechbares Fragment - gepuffert, solange die Frist laeuft.
    write(text) {
      if (silenced()) return;
      if (open) return void wire.writeChunk(text);
      buffered.push(text);
    },
    // Der Turn ist durch: alles Zurueckgehaltene geht jetzt raus. Genau hier entsteht die
    // Zusage "die Sperre verzoegert nie eine Antwort".
    releaseAtTurnEnd() {
      release(SPEECH_GATE_OUTCOME.FLUSHED);
    },
    // Reine Abfragen (P5), fuer die Log-Zeile des Shims. Solange die Frist laeuft, steht der
    // Ausgang noch nicht fest - dann ist er null.
    outcome: () => outcome,
    bufferedCount: () => buffered.length,
  };
}
