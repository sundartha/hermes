// FW2: prozessweiter Vermerk "dieser Anbieter ist zahlungsblockiert". Import-freies
// Blatt (kein config, kein Log) - die Uhr kommt als Argument herein, Muster Circuit-
// Breaker in src/llm.js (makeBreaker(..., Date.now)): rein und ohne echte Zeit testbar.
// KEIN zweiter Ausfallmechanismus neben dem Breaker: der Breaker gehoert den transienten
// Fehlern, dieser Latch ausschliesslich dem Guthaben-Fall (getrennte Anlaesse, kein
// gemeinsamer Zustand).
const blockedUntilMs = new Map(); // providerId -> Zeitpunkt, ab dem der Vermerk faellt

// Setzt den Vermerk, liefert OB er vorher schon stand. Kommando-mit-Auskunft (Muster
// breaker.isOpen() im Bestand): die Information "war vorher schon gesperrt" existiert
// nur hier, und genau sie entscheidet, ob eine Wechsel-Zeile geschrieben wird (genau
// einmal je Latch-Setzung, Spec FW2-B).
// @returns {boolean} true = der Vermerk war vorher NICHT gesetzt (frisch gelatcht)
export function markBillingBlocked({ provider, nowMs, cooldownMs }) {
  const warBlockiert = billingBlocked({ provider, nowMs });
  blockedUntilMs.set(provider, nowMs + cooldownMs);
  return !warBlockiert;
}

export function billingBlocked({ provider, nowMs }) {
  return nowMs < (blockedUntilMs.get(provider) ?? 0);
}
