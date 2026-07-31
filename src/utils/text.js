// Gemeinsame Text-Hygiene ohne Fachbezug (Muster utils/timer.js: EIN Helfer, zwei
// Aufrufer, statt zweier byte-gleicher Kopien). Rein - kein Store, kein config, kein IO.

// Kappt auf hoechstens maxChars und bevorzugt die letzte Wortgrenze im gekappten Rest.
// Gibt es keine (ein einziges ueberlanges Wort), wird hart geschnitten - das ist der
// bewusste Rueckfall, damit die Kappe IMMER haelt. Kuerzerer Text bleibt unangetastet.
// AL-P14 (G5): dieselbe Regel gilt fuer das gesprochene Anliegen im Erst-Turn
// (claude.js trimGoalForSpeech) UND fuer die Rueckfrage, die an den MCP-Host geht
// (consult/question.js) - zwei Kopien wuerden bei der naechsten Aenderung auseinander
// laufen.
export function clampAtWordBoundary(text, maxChars) {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

// ---------- Zitat-Erkennung ----------
// AL-P10b (reiner Move aus consult/question.js, G5): DIESELBE Regel schuetzt jetzt zwei
// Egress-Pfade - die Rueckfrage an den MCP-Host (consult/question.js) und die Suchanfrage
// an den Such-Anbieter (research/lookup-guard.js). Zwei Kopien wuerden bei der naechsten
// Aenderung auseinander laufen; der Rumpf ist unveraendert.

// Ab wie vielen aufeinanderfolgenden Woertern eine Uebereinstimmung mit dem Transkript als
// woertliches Zitat gilt. Kuerzere Folgen ("koennen Sie mir sagen ob") sind normale
// Sprache und wuerden jede legitime Sachfrage abwuergen.
export const VERBATIM_QUOTE_MIN_WORDS = 6;

// Die EXPLIZITE Zitatform: alles zwischen Anfuehrungszeichen, in allen im Produkt
// vorkommenden Schreibweisen (DE/FR/EN). Erst die Spannen, dann verwaiste Einzelzeichen -
// sonst bliebe bei ungerader Anzahl ein Zitat-Rest stehen.
const QUOTE_CHAR_CLASS = "\"'„“”«»‚‘’";
const QUOTED_SPAN = new RegExp(`[${QUOTE_CHAR_CLASS}][^${QUOTE_CHAR_CLASS}]*[${QUOTE_CHAR_CLASS}]`, "g");
const QUOTE_CHAR = new RegExp(`[${QUOTE_CHAR_CLASS}]`, "g");

export function stripQuotedSpans(text) {
  return text.replace(QUOTED_SPAN, " ").replace(QUOTE_CHAR, " ");
}

// Vergleichsform fuer die Zitat-Suche: Kleinschreibung, ohne Satzzeichen, EIN Leerzeichen
// zwischen den Woertern. Ohne sie wuerde schon ein Komma ein woertliches Zitat verstecken.
export function comparableWords(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// Die IMPLIZITE Zitatform: der Text wiederholt eine lange Wortfolge des Anrufers, ohne
// Anfuehrungszeichen. Verglichen wird gegen die caller-Zeilen des Transkripts - die
// agent-Zeilen sind unsere eigene Rede und duerfen aufgegriffen werden.
export function containsVerbatimQuote(text, transcript) {
  const words = comparableWords(text);
  if (words.length < VERBATIM_QUOTE_MIN_WORDS) return false;
  const callerLines = (Array.isArray(transcript) ? transcript : [])
    .filter((entry) => entry?.role === "caller" && typeof entry.text === "string")
    .map((entry) => comparableWords(entry.text).join(" "));
  if (!callerLines.length) return false;
  for (let i = 0; i + VERBATIM_QUOTE_MIN_WORDS <= words.length; i++) {
    const window = words.slice(i, i + VERBATIM_QUOTE_MIN_WORDS).join(" ");
    if (callerLines.some((line) => line.includes(window))) return true;
  }
  return false;
}
