// stab-p9 (PLAN-STABILIZE-LAUNCH.md P9, Kosten-Notaus): Per-Conversation-Watchdog fuer den
// C-Telnyx-AI-Assistant-Pfad. Drei Achsen, EIN per-callId-Zustand:
//  1. Dead-Air: nach ai_assistant_start (arm) muss binnen N Sekunden ein Lebenszeichen
//     (Shim-Turn -> observeTurn) kommen; bleibt es aus, gilt die Telnyx-interne TTS als
//     stumm/haengend -> kontrollierte Terminierung (Minuten-/Kosten-Notaus).
//  2. Loop-Guard: M KONSEKUTIVE nicht-substanzielle Turns (leere/Echo-Eingabe im Sinne
//     von stab-p7) -> Re-Prompt-Leerlauf -> kontrollierte Terminierung (Token-Notaus,
//     ZUSAETZLICH zum per-Minute-Rate-Limiter im Shim).
//  3. Farewell-Hangup (afix-p3, R4): verzoegerte, PLANMAESSIGE Terminierung nach end_call -
//     kein Notaus, sondern der Schutz des Abschiedssatzes (der sofortige Hangup schnitt den
//     Abschied ab, bevor die TTS-Synthese auch nur begonnen hatte).
// OEFFNET/originiert NIE einen Call (Regel 1) - terminiert nur ueber das injizierte
// Call-Control-Hangup-Primitiv. Reine Zustands-/Timer-Logik; Timer + terminate injiziert
// -> offline mit Fake-Timern/Spy testbar. Node ist kooperativ single-threaded: arm/
// observeTurn/scheduleFarewellHangup/clear sind synchron -> keine Race auf states (P16 n.z.).
import { isSubstantialCallerText } from "./claude.js";

const MS_PER_SECOND = 1000;
export const WATCHDOG_LOG_PREFIX = "[telnyx-watchdog]";

// afix-p3 (R4): Sprechdauer-Schaetzung fuer den Abschiedssatz. ~14 Zeichen/s (70 ms/Zeichen)
// plus Anlauf (Synthese-/Playback-Latenz vor dem ersten Ton). MIN: auch ein kurzer/leerer Text
// darf nicht abgeschnitten werden. MAX: harter Kosten-Deckel (Minuten laufen weiter).
const FAREWELL_BASE_MS = 1500;
const FAREWELL_MS_PER_CHAR = 70;
const FAREWELL_MIN_MS = 3000;
const FAREWELL_MAX_MS = 12_000;

// Timer, der den Event-Loop NICHT am Leben haelt (der HTTP-Server tut das) - Muster
// middleware.js makeFixedWindowCounter (.unref()). Injizierbar fuer deterministische Tests.
function defaultSetTimer(fn, ms) {
  const handle = setTimeout(fn, ms);
  if (handle && typeof handle.unref === "function") handle.unref();
  return handle;
}

