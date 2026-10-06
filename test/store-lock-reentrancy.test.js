import { test, before } from "node:test";
import assert from "node:assert/strict";
import { tempDataDir } from "./helpers.js";

const WATCHDOG_MS = 1000;

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

test("T1: verschachtelter withStoreLock-Aufruf lehnt sofort mit reentrant-Fehler ab", async () => {
  const nested = store.withStoreLock(() => store.withStoreLock(() => "unerreichbar"));
  await assert.rejects(
    withWatchdog(nested, "verschachtelter withStoreLock"),
    /reentrant/i,
    "verschachtelter Aufruf muss reentrant-abgelehnt werden, nicht deadlocken",
  );
});

test("T2: nach gescheitertem verschachteltem Aufruf laeuft ein folgender withStoreLock normal", async () => {
  await store.withStoreLock(() => store.withStoreLock(() => null)).catch(() => {});
  const result = await withWatchdog(
    store.withStoreLock(() => "ok"),
    "folgender unabhaengiger withStoreLock",
  );
  assert.equal(result, "ok", "der Lock nimmt nach einem reentrant-Fehler weitere Laeufe an (kein Freeze)");
});

test("T3: zwei parallele nicht verschachtelte Aufrufe laufen beide durch und serialisiert", async () => {
  let active = 0;
  let maxConcurrent = 0;
  const order = [];
  const body = (tag) => async () => {
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    order.push(`${tag}-start`);
    await Promise.resolve();
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
