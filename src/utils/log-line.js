// G5/S2: EINE Quelle fuer das wiederkehrende Format strukturierter, PII-/secret-freier
// Log-Zeilen (Prefix + kind + JSON(payload)) - frueher in zwei Modulen dupliziert (G5).
// Reine Formatierung, kein Log-Aufruf: jeder
// Aufrufer behaelt sein eigenes Prefix und entscheidet selbst zwischen console.log/warn/error.
export function formatLogLine(prefix, kind, payload) {
  return `${prefix} ${kind} ${JSON.stringify(payload)}`;
}
