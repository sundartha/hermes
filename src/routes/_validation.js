// Eingabe-Validierung fuer API-Routen (T4 Phase 2 — enabling refactor).
//
// Reine Konstanten/Funktionen ohne Netz-/config-Deps, aus src/server.js an ihren
// T4-Zielort verschoben (siehe docs/strategy/t4-server-decomposition.md §3.2 Klasse C).
// invalidText/TEXT_LIMITS leben lokal; E164 wird seit F2 aus store/defaults.js
// re-exportiert (reines Konstanten-Modul, keine Store-State-/Netz-Last zur Laufzeit).
// Von ZWEI API-Routen geteilt (/api/calls via E164+invalidText, /api/calendar via
// invalidText) -> eigenes Mini-Modul, von beiden importiert (G5: eine Quelle, kein
// Copy-Paste). Verhaltens-erhaltend: byte-identisch zur bisherigen server.js-Definition.

// E.164-Format: '+' gefolgt von 7-15 Ziffern, erste Ziffer != 0. Kanonisch in
// store/defaults.js neben normNum (EINE Quelle, G5 - F2 brauchte denselben Regex im
// private-number-Setter; statt einer zweiten Kopie re-exportieren wir hier). Die
// bestehenden Konsumenten (server.js /api/calls) importieren E164 unveraendert von hier.
export { E164 } from "../store/defaults.js";
export const TEXT_LIMITS = { objective: 500, briefing: 2000, constraints: 2000, title: 200 };

// Fehlertext oder null; optionale Felder (null/undefined) sind erlaubt
export function invalidText(name, value) {
  if (value == null) return null;
  if (typeof value !== "string") return `${name} muss ein String sein`;
  if (value.length > TEXT_LIMITS[name]) return `${name} ist zu lang (max. ${TEXT_LIMITS[name]} Zeichen)`;
  return null;
}
