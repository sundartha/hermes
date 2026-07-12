// stab-p9 (PLAN-STABILIZE-LAUNCH.md P9, Kosten-Notaus): Per-Conversation-Watchdog fuer den
// C-Telnyx-AI-Assistant-Pfad. Zwei Achsen, EIN per-callId-Zustand:
//  1. Dead-Air: nach ai_assistant_start (arm) muss binnen N Sekunden ein Lebenszeichen
//     (Shim-Turn -> observeTurn) kommen; bleibt es aus, gilt die Telnyx-interne TTS als
//     stumm/haengend -> kontrollierte Terminierung (Minuten-/Kosten-Notaus).
//  2. Loop-Guard: M KONSEKUTIVE nicht-substanzielle Turns (leere/Echo-Eingabe im Sinne
//     von stab-p7) -> Re-Prompt-Leerlauf -> kontrollierte Terminierung (Token-Notaus,
//     ZUSAETZLICH zum per-Minute-Rate-Limiter im Shim).
// OEFFNET/originiert NIE einen Call (Regel 1) - terminiert nur ueber das injizierte
// Call-Control-Hangup-Primitiv. Reine Zustands-/Timer-Logik; Timer + terminate injiziert
// -> offline mit Fake-Timern/Spy testbar. Node ist kooperativ single-threaded: arm/
// observeTurn/clear sind synchron -> keine Race auf states (P16 n.z.).
import { isSubstantialCallerText } from "./claude.js";

const MS_PER_SECOND = 1000;
export const WATCHDOG_LOG_PREFIX = "[telnyx-watchdog]";

// Timer, der den Event-Loop NICHT am Leben haelt (der HTTP-Server tut das) - Muster
// middleware.js makeFixedWindowCounter (.unref()). Injizierbar fuer deterministische Tests.
function defaultSetTimer(fn, ms) {
  const handle = setTimeout(fn, ms);
  if (handle && typeof handle.unref === "function") handle.unref();
  return handle;
}

export function makeConversationWatchdog({
  config,
  terminate,
  setTimer = defaultSetTimer,
  clearTimer = clearTimeout,
}) {
  const deadAirMs = config.telnyxDeadAirTimeoutS * MS_PER_SECOND;
  const maxEmptyTurns = config.telnyxLoopGuardMaxEmptyTurns;
  // EIN Timer je aktivem Call (beim Fuettern ersetzt, beim Feuern/Clear entfernt) ->
  // beschraenkt durch die Zahl paralleler Assistant-Calls, kein Sweep noetig (der Timer
  // raeumt sich selbst ab).
  const states = new Map();

  function ensureState(callId) {
    let s = states.get(callId);
    if (!s) {
      s = { timer: null, emptyStreak: 0 };
      states.set(callId, s);
    }
    return s;
  }
  function restartTimer(callId, s) {
    // Fuettern = Lebenszeichen gesehen
    if (s.timer) clearTimer(s.timer);
    s.timer = setTimer(() => onDeadAir(callId), deadAirMs);
  }
  function onDeadAir(callId) {
    const s = states.get(callId);
    if (!s) return; // bereits terminal geraeumt (clear bei hangup)
    s.timer = null;
    states.delete(callId); // one-shot, kein Leak; Re-Arm nur ueber arm/observeTurn
    console.warn(`${WATCHDOG_LOG_PREFIX} dead_air ${JSON.stringify({ callId })}`); // PII-frei
    Promise.resolve(terminate(callId)).catch(() => {}); // Timer-Callback -> keine unhandled rejection
  }
  function arm(callId) {
    // ai_assistant_start ist raus (Ingest). Idempotent.
    restartTimer(callId, ensureState(callId));
  }
  function observeTurn(callId, callerText) {
    const s = ensureState(callId);
    restartTimer(callId, s); // Turn = Lebenszeichen -> Dead-Air zuruecksetzen
    if (isSubstantialCallerText(callerText)) {
      s.emptyStreak = 0;
      return { loopExceeded: false };
    }
    s.emptyStreak += 1;
    return { loopExceeded: s.emptyStreak >= maxEmptyTurns };
  }
  function clear(callId) {
    // Call terminal (jeder Grund) -> Wache stoppen
    const s = states.get(callId);
    if (s && s.timer) clearTimer(s.timer);
    states.delete(callId);
  }
  return { arm, observeTurn, clear };
}
