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
//
// K0 (PLAN-CONVERSATION-OPTIMIZATION.md, Messgrundlage): turnSeq zaehlt zusaetzlich die
// Shim-Requests JE CALL (1-basiert, in observeTurn erhoeht). Telnyx liefert keinen Marker
// fuer verworfene/spekulative Turns (F5 im Plan) - turnSeq ist die einzige Sichtbarkeit
// darauf und lebt bewusst NICHT in einer neuen globalen Map, sondern im bereits
// vorhandenen per-callId-Zustand dieser Datei: er wird damit automatisch beim naechsten
// clear()/terminateOnce() mit entsorgt (kein separates Aufraeumen, kein Leck).
import { isSubstantialCallerText } from "./claude.js";
import { defaultSetTimer, MS_PER_SECOND } from "./utils/timer.js";

export const WATCHDOG_LOG_PREFIX = "[telnyx-watchdog]";

// afix-p3 (R4): Sprechdauer-Schaetzung fuer den Abschiedssatz. Synthese-/Playback-Latenz vor
// dem ersten Ton (BASE) plus Sprechzeit (MS_PER_CHAR je Zeichen).
//
// K3 (PLAN-CONVERSATION-OPTIMIZATION.md): Die urspruenglichen Werte (1500ms + 70ms/Zeichen,
// ~14 Zeichen/s) waren geraten, nie gemessen. Fuer DEUTSCH ersetzt durch eine echte
// Kalibrierung aus der Forensik an zwei echten Testanrufen (Kanaltrennung + silencedetect,
// Abgleich mit den Telnyx-Message-Texten, 2026-07-12): gemessene ElevenLabs-Sprechrate ueber 4
// zuordenbare Passagen 17.30 / 19.90 / 20.34 / 17.62 Zeichen/s (Median 18.76, LANGSAMSTES
// Minimum 17.30 = 57.8 ms/Zeichen); TTS-Anlauf (Telnyx audio_first_token_duration_ms, Zeit von
// unserer Completion bis Audio bereit) 108-139 ms (Median 119, Maximum 139); laengster
// gemessener Abschiedssatz 206 Zeichen -> 11.694s echte Sprechdauer (Beleg:
// tasks/afix-testcall2-report.md, Turn-3-Audiofenster 17:37:34.393-17:37:46.087).
//
// SPRACH-TABELLE statt EIN globaler Wert: die Sprechrate (Zeichen/s) ist sprachabhaengig -
// Englisch hat bei aehnlichem Sprechtempo KUERZERE Woerter als Deutsch, also WENIGER
// Zeichen/s. Ein auf Deutsch kalibrierter Wert wuerde englische/franzoesische
// Abschiedssaetze zu KURZ schaetzen -> abgeschnittener Abschied (genau R4, der Bug, den P3
// gerade erst behoben hat). Gemessen ist bisher NUR Deutsch (s.o.). Jede andere Sprache
// (inkl. unbekannt/fehlend) faellt deshalb auf FAREWELL_FALLBACK_CALIBRATION zurueck - das
// UNVERAENDERTE, in Produktion bewaehrte Bestandsverhalten (1500ms + 70ms/Zeichen). Eine
// weitere Sprache bekommt einen eigenen Tabellen-Eintrag ERST NACH einer echten Messung
// (Kanaltrennung + silencedetect an einem echten Testanruf IN DIESER SPRACHE) - nie durch
// Schaetzung oder Analogieschluss zu 'de'.
//
// BASE (de): gemessener Anlauf-Maximalwert 139ms + reichlich Puffer fuer Netz-Jitter -> 500ms.
// MS_PER_CHAR (de): die LANGSAMSTE gemessene Rate (57.8 ms/Zeichen) + ~12% Sicherheitsaufschlag,
// bewusst NICHT der Median (18.76 Zeichen/s) -> 65ms/Zeichen. Die Asymmetrie ist der Kern
// dieser Kalibrierung: zu lang geschaetzt = ein paar Sekunden Stille vor dem Auflegen
// (haesslich, aber harmlos); zu kurz geschaetzt = der Abschiedssatz wird abgeschnitten (das
// ist R4). Deshalb wird auf die langsamste gemessene Sprechrate kalibriert, nicht auf die
// mittlere.
// MIN (TEIL DER KALIBRIERUNG, PRO SPRACHE - Review-Fund MAJOR-1, 2. Review-Runde): der
// urspruengliche Fix legte MIN faelschlich als EINEN globalen Wert (1500ms) an und stuelpte
// damit die niedrigere DEUTSCHE Kalibrierung auf alle ungemessenen Sprachen. Bestandsverhalten
// (VOR K3) war fuer ALLE Sprachen clamp(1500 + 70ms/Zeichen, 3000, 12000) - der Sockel war also
// 3000ms, nicht 1500ms. Mit der niedrigeren de-Basis (500ms) reicht fuer DEUTSCH ein kleinerer,
// GEMESSENER Sockel (1500ms), damit kurze deutsche Abschiedssaetze nicht kuenstlich verlangsamt
// werden - das gilt aber NUR fuer 'de'. Der FALLBACK (jede andere/unbekannte, ungemessene
// Sprache) behaelt seinen alten Sockel 3000ms exakt bei: mit dem globalen 1500ms waere der
// Fallback fuer kurze Texte KUERZER als das Bestandsverhalten (bei 8 Zeichen: 2060ms statt
// 3000ms) - ein kurzer englischer/franzoesischer Abschied wuerde abgeschnitten, exakt R4, der
// Bug, den P3 behebt. minMs lebt deshalb JETZT IN jedem Kalibrierungs-Eintrag (kein globaler
// FAREWELL_MIN_MS mehr).
// MAX (weiterhin GLOBAL, alle Sprachen - bleibt bewusst EIN Wert statt Tabelle): HOCH statt
// runter gesetzt - kontraintuitiv, aber der alte 12s-Cap hat einen etwas laengeren Abschied
// (der gemessene 206-Zeichen-Fall braucht real 11.694s) bei der Wiedergabe selbst abgeschnitten
// - der Cap war damit selbst eine R4-Quelle. 15000ms deckt bei der langsamsten gemessenen
// (deutschen) Rate ~220 Zeichen ab. Anders als MIN ist ein globales MAX unkritisch: es
// VERLAENGERT den Delay nur, kann also nie einen Abschied abschneiden - deshalb bleibt es aus
// der Kalibrierungs-Tabelle heraus. Der Cap bleibt eine harte Obergrenze gegen offen haengende
// Calls (Kosten-Notaus, gilt sprachunabhaengig); Max-Gespraechsdauer und Budget-Gates bleiben
// davon unberuehrt.
const FAREWELL_MAX_MS = 15_000;
// FALLBACK = EXAKT das alte, in Produktion bewaehrte Bestandsverhalten (1500ms Basis + 70ms/
// Zeichen + 3000ms Sockel) - unveraendert fuer jede Sprache ausser 'de'.
const FAREWELL_FALLBACK_CALIBRATION = { baseMs: 1500, msPerChar: 70, minMs: 3000 };
const FAREWELL_CALIBRATION_BY_LANGUAGE = Object.freeze({
  de: { baseMs: 500, msPerChar: 65, minMs: 1500 },
});

