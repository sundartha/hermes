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

// Gekeytes Pendant zu makeChainMutex (G5, additiv - macht KEINEN bestehenden Aufrufer an,
// makeChainMutex bleibt unveraendert). Serialisiert Aufrufe von `fn` NUR fuer denselben
// Schluessel; verschiedene Schluessel laufen unabhaengig/parallel (kein globaler Flaschenhals
// wie bei makeSingleFlight). Pro Schluessel eine eigene makeChainMutex()-Instanz, lazy angelegt
// beim ersten Aufruf. `inFlight` zaehlt laufende+wartende Aufrufe fuer den Schluessel; erreicht
// er 0 (letzter Aufruf fuer den Schluessel abgeschlossen, egal ob erfuellt oder abgelehnt), wird
// der Map-Eintrag geloescht - die Map waechst nur mit der Zahl GERADE aktiver Schluessel, nicht
// mit der Gesamtzahl je gesehener Schluessel (Millionen-Skala-vertraeglich, z.B. ein Schluessel
// pro Stripe-Subscription mit aktuell laufendem Webhook).
export function makeKeyedChainMutex() {
  const chainsByKey = new Map(); // key -> { runExclusive, inFlight }
  return function runExclusiveForKey(key, fn) {
    let entry = chainsByKey.get(key);
    if (!entry) {
      entry = { runExclusive: makeChainMutex(), inFlight: 0 };
      chainsByKey.set(key, entry);
    }
    entry.inFlight += 1;
    const release = () => {
      entry.inFlight -= 1;
      if (entry.inFlight === 0) chainsByKey.delete(key);
    };
    return entry.runExclusive(fn).then(
      (value) => {
        release();
        return value;
      },
      (err) => {
        release();
        throw err;
      },
    );
  };
}