// Geschaetzte Sprechdauer -> Hangup-Delay, hart geklammert. Nicht-numerische/negative Laengen
// (defekter Turn) fallen auf 0 -> FAREWELL_MIN_MS: Math.min/max reicht NaN durch, und
// setTimeout(NaN) feuert SOFORT = genau der Defekt (abgeschnittener Abschied), den P3 behebt.
function farewellDelayMs(speechChars) {
  const chars = Number.isFinite(speechChars) && speechChars > 0 ? speechChars : 0;
  const spokenMs = FAREWELL_BASE_MS + chars * FAREWELL_MS_PER_CHAR;
  return Math.min(Math.max(spokenMs, FAREWELL_MIN_MS), FAREWELL_MAX_MS);
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
      s = { deadAirTimer: null, farewellTimer: null, emptyStreak: 0 };
      states.set(callId, s);
    }
    return s;
  }
  // Generischer Timer-Clear ueber den Feldnamen ("deadAirTimer"/"farewellTimer") - beide
  // Timer-Arten raeumen sich identisch ab (nur das Feld unterscheidet sich, G5/S2).
  function clearNamedTimer(s, timerField) {
    if (!s[timerField]) return;
    clearTimer(s[timerField]);
    s[timerField] = null;
  }
  function restartDeadAirTimer(callId, s) {
    clearNamedTimer(s, "deadAirTimer"); // Fuettern = Lebenszeichen gesehen
    s.deadAirTimer = setTimer(() => onDeadAir(callId), deadAirMs);
  }
  // Gemeinsamer Kern von onDeadAir/onFarewellDue (G5/S2): genau EIN terminate, State vorher
  // weg (one-shot, kein Leak; Re-Arm nur ueber arm/observeTurn bzw. scheduleFarewellHangup).
  // Ein spaeter eintreffender call.hangup laeuft in clear() ins Leere, ein zweites Feuern
  // desselben Timers findet keinen State mehr. onBeforeTerminate haengt optionale
  // Achsen-spezifische Effekte (z.B. das Dead-Air-Log) vor dem terminate ein.
  function terminateOnce(callId, timerField, { onBeforeTerminate } = {}) {
    const s = states.get(callId);
    if (!s) return; // bereits terminal geraeumt (clear bei hangup)
    s[timerField] = null;
    states.delete(callId);
    if (onBeforeTerminate) onBeforeTerminate();
    Promise.resolve(terminate(callId)).catch(() => {}); // Timer-Callback -> keine unhandled rejection
  }
  function onDeadAir(callId) {
    terminateOnce(callId, "deadAirTimer", {
      onBeforeTerminate: () =>
        console.warn(`${WATCHDOG_LOG_PREFIX} dead_air ${JSON.stringify({ callId })}`), // PII-frei
    });
  }
  function arm(callId) {
    // ai_assistant_start ist raus (Ingest). Idempotent.
    restartDeadAirTimer(callId, ensureState(callId));
  }
  function observeTurn(callId, callerText) {
    const s = ensureState(callId);
    // afix-p3: ein neuer Turn waehrend des Farewell-Delays heisst, das Gespraech laeuft doch
    // weiter (der Abschied war verfrueht) -> Terminierung abblasen; beendet wird am naechsten
    // end_call-Turn. Damit endet zugleich die Dead-Air-Suspendierung (restart unten).
    clearNamedTimer(s, "farewellTimer");
    restartDeadAirTimer(callId, s); // Turn = Lebenszeichen -> Dead-Air zuruecksetzen
    if (isSubstantialCallerText(callerText)) {
      s.emptyStreak = 0;
      return { loopExceeded: false };
    }
    s.emptyStreak += 1;
    return { loopExceeded: s.emptyStreak >= maxEmptyTurns };
  }
  // afix-p3 (R4): end_call ist gefallen - der Abschiedssatz ist als Completion raus, die
  // TTS-Synthese laeuft aber erst an. Statt sofort aufzulegen (Live-Messung: Hangup 81 ms nach
  // der Completion, Abschied nie hoerbar) wird der Hangup um die geschaetzte Sprechdauer
  // verzoegert. Waehrend der Verzoegerung ist die Dead-Air-Achse dieses Calls SUSPENDIERT (Timer
  // geloescht, kein neuer gestellt) - sonst koennte sie mitten im Abschied praeemptiv terminieren
  // (TELNYX_DEAD_AIR_TIMEOUT_S darf bis auf 5 s stehen) und ein irrefuehrendes dead_air-Log
  // schreiben. Sie lebt beim naechsten observeTurn wieder auf. Ein zweiter Aufruf fuer denselben
  // Call ERSETZT den Timer (idempotent wie arm): zwei ueberlappende Shim-Turns (zwischen
  // observeTurn und end_call liegt ein await) koennen so nie zwei Terminierungen stellen.
  // Liefert den gewaehlten Delay zurueck (Kontrakt-Muster observeTurn), damit der Aufrufer ihn
  // PII-frei loggen kann, ohne die Clamp-Konstanten zu duplizieren (S2).
  function scheduleFarewellHangup(callId, speechChars) {
    const s = ensureState(callId);
    clearNamedTimer(s, "deadAirTimer");
    clearNamedTimer(s, "farewellTimer");
    const delayMs = farewellDelayMs(speechChars);
    s.farewellTimer = setTimer(() => onFarewellDue(callId), delayMs);
    return { delayMs };
  }
  function onFarewellDue(callId) {
    terminateOnce(callId, "farewellTimer");
  }
  function clear(callId) {
    // Call terminal (jeder Grund) -> Wache stoppen. Externer Hangup gewinnt IMMER: auch ein
    // laufender Farewell-Timer wird geloescht (kein zweiter Hangup-Versuch auf einen bereits
    // beendeten Call).
    const s = states.get(callId);
    if (s) {
      clearNamedTimer(s, "deadAirTimer");
      clearNamedTimer(s, "farewellTimer");
    }
    states.delete(callId);
  }
  return { arm, observeTurn, scheduleFarewellHangup, clear };
}
