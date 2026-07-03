// Single-Flight-Kombinator (PROV-01/F3): serialisiert nebenlaeufige Aufrufe von `task`
// ueber eine Promise-Kette (In-Process-Mutex). Ein zweiter Aufruf startet erst, wenn
// der vorige `task` fertig ist -> es laeuft nie mehr als EIN `task` gleichzeitig
// ("single-flight"). PRAEZISIERUNG (G2/N7): serialisiert, teilt NICHT ein Ergebnis -
// jeder Aufruf bekommt seine eigene, spaeter startende Ausfuehrung; fuer den Drain
// faellt der zweite Lauf zum No-op zusammen (alle Jobs sind dann bereits 'done').
//
// Anwendungsfall Provisioning-Drain: der Memory-Queue-Adapter markiert einen Job erst NACH
// dem langen Provider-await 'done'; zwei fast-gleichzeitige Drains wuerden denselben QUEUED-
// Job sonst doppelt kaufen (Doppel-Order/Doppel-Capture). Serialisiert laeuft der zweite
// Drain erst, wenn der erste alle Jobs auf 'done' gesetzt hat.
//
// Ketten-Mechanik ausgelagert nach chain-mutex.js (G5, geteilt mit store.withStoreLock) -
// EIGENE Chain-Instanz hier (bewusst NICHT store.withStoreLock wiederverwendet): der Drain
// haelt einen langen Provider-await + Per-Job-save() und darf die kurze Store-Schreib-
// Serialisierung nicht blockieren (getrennte Zustaendigkeit). Als eigenstaendiges, ohne
// Server-Boot importierbares Modul gebaut, damit der Guard unit-testbar ist (server.js
// bootet unbedingt beim Import).
import { makeChainMutex } from "./chain-mutex.js";

// Watchdog (P16 Review-Fix): jeder einzelne Provider-Call in der Kette ist inzwischen
// selbst per fetchWithTimeout gedeckelt (src/fetch-with-timeout.js) - ein haengender
// Request kann die Kette also nicht mehr auf ewig blockieren. Dieser Watchdog ist die
// zweite, unabhaengige Sicherung: er meldet (statt still zu schweigen), wenn EIN Lauf
// trotzdem auffaellig lange braucht (z.B. mehrere Jobs/Retries hintereinander) - Signal
// fuers Betriebs-Log, kein eigenes Abbrechen (der Lauf selbst wird nicht gekappt).
const DEFAULT_WATCHDOG_MS = 60000;

// Default-Meldung, PII-/Secret-frei (nur Frist + generischer Hinweis, Regel 4).
function warnStalled(watchdogMs) {
  console.warn(
    `[single-flight] Lauf ist seit ueber ${watchdogMs}ms nicht fertig - moeglicher haengender Provider-Call.`,
  );
}

// options: { watchdogMs, onStall } - beide optional, injizierbar fuer Tests (kein
// echtes Warten auf DEFAULT_WATCHDOG_MS noetig).
export function makeSingleFlight(task, { watchdogMs = DEFAULT_WATCHDOG_MS, onStall = warnStalled } = {}) {
  const runExclusive = makeChainMutex();
  return function runExclusiveTask() {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) onStall(watchdogMs);
    }, watchdogMs);
    // unref(): der Watchdog-Timer darf allein keinen Prozess am Leben halten (Tests/CLI
    // sollen sauber beenden koennen, sobald alle "echte" Arbeit fertig ist).
    if (typeof timer.unref === "function") timer.unref();
    return runExclusive(task).finally(() => {
      settled = true;
      clearTimeout(timer);
    });
  };
}
