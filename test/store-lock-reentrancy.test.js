// P2 (S1-11): strukturelle Re-Entrancy-Sicherung von store.withStoreLock. Beweist, dass ein
// verschachtelter Lock-Aufruf SOFORT+LAUT abbricht (statt prozessweitem stillem Deadlock) und
// dass legitime NEBENLAEUFIGE (nicht verschachtelte) Aufrufe unveraendert serialisiert
// durchlaufen. Der Guard sitzt backend-unabhaengig auf der Fassade -> json-Default genuegt
// (Temp-DATA_DIR wie outbound-budget-concurrency.test.js; data/store.json bleibt unangetastet).
//
// WATCHDOG statt node:test-Timeout: ein Deadlock wuerde OHNE eigene Frist bis zum Suite-Timeout
// haengen und dann unspezifisch rot faerben. withWatchdog() setzt eine kurze, deterministische
// Obergrenze und macht den Deadlock-Verdacht als eigene, sprechende Fehlermeldung sichtbar.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "./helpers.js";

// Watchdog-Frist: der Guard weist verschachtelte Aufrufe synchron (im selben Tick) ab, echte
// Nebenlaeufigkeit settelt in wenigen Ticks. 1000ms ist grosszuegig gegen CI-Jitter und faellt
// weit vor jeden node:test-Default-Timeout - schlaegt der Watchdog an, liegt ein Deadlock vor.
const WATCHDOG_MS = 1000;

// Verkabelt ein Promise gegen eine kurze Frist: gewinnt die Frist, liegt ein Deadlock-Verdacht
// vor (rejectet mit sprechender Meldung). Der Timer wird immer freigegeben (kein Leak).
function withWatchdog(promise, label) {
  let timer;
  const watchdog = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Watchdog: ${label} settelte nicht in ${WATCHDOG_MS}ms (Deadlock-Verdacht)`)),
      WATCHDOG_MS,
    );
  });
  return Promise.race([promise, watchdog]).finally(() => clearTimeout(timer));
}

let store;
before(async () => {
  process.env.DATA_DIR = tempDataDir();
  store = await import("../src/store.js");
});

// T1 (Kern): direkter verschachtelter Aufruf -> synchroner reentrant-Throw, KEIN Deadlock.
test("T1: verschachtelter withStoreLock-Aufruf lehnt sofort mit reentrant-Fehler ab", async () => {
  const nested = store.withStoreLock(() => store.withStoreLock(() => "unerreichbar"));
  await assert.rejects(
    withWatchdog(nested, "verschachtelter withStoreLock"),
    /reentrant/i,
    "verschachtelter Aufruf muss reentrant-abgelehnt werden, nicht deadlocken",
  );
});

// T2 (kein prozessweites Einfrieren): nach dem gescheiterten Nest laeuft der naechste Lock normal.
test("T2: nach gescheitertem verschachteltem Aufruf laeuft ein folgender withStoreLock normal", async () => {
  await store.withStoreLock(() => store.withStoreLock(() => null)).catch(() => {});
  const result = await withWatchdog(
    store.withStoreLock(() => "ok"),
    "folgender unabhaengiger withStoreLock",
  );
  assert.equal(result, "ok", "der Lock nimmt nach einem reentrant-Fehler weitere Laeufe an (kein Freeze)");
});

// T3 (kein false-positive): zwei parallele, NICHT verschachtelte Aufrufe -> beide erfolgreich,
// serialisiert (nie gleichzeitig im Body). Beweist, dass der Guard echte Nebenlaeufigkeit nicht
// faelschlich abweist (die gefaehrlichste Regression).
test("T3: zwei parallele nicht verschachtelte Aufrufe laufen beide durch und serialisiert", async () => {
  let active = 0;
  let maxConcurrent = 0;
  const order = [];
  const body = (tag) => async () => {
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    order.push(`${tag}-start`);
    await Promise.resolve(); // await-Schicht: ohne haltenden Lock wuerden A und B sich hier verschraenken
    order.push(`${tag}-end`);
    active -= 1;
    return tag;
  };
  const [a, b] = await withWatchdog(
    Promise.all([store.withStoreLock(body("A")), store.withStoreLock(body("B"))]),
    "zwei parallele withStoreLock",
  );
  assert.equal(a, "A", "erster Aufruf liefert sein Ergebnis (kein false-positive-Throw)");
  assert.equal(b, "B", "zweiter Aufruf liefert sein Ergebnis (kein false-positive-Throw)");
  assert.equal(maxConcurrent, 1, "die Bodies laufen serialisiert, nie gleichzeitig");
  assert.deepEqual(
    order,
    ["A-start", "A-end", "B-start", "B-end"],
    "serielle Reihenfolge, kein Interleave zwischen den Bodies",
  );
});

// T4 (transitiv/tief): der Marker ueberlebt eine await-Schicht im Body -> auch der spaetere,
// nach dem await abgesetzte verschachtelte Aufruf wird erkannt (das kann ein Modul-Flag nicht).
test("T4: Reentrancy wird auch ueber eine await-Schicht hinweg erkannt", async () => {
  const nested = store.withStoreLock(async () => {
    await Promise.resolve();
    return store.withStoreLock(() => "unerreichbar");
  });
  await assert.rejects(
    withWatchdog(nested, "transitiv verschachtelter withStoreLock"),
    /reentrant/i,
    "auch nach einem await im Body muss der verschachtelte Aufruf reentrant-abgelehnt werden",
  );
});
