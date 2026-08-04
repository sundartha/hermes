// GQ-S1 Sonde A (Befund B-1): die Herkunft eines Shim-Turns sichtbar machen. Der Shim
// behandelt jeden POST auf /v1/chat/completions als eigenstaendigen Turn; am 04.08. lagen
// turnSeq 1 und 2 desselben Anrufs EINE Millisekunde auseinander. Ob das zwei Sprech-Turns
// der Spracherkennung waren oder EIN doppelt zugestellter Request, ist unbelegt - diese
// Sonde macht die beiden Faelle unterscheidbar. Sie aendert KEIN Verhalten.
//
// Gemerkt wird je Call NUR ein Fingerabdruck des letzten Turn-Textes (Zeichenzahl + Hash),
// nie der Text: "der vorige Text ist ein Praefix des jetzigen" laesst sich pruefen, indem
// das gleich lange Anfangsstueck des AKTUELLEN Textes gehasht und mit dem gemerkten Hash
// verglichen wird. So entsteht kein zweiter PII-Speicher neben dem Transkript im Store.
import { hashText } from "./util.js";

// Verhaeltnis des aktuellen Turn-Textes zum vorherigen desselben Calls (G25: benannte
// Token statt gestreuter Strings - die Log-Auswertung greift genau diese Werte ab).
export const TURN_TEXT_RELATION = Object.freeze({
  FIRST: "first",     // erster Turn dieses Calls, kein Vorgaenger
  SAME: "same",       // identischer Text -> Fingerabdruck einer Doppel-Zustellung
  EXTENDS: "extends", // Vorgaenger ist echtes Praefix -> fortgeschriebene Erkennung
  OTHER: "other",      // unabhaengiger Text -> zwei echte Aeusserungen
});

// Wie lange ein Fingerabdruck vorgehalten wird: deutlich laenger als ein Gespraech (der
// Vergleich muss ueber den ganzen Call tragen), kurz genug, dass beendete Calls den
// Speicher nicht dauerhaft belegen.
const FINGERPRINT_RETENTION_MS = 30 * 60_000;

// Reine Beziehung zweier Fingerabdruecke (2 Argumente, keine Nebeneffekte).
function relationTo(prev, current) {
  if (!prev) return TURN_TEXT_RELATION.FIRST;
  if (prev.chars === current.chars)
    return prev.hash === current.hash ? TURN_TEXT_RELATION.SAME : TURN_TEXT_RELATION.OTHER;
  const prevIsPrefix =
    prev.chars > 0 &&
    prev.chars < current.chars &&
    hashText(current.text.slice(0, prev.chars)) === prev.hash;
  return prevIsPrefix ? TURN_TEXT_RELATION.EXTENDS : TURN_TEXT_RELATION.OTHER;
}

// Fabrik statt Modul-Zustand (P4/P15: der Shim haelt EINE Instanz, jeder Test bekommt eine
// frische). Der zurueckgegebene Aufruf MERKT SICH den Turn - der Nebeneffekt steht im
// Namen (N7).
export function makeTurnTextProbe() {
  const lastByCall = new Map(); // callId -> { atMs, chars, hash } - NIE Text

  // Abgelaufene Eintraege beim naechsten Turn raeumen. Bewusst KEIN Intervall-Timer: ein
  // zweiter unref-Sweep neben dem Rate-Limiter waere Zeremonie fuer eine Map, die
  // ausschliesslich bei einem Turn waechst.
  function dropExpired(nowMs) {
    for (const [callId, seen] of lastByCall)
      if (nowMs - seen.atMs >= FINGERPRINT_RETENTION_MS) lastByCall.delete(callId);
  }

  return function observeTurnText(callId, text) {
    const nowMs = Date.now();
    dropExpired(nowMs);
    // Fail-safe gegen jede Eingabeform (G3): kein String -> leerer Text, kein Wurf.
    const safeText = typeof text === "string" ? text : "";
    const current = { text: safeText, chars: safeText.length, hash: hashText(safeText) };
    const prev = lastByCall.get(callId);
    lastByCall.set(callId, { atMs: nowMs, chars: current.chars, hash: current.hash });
    return {
      atMs: nowMs,
      gapMs: prev ? nowMs - prev.atMs : null,
      chars: current.chars,
      textHash: current.hash,
      prevRelation: relationTo(prev, current),
    };
  };
}
