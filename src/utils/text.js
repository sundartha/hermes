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
