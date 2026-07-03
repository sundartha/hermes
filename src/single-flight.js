// Single-Flight-Kombinator (PROV-01/F3): serialisiert nebenlaeufige Aufrufe von `task`
// ueber eine Promise-Kette (In-Process-Mutex, identische Technik wie store.withStoreLock -
// src/store.js -, aber als generischer, OHNE Server-Boot importierbarer Baustein, damit
// unit-testbar ohne Spawn). Ein zweiter Aufruf startet erst, wenn der vorige `task` fertig
// ist -> es laeuft nie mehr als EIN `task` gleichzeitig ("single-flight"). PRAEZISIERUNG
// (G2/N7): serialisiert, teilt NICHT ein Ergebnis - jeder Aufruf bekommt seine eigene,
// spaeter startende Ausfuehrung; fuer den Drain faellt der zweite Lauf zum No-op zusammen
// (alle Jobs sind dann bereits 'done').
//
// Anwendungsfall Provisioning-Drain: der Memory-Queue-Adapter markiert einen Job erst NACH
// dem langen Provider-await 'done'; zwei fast-gleichzeitige Drains wuerden denselben QUEUED-
// Job sonst doppelt kaufen (Doppel-Order/Doppel-Capture). Serialisiert laeuft der zweite
// Drain erst, wenn der erste alle Jobs auf 'done' gesetzt hat.
//
// EIGENE Kette (bewusst NICHT store.withStoreLock wiederverwendet): der Drain haelt einen
// langen Provider-await + Per-Job-save() und darf die kurze Store-Schreib-Serialisierung
// nicht blockieren (getrennte Zustaendigkeit).
//
// .then(run, run): ein Fehler im `task` bricht die Kette NICHT ab (ein gescheiterter Drain
// darf Folge-Drains nicht blockieren) - dieselbe Fehler-Toleranz wie store.withStoreLock.
// `run` kapselt den Aufruf und verwirft den von .then durchgereichten Value/Reason-Parameter
// (task erwartet kein Argument).
export function makeSingleFlight(task) {
  let chain = Promise.resolve();
  const run = () => task();
  return function runExclusive() {
    chain = chain.then(run, run);
    return chain;
  };
}
