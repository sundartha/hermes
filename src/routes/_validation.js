// Eingabe-Validierung fuer API-Routen (T4 Phase 2 — enabling refactor).
//
// Reine Konstanten/Funktionen ohne store/config/Netz-Deps, aus src/server.js an ihren
// T4-Zielort verschoben (siehe docs/strategy/t4-server-decomposition.md §3.2 Klasse C).
// Von ZWEI API-Routen geteilt (/api/calls via E164+invalidText, /api/calendar via
// invalidText) -> eigenes Mini-Modul, von beiden importiert (G5: eine Quelle, kein
// Copy-Paste). Verhaltens-erhaltend: byte-identisch zur bisherigen server.js-Definition.

// E.164-Format: '+' gefolgt von 7-15 Ziffern, erste Ziffer != 0.
export const E164 = /^\+[1-9]\d{6,14}$/;
export const TEXT_LIMITS = { objective: 500, briefing: 2000, constraints: 2000, caller_name: 100, title: 200 };

// Fehlertext oder null; optionale Felder (null/undefined) sind erlaubt
export function invalidText(name, value) {
  if (value == null) return null;
  if (typeof value !== "string") return `${name} muss ein String sein`;
  if (value.length > TEXT_LIMITS[name]) return `${name} ist zu lang (max. ${TEXT_LIMITS[name]} Zeichen)`;
  return null;
}
