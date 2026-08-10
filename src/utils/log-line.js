// G5/S2: EINE Quelle fuer das wiederkehrende Format strukturierter, PII-/secret-freier
// Log-Zeilen (Prefix + kind + JSON(payload)) - bisher in telnyx-conversation-watchdog.js
// und telnyx-llm-shim.js unabhaengig dupliziert. Reine Formatierung, kein Log-Aufruf: jeder
// Aufrufer behaelt sein eigenes Prefix und entscheidet selbst zwischen console.log/warn/error.
export function formatLogLine(prefix, kind, payload) {
  return `${prefix} ${kind} ${JSON.stringify(payload)}`;
}
