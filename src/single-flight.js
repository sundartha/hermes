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
// Ketten-Mechanik ausgelagert nach chain-mutex.js (G5, geteilt mit store.withStoreLock in
// src/store.js) - EIGENE Chain-Instanz hier (bewusst NICHT store.withStoreLock wiederverwendet):
// der Drain haelt einen langen Provider-await + Per-Job-save() und darf die kurze Store-
// Schreib-Serialisierung nicht blockieren (getrennte Zustaendigkeit). Als eigenstaendiges,
// ohne Server-Boot importierbares Modul gebaut, damit der Guard unit-testbar ist (server.js
// bootet unbedingt beim Import).
//
// AKZEPTIERTES RESTRISIKO (P16, Launch-Entscheidung, Konvention wie der OT-3-Kommentar in
// store.js): diese Kette serialisiert prozessweit JEDEN Provisioning-Drain ALLER Tenants.
// Kein Provider-Call im Drain-Pfad (Telnyx orderNumber/searchNumbers, Stripe placeHold/
// captureHold/cancelHold) hat in src/ einen Timeout oder AbortController. Haengt ein
// einzelner Provider-Call (Netzwerk-Partition, TLS-Hang, Outage ohne RST), blockiert das
// die GESAMTE Provisioning-Pipeline fuer ALLE Tenants (nicht nur den einen Drain-Lauf) -
// jeder weitere Trigger (neues Onboarding, Webhook, Retry) reiht sich hinter dem haengenden
// Lauf ein und wartet mit, bis der Socket-Timeout des Runtime-HTTP-Clients greift oder der
// Prozess neu startet. Bewusst akzeptiert fuer den Launch: ein fetchWithTimeout/Watchdog um
// die Provider-Calls gehoert in eine eigene Folge-Phase, nicht in diesen Minimal-Fix.
import { makeChainMutex } from "./chain-mutex.js";

export function makeSingleFlight(task) {
  const runExclusive = makeChainMutex();
  return function runSingleFlight() {
    return runExclusive(task);
  };
}
