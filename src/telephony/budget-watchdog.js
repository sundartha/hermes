// IE2 (PLAN-INBOUND-PARITAET.md, "Die Geld-Achse bekommt einen Herzschlag"): der
// wiederkehrende Geld-Waechter je aktivem Anruf.
//
// B8 (der Befund, der diese Datei erzwingt): blockingBudgetAxis wird heute aus vier
// EREIGNISGEBUNDENEN Stellen gefragt - claude.js#agentTurn (Turn-Runde),
// telnyx-llm-shim.js (Shim-Turn), routes/webhooks-elevenlabs.js (EL-Werkzeug-Webhook) und
// telephony/call-lifecycle.js#reattachActiveCall (/voice/*-Re-Attach). Ein Anruf ohne Turn
// und ohne Werkzeugaufruf erreicht die pro-Tenant-Decke NIE - die Sicherung wirkt mid-call
// nur, wenn der Anruf ohnehin Arbeit erzeugt. Dieser Waechter fragt DIESELBE Achse
// wiederkehrend; er rechnet nichts selbst und legt nicht selbst auf.
//
// Er haengt am ANRUF-DATENSATZ (Status aktiv), nicht an einer Engine: damit deckt er
// Budget-Inbound, EL-Outbound und den kuenftigen EL-Inbound mit EINER Wahrheit.
//
// Vorbild fuer Form und Lebenszyklus (arm/rearm je Leg, unref-Timer):
// telnyx-conversation-watchdog.js - Vorbild, NICHT Wiederverwendung. Jener Waechter
// terminiert entlang der Dead-Air-/Loop-Achsen eines Assistant-Gespraechs und verschwindet
// mit dem Assistant-Pfad; diese Achse ist engine-neutral und bleibt.
//
// KEIN clear(): der Takt endet, weil die injizierte Abfrage (activeCallById) den Anruf nicht
// mehr als laufend liefert. Ein Aufraeum-Aufruf an jedem Hangup-/Status-/Finish-Pfad waere
// eine Sicherung per Konvention (G27) - der erste kuenftige Pfad, der ihn vergisst, wuerde
// den Takt leaken. Preis: hoechstens EINE Leerrunde (ein reiner Speicher-Read) nach
// Anrufende.
//
// Reine Zustands-/Timer-Logik: kein Store-, Config- oder Provider-Import, alles IO
// injiziert -> offline mit Fake-Timern testbar (P12). Node ist kooperativ single-threaded,
// arm/rearm/tick sind bezueglich der armed-Menge synchron -> keine Race (P16 n.z.).
import { defaultSetTimer } from "../utils/timer.js";

export function makeBudgetWatchdog({
  intervalMs,
  // (callId) => call | null - NUR noch laufende Legs. WELCHER Datensatz laeuft, entscheidet
  // der Aufrufer (diese Datei kennt keinen Store).
  activeCallById,
  // (call) => axisToken | null - die EINE Geld-Achse (budget-gate.js#blockingBudgetAxis),
  // gebunden vom Aufrufer.
  blockingAxisFor,
  // (call) => Promise<void> - der EINE Terminierungspfad. Dieser Waechter legt nicht selbst
  // auf; er ruft den Bestandsweg.
  terminate,
  setTimer = defaultSetTimer,
}) {
  // 0 (und jeder nicht-endliche Wert) = KOMPLETT AUS - der dokumentierte Rueckfall-Hebel
  // ohne Deploy. Ein Hand-Mock ohne den Config-Schluessel liefert undefined und faellt damit
  // auf das Bestandsverhalten zurueck.
  const enabled = Number.isFinite(intervalMs) && intervalMs > 0;
  // Die Menge IST die Armierung: kein Timer-Handle-Buch. Ein Timer, dessen callId nicht mehr
  // in der Menge steht, laeuft ins Leere (Guard in tick) - genau die Stelle, die ein
  // clearTimeout ersetzen wuerde, ohne einen zweiten Zustand zu fuehren.
  const armed = new Set();

  function schedule(callId) {
    setTimer(() => {
      void tick(callId).catch((err) => onTickFailure(callId, err));
    }, intervalMs);
  }

  // E-9: eine gescheiterte Runde (die Achse oder der Store wirft) beendet die Wache NICHT -
  // sie wird neu gestellt. Ein stumm gestorbener Waechter liesse genau den Anruf laufen, fuer
  // den die Achse gerade nicht antwortbar war; das ist die falsche Fehlrichtung fuer ein
  // Gate. Eine Zeile, nur callId + err.message (PII-frei, Muster call-lifecycle.js).
  function onTickFailure(callId, err) {
    console.error(`[budget] Geld-Wache: Runde fehlgeschlagen (call=${callId}): ${err.message}`);
    if (armed.has(callId)) schedule(callId);
  }

  async function tick(callId) {
    if (!armed.has(callId)) return;
    const call = activeCallById(callId);
    if (!call) {
      // Terminal -> die Wache endet hier, ohne dass ein Anrufende-Pfad sie abmelden muss.
      armed.delete(callId);
      return;
    }
    if (!blockingAxisFor(call)) {
      // NEGATIVFALL: die Decke traegt noch -> es passiert NICHTS ausser der naechsten Runde.
      schedule(callId);
      return;
    }
    // One-shot: aus der Menge NEHMEN, bevor terminiert wird - kein zweiter Hangup-Versuch
    // fuer dasselbe Leg, auch wenn die Terminierung laenger braucht als ein Takt.
    armed.delete(callId);
    await terminate(call);
  }

  // Idempotent: ein zweiter Aufruf fuer dieselbe callId stellt keinen zweiten Takt (kein
  // Timer-Leak, z.B. wenn Anrufstart und Re-Attach denselben Anruf armieren).
  function arm(callId) {
    if (!enabled || armed.has(callId)) return;
    armed.add(callId);
    schedule(callId);
  }

  // Boot-Re-Arm: der Aufrufer liefert die callIds der laufenden Legs (er kennt den Store,
  // diese Datei nicht). Meldet nur die ANZAHL neu armierter Legs zurueck - die Logzeile
  // bleibt beim Aufrufer, damit es je Achse genau EINE Logquelle gibt.
  function rearm(callIds) {
    const before = armed.size;
    for (const callId of callIds) arm(callId);
    return { armedNow: armed.size - before };
  }

  return { arm, rearm };
}
