// Generische Ketten-Mutex-Primitive (G5 Review-Fix PROV-01/F3): der gemeinsame Kern
// hinter store.withStoreLock (src/store.js) und makeSingleFlight (src/single-flight.js).
// Serialisiert Aufrufe von `fn` ueber eine Promise-Kette - ein Aufruf startet erst,
// wenn der vorige fertig ist (egal ob er erfuellt oder abgelehnt hat).
//
// JEDER Aufrufer haelt seine EIGENE Chain-Instanz (makeChainMutex() liefert bei jedem
// Aufruf eine frische Kette). Das ist bewusst getrennt geblieben: der kurze Store-
// Schreib-Lock (load -> mutiere -> save) und der lange Provisioning-Drain-Await
// duerfen sich nicht gegenseitig blockieren - nur die Ketten-MECHANIK ist gemeinsam,
// nicht die Chain-Instanz.
//
// .then(run, run): ein Fehler in `fn` bricht die Kette NICHT ab - ein gescheiterter
// Lauf darf nachfolgende Laeufe nicht blockieren (gilt fuer Store-Writes wie fuer den
// Provisioning-Drain gleichermassen).
export function makeChainMutex() {
  let chain = Promise.resolve();
  return function runExclusive(fn) {
    const run = () => fn();
    chain = chain.then(run, run);
    return chain;
  };
}
