// Zeit-Budget EINES Webhook-Turns (GAP-22). Der Provider kappt einen unbeantworteten
// Voice-Webhook hart (Twilio dokumentiert 15 s; src/config.js nennt denselben Wert im
// llmRequestTimeoutMs-Kommentar). Der bisher in config.js dokumentierte Rechenweg zaehlte
// NUR die LLM-Versuche - weder die Play-TTS-Vorab-Synthese im selben Webhook
// (src/tts/directive-synth.js) noch eine Netzreserve. Beides addiert sich zur selben
// Wanduhr. Reine Funktionen, KEIN config-Import (der Aufrufer reicht die Werte) -
// damit ist die Rechnung ohne Env-Bastelei testbar.

export const PROVIDER_WEBHOOK_HARDCUT_MS = 15000; // externer Vertragswert
export const TURN_NETWORK_RESERVE_MS = 1500; // Express+Render-Roundtrip, TeXML-Render, Store-Schreibvorgang

// src/llm.js verdoppelt die Backoff-Basis pro Versuch (BACKOFF_FACTOR = 2). Dieselbe
// Basis wie dort (G5: die Formel selbst lebt in llm.js, hier nur ihre Summenbildung
// fuer die Budget-Rechnung).
const LLM_BACKOFF_FACTOR = 2;

// Worst-Case eines Turns im LLM-Seam: (Versuche) * Timeout + Summe der Voll-Jitter-
// Backoffs. Die Backoff-Summe ueber r Retries ist base * (2^r - 1), NICHT 2*base (der
// aeltere Kommentar in config.js unterschaetzte sie). Ein Objekt statt vier Argumenten (F1).
export function llmTurnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs }) {
  const attempts = maxRetries + 1;
  const backoffSum = backoffMs * (LLM_BACKOFF_FACTOR ** maxRetries - 1);
  return attempts * requestTimeoutMs + backoffSum;
}

// Gesamtes Turn-Budget inkl. Synthese und Netzreserve.
export function turnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs, synthTimeoutMs }) {
  return (
    llmTurnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs }) +
    synthTimeoutMs +
    TURN_NETWORK_RESERVE_MS
  );
}

// null = Budget haelt; sonst { budgetMs, hardcutMs, overrunMs } fuer Diagnose/Boot-Warnung.
export function turnBudgetOverrun(params) {
  const budgetMs = turnBudgetMs(params);
  if (budgetMs <= PROVIDER_WEBHOOK_HARDCUT_MS) return null;
  return {
    budgetMs,
    hardcutMs: PROVIDER_WEBHOOK_HARDCUT_MS,
    overrunMs: budgetMs - PROVIDER_WEBHOOK_HARDCUT_MS,
  };
}