// Geschaetzte Sprechdauer -> Hangup-Delay, hart geklammert. language waehlt die Kalibrierung
// INKLUSIVE ihres minMs (s. Tabellenkommentar oben, MAJOR-1) - unbekannt/fehlend ->
// FAREWELL_FALLBACK_CALIBRATION. Nicht-numerische/negative Laengen (defekter Turn) fallen auf
// 0 -> minMs der gewaehlten Kalibrierung: Math.min/max reicht NaN durch, und setTimeout(NaN)
// feuert SOFORT = genau der Defekt (abgeschnittener Abschied), den P3 behebt.
function farewellDelayMs(speechChars, language) {
  const chars = Number.isFinite(speechChars) && speechChars > 0 ? speechChars : 0;
  const { baseMs, msPerChar, minMs } =
    FAREWELL_CALIBRATION_BY_LANGUAGE[language] || FAREWELL_FALLBACK_CALIBRATION;
  const spokenMs = baseMs + chars * msPerChar;
  return Math.min(Math.max(spokenMs, minMs), FAREWELL_MAX_MS);
}

export function makeConversationWatchdog({
  config,
  terminate,
  setTimer = defaultSetTimer,
  clearTimer = clearTimeout,
}) {
  const deadAirMs = config.telnyxAssistant.deadAirTimeoutS * MS_PER_SECOND;
  const maxEmptyTurns = config.telnyxAssistant.loopGuardMaxEmptyTurns;
  // EIN Timer je aktivem Call (beim Fuettern ersetzt, beim Feuern/Clear entfernt) ->
  // beschraenkt durch die Zahl paralleler Assistant-Calls, kein Sweep noetig (der Timer
  // raeumt sich selbst ab).
  const states = new Map();

  function ensureState(callId) {
    let s = states.get(callId);
    if (!s) {
      s = { deadAirTimer: null, farewellTimer: null, emptyStreak: 0, turnSeq: 0 };
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
    // MINOR-2-Fix (2. Review-Runde): der State (s) wird an onBeforeTerminate durchgereicht,
    // BEVOR terminate() laeuft - states.delete(callId) oben entfernt nur den Map-Eintrag, s
    // selbst bleibt fuer den Aufrufer gueltig. Braucht z.B. onDeadAir fuer s.turnSeq im Log.
    if (onBeforeTerminate) onBeforeTerminate(s);
    Promise.resolve(terminate(callId)).catch(() => {}); // Timer-Callback -> keine unhandled rejection
  }
  function onDeadAir(callId) {
    terminateOnce(callId, "deadAirTimer", {
      // MINOR-2 (Review-Fund): turnSeq dokumentiert, wie viele Shim-Turns dieser Call bereits
      // erreicht hat, bevor der Notaus terminiert - ohne sie war der einzige Anhaltspunkt der
      // reine Umstand "dead_air trat auf", nicht "nach wie vielen Turns".
      onBeforeTerminate: (s) =>
        console.warn(`${WATCHDOG_LOG_PREFIX} dead_air ${JSON.stringify({ callId, turnSeq: s.turnSeq })}`), // PII-frei
    });
  }
  function arm(callId) {
    // ai_assistant_start ist raus (Ingest). Idempotent.
    restartDeadAirTimer(callId, ensureState(callId));
  }
  function observeTurn(callId, callerText) {
    const s = ensureState(callId);
    // K0: jeder Aufruf ist EIN Shim-Request fuer diesen Call - unabhaengig davon, ob der
    // Turn anschliessend substanziell ist oder den Loop-Guard reisst.
    s.turnSeq += 1;
    // afix-p3: ein neuer Turn waehrend des Farewell-Delays heisst, das Gespraech laeuft doch
    // weiter (der Abschied war verfrueht) -> Terminierung abblasen; beendet wird am naechsten
    // end_call-Turn. Damit endet zugleich die Dead-Air-Suspendierung (restart unten).
    clearNamedTimer(s, "farewellTimer");
    restartDeadAirTimer(callId, s); // Turn = Lebenszeichen -> Dead-Air zuruecksetzen
    if (isSubstantialCallerText(callerText)) {
      s.emptyStreak = 0;
      return { loopExceeded: false, turnSeq: s.turnSeq };
    }
    s.emptyStreak += 1;
    return { loopExceeded: s.emptyStreak >= maxEmptyTurns, turnSeq: s.turnSeq };
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
  // K3-Fix (MAJOR-1): die Kalibrierung ist sprachabhaengig (s. Tabellenkommentar oben) - der
  // Aufrufer reicht language deshalb neben speechChars durch. Ein Objekt-Parameter statt eines
  // dritten Positions-Arguments (F1: mehrere zusammengehoerige Werte -> Objekt), damit die
  // Funktion bei 2 Argumenten bleibt. Fehlt language (undefined/unbekannt) -> Fallback-
  // Kalibrierung, kein neues Risiko fuer bestehende Aufrufer.
  function scheduleFarewellHangup(callId, { speechChars, language } = {}) {
    const s = ensureState(callId);
    clearNamedTimer(s, "deadAirTimer");
    clearNamedTimer(s, "farewellTimer");
    const delayMs = farewellDelayMs(speechChars, language);
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
