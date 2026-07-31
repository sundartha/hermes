// AL-P7: zerlegt den Token-Strom EINER Modellantwort in sprechbare Saetze. Der Abnehmer
// (Telnyx-Brain-Shim) schreibt jeden Chunk sofort auf die Leitung - dort entsteht der
// Latenzgewinn dieser Phase. Rein bis auf den injizierten onChunk-Aufruf (N7: der
// Nebeneffekt IST der Zweck); kein Store, kein config, kein IO.
import { shapeChunkForSpeech } from "./speech-shape.js";

// Kuerzere "Saetze" werden NICHT abgetrennt: Abkuerzungen ("z. B.") und Ordnungszahlen
// ("Am 3. Januar") tragen dasselbe Satzzeichen und wuerden sonst mitten im Satz einen
// Chunk ausloesen. Der Rest wandert dann in den naechsten Chunk bzw. in flushRemainder.
export const MIN_SENTENCE_CHARS = 12;

// BEWUSST OHNE Laengen-Notbremse: liefert das Modell gar kein Satzzeichen, geht der Text
// wie im Bestand als EIN Chunk raus - nie schlechter als heute. Ein Schnitt an einer
// beliebigen Wortgrenze waere ein hoerbarer Prosodie-Bruch fuer einen Latenzgewinn, den
// unsere kurzen Sprechregel-Saetze ohnehin nicht brauchen.

// Satzende: ein oder mehrere Endzeichen, optional gefolgt von schliessenden Anfuehrungs-/
// Klammerzeichen, mit Whitespace dahinter (der Lookahead bleibt im Restpuffer).
const SENTENCE_END_RE = /[.!?…]+["'»”’)\]]*(?=\s)/g;

// Erstes Nicht-Whitespace-Zeichen hinter der Schnittstelle - null, solange nur Whitespace
// nachgeflossen ist (dann steht noch nicht fest, was folgt).
function firstCharAfterGap(rest) {
  const match = rest.match(/^\s+(\S)/);
  return match ? match[1] : null;
}

// Aufzaehlungs-Marker, die src/speech-shape.js am ZEILENANFANG anders behandelt als
// mitten im Satz ("- " faellt weg, " - " wird zum Komma). Wird genau vor einem solchen
// Zeichen geschnitten, waere das Fragment ein neuer "Zeilenanfang" und der gesprochene
// Text wiche vom geshapten Turn-Text ab. Deshalb schneidet der Chunker dort NICHT -
// der Satz wandert in den naechsten Chunk (nie schlechter als der Bestandspfad).
const LIST_MARKER_CHARS = "-*+";

// Schnittstelle des naechsten vollstaendigen Satzes im Puffer, sonst -1. Rein (N7).
function nextSentenceCut(text) {
  SENTENCE_END_RE.lastIndex = 0;
  for (let match; (match = SENTENCE_END_RE.exec(text)); ) {
    const cut = match.index + match[0].length;
    if (cut < MIN_SENTENCE_CHARS) continue;
    const nextChar = firstCharAfterGap(text.slice(cut));
    if (nextChar === null || LIST_MARKER_CHARS.includes(nextChar)) continue;
    return cut;
  }
  return -1;
}

/**
 * @param {{ onChunk: (text: string) => void }} deps
 * @returns {{
 *   pushText(delta: string): void,   // Stream-Fragment aufnehmen (Sink-Vertrag, llm.js)
 *   toolUseStarted(): void,          // ab hier nur noch puffern (Riegel, Sink-Vertrag)
 *   flushRemainder(): void,          // Rest als letzten Chunk ausgeben
 *   chunkCount(): number,
 *   receivedText(): boolean          // kam ueberhaupt ein Fragment an (Buchungs-Entscheid)
 * }}
 */
export function makeSentenceChunker({ onChunk }) {
  let buffer = "";
  let eager = true; // solange kein Werkzeug-Block begonnen hat, geht jeder Satz sofort raus
  let chunks = 0;
  let received = false;

  // Ein geshaptes Fragment ausgeben. Leeres Ergebnis (reiner Whitespace/Markdown-Rest)
  // erzeugt KEINEN Chunk - ein leerer content-Delta waere Rauschen auf der Leitung.
  //
  // Der Abnehmer haengt die Fragmente ROH aneinander (OpenAI-Delta-Semantik) - die
  // Wortgrenze zwischen zwei Saetzen muss deshalb IM Chunk stehen. shapeChunkForSpeech
  // trimmt jedes Fragment; ab dem zweiten Chunk kommt das Trennzeichen hier zurueck.
  function emit(raw) {
    const shaped = shapeChunkForSpeech(raw);
    if (!shaped) return;
    onChunk(chunks === 0 ? shaped : ` ${shaped}`);
    chunks += 1;
  }

  function drainSentences() {
    for (;;) {
      const cut = nextSentenceCut(buffer);
      if (cut < 0) return;
      emit(buffer.slice(0, cut));
      buffer = buffer.slice(cut);
    }
  }

  return {
    pushText(delta) {
      if (!delta) return;
      received = true;
      buffer += delta;
      if (eager) drainSentences();
    },
    // Defense-in-Depth (der tragende Riegel ist die Armierung in claude.js): sobald ein
    // Werkzeug-Block begonnen hat, wird nur noch GEHALTEN, nicht verworfen - der Rest geht
    // am Rundenende als letzter Chunk raus. So geht nie still Text verloren.
    toolUseStarted() {
      eager = false;
    },
    flushRemainder() {
      const rest = buffer;
      buffer = "";
      emit(rest);
    },
    chunkCount: () => chunks,
    receivedText: () => received,
  };
}
