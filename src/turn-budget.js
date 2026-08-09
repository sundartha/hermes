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

// Alles, was im selben Webhook NEBEN den llm.complete-Ketten liegt: Play-TTS-Vorab-
// Synthese + Netzreserve. EINE Quelle (G5) - sonst rechnen turnBudgetMs,
// turnLoopDeadlineMs und enforcedTurnWorstCaseMs dreimal dieselbe Summe.
function turnOverheadMs(synthTimeoutMs) {
  return synthTimeoutMs + TURN_NETWORK_RESERVE_MS;
}

// Gesamtes Turn-Budget EINER llm.complete-Kette inkl. Synthese und Netzreserve.
export function turnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs, synthTimeoutMs }) {
  return llmTurnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs }) + turnOverheadMs(synthTimeoutMs);
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

// AL-P6: so viele llm.complete-Ketten faehrt der Tool-Loop in agentTurn hoechstens pro
// Turn. Hier statt als Literal in claude.js (G25), weil BEIDE Seiten dieselbe Zahl
// brauchen: die Schleife selbst und die Worst-Case-Rechnung des Boot-Waechters. Bewusst
// KEIN Env-Knopf - die Rundenzahl ist eine Kosten-/Latenz-Invariante, kein Betriebswert.
export const MAX_TOOL_ROUNDS_PER_TURN = 4;

// Wanduhr-Frist des Tool-Loops EINES Turns: was vom Provider-Hardcut uebrig bleibt, wenn
// Synthese und Netzreserve desselben Webhooks abgezogen sind. ABGELEITET, kein eigener
// Env-Wert. Nie negativ: eine absurd grosse Synthese-Frist ergibt 0 - dann laeuft nur die
// erste Runde (der Aufrufer faehrt sie immer). Fuer den Shim-Pfad ist der Abzug der
// Synthese-Frist konservativ (dort synthetisiert der Vendor) - konservativ heisst hier
// kuerzer, also fail-safe.
export function turnLoopDeadlineMs(synthTimeoutMs) {
  return Math.max(0, PROVIDER_WEBHOOK_HARDCUT_MS - turnOverheadMs(synthTimeoutMs));
}

// Darf noch eine weitere Schleifenrunde starten? Massstab ist EIN llm.complete-VERSUCH
// (requestTimeoutMs), nicht die ganze Retry-Kette: eine Runde, die nicht einmal ihren
// ersten Versuch im Fenster abschliessen kann, ist sicher zu spaet. Die volle Kette als
// Massstab wuerde bei ausgelieferten Werten praktisch JEDE zweite Runde verbieten und
// damit das Gespraechsverhalten aendern - das ist NICHT Gegenstand dieser Phase.
export function roundFitsDeadline({ elapsedMs, deadlineMs, requestTimeoutMs }) {
  return elapsedMs + requestTimeoutMs <= deadlineMs;
}

// Was ein Turn MIT greifender Frist im schlechtesten Fall wirklich braucht: die letzte
// zugelassene Runde startet spaetestens bei (Frist - ein Versuch) und faehrt danach ihre
// volle Retry-Kette; mehr als MAX_TOOL_ROUNDS_PER_TURN Ketten gibt es ohnehin nie. Ohne
// die Frist waere es schlicht Runden * Kette (mit Defaults 48 500 ms) - genau die Zahl,
// die den Dead-Air-Watchdog reisst.
// GQ-P18: die Shim-Frist taucht hier NICHT mehr auf. Bis GQ-P17 hielt sie den Turn an und
// addierte sich auf dieselbe Wanduhr; die Sprechsperre (telnyx-speech-gate.js) haelt nur
// noch das SPRECHEN zurueck und laesst den Turn unveraendert schnell laufen - ein Aufschlag
// hier waere seit dem Umbau eine Luege ueber die Turn-Dauer.
export function enforcedTurnWorstCaseMs({
  requestTimeoutMs,
  maxRetries,
  backoffMs,
  synthTimeoutMs,
}) {
  const chainMs = llmTurnBudgetMs({ requestTimeoutMs, maxRetries, backoffMs });
  const lastRoundStartMs = Math.max(
    0,
    Math.min(
      turnLoopDeadlineMs(synthTimeoutMs) - requestTimeoutMs,
      (MAX_TOOL_ROUNDS_PER_TURN - 1) * chainMs,
    ),
  );
  return lastRoundStartMs + chainMs + turnOverheadMs(synthTimeoutMs);
}

// null = haelt; sonst { worstCaseMs, limitMs, overrunMs } fuer die Boot-Warnung.
// Bezugsgroesse ist der Dead-Air-Watchdog des Assistant-Pfads (TELNYX_DEAD_AIR_TIMEOUT_S):
// er beendet den Call, wenn zwischen zwei Lebenszeichen zu viel Zeit vergeht - ein
// einzelner, zu langer Turn reisst genau ihn. Der Telnyx-EIGENE LLM-Timeout ist die zweite
// Bezugsgroesse; solange AL-P2 ihn nicht gemessen hat, wird er hier NICHT geraten.
export function deadAirOverrun({
  deadAirTimeoutMs,
  requestTimeoutMs,
  maxRetries,
  backoffMs,
  synthTimeoutMs,
}) {
  const worstCaseMs = enforcedTurnWorstCaseMs({
    requestTimeoutMs,
    maxRetries,
    backoffMs,
    synthTimeoutMs,
  });
  if (worstCaseMs <= deadAirTimeoutMs) return null;
  return { worstCaseMs, limitMs: deadAirTimeoutMs, overrunMs: worstCaseMs - deadAirTimeoutMs };
}
