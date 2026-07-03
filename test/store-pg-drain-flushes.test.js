// F11 (Review-Blocker Runde 1, S1-B): store.save() (pg-Backend) haengt seinen DB-Write an
// eine asynchrone flushChain und gibt GENAU EINE fruehe Referenz zurueck. Feuert waehrend
// eines await auf diese Referenz ein unabhaengiger Hintergrund-Timer (Max-Dauer-Cap/Reserve-
// Release, server.js) und ruft selbst save() auf, haengt sich dessen Flush HINTER der
// bereits zurueckgegebenen Referenz ein - "await store.save()" allein wuerde diesen
// spaeteren Flush nie abwarten. drainFlushes() muss ihn abwarten.
//
// Reine Chain-Mechanik-Pruefung (kein Server-Spawn): pglite = Postgres-in-WASM, offline
// (F.I.R.S.T.). ISOLATION: pglite NIE mit einem Server-Spawn in derselben Datei (P3/P6a-Lehre).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "./pg-helpers.js";

test("drainFlushes() wartet auf einen erst waehrend eines laufenden Awaits angehaengten Flush (S1-B)", async () => {
  const { store, runner } = await makePgTestStore();

  // runner.withClient instrumentieren: zaehlt abgeschlossene Aufrufe UND haelt den ERSTEN
  // kuenstlich an (simuliert einen noch laufenden DB-Write, waehrend dessen der Hintergrund-
  // Timer feuert). Die Ersetzung wirkt, weil pg.js runner.withClient(...) PRO AUFRUF ueber
  // die Objektreferenz liest (kein Destructuring beim makePgStore-Aufbau, siehe store/pg.js).
  const completed = [];
  let releaseFirstFlush;
  const firstFlushGate = new Promise((resolve) => (releaseFirstFlush = resolve));
  const realWithClient = runner.withClient.bind(runner);
  let invocationCount = 0;
  runner.withClient = async (fn) => {
    const thisInvocation = ++invocationCount;
    if (thisInvocation === 1) await firstFlushGate;
    const result = await realWithClient(fn);
    completed.push(thisInvocation);
    return result;
  };

  // save() #1 - repraesentiert gracefulShutdown's eigenen finalen store.save()-Aufruf.
  const shutdownSave = store.save();
  // Die Fortsetzung NACH "await store.save()" in gracefulShutdown - SOFORT (synchron) an
  // shutdownSave gehaengt, damit die Registrierungsreihenfolge auf der Promise exakt die
  // reale Reihenfolge spiegelt: gracefulShutdown wartet zuerst, der Hintergrund-Timer
  // feuert (und reiht sich ein) erst DANACH.
  const snapshotAtResume = [];
  const shutdownResumed = shutdownSave.then(() => snapshotAtResume.push(...completed));

  // Hintergrund-Timer "feuert waehrend des awaits": ein zweiter, unabhaengiger save()-Aufruf
  // haengt sich HINTER der bereits zurueckgegebenen Referenz ein (store/pg.js: save() haengt
  // IMMER an der AKTUELLEN flushChain, unabhaengig davon, wer eine fruehere Referenz haelt).
  setTimeout(() => store.save(), 0);
  // Den ersten (kuenstlich verzoegerten) Flush erst freigeben, NACHDEM sich der Timer oben
  // bereits eingereiht hat (0ms vor 15ms -> deterministische Reihenfolge, kein Polling noetig).
  setTimeout(releaseFirstFlush, 15);

  await shutdownResumed;
  assert.deepEqual(
    snapshotAtResume,
    [1],
    "Zum Zeitpunkt der alten Fortsetzung (nach 'await store.save()') darf erst EIN Flush " +
      "abgeschlossen sein - der Bug wuerde process.exit() genau hier ausloesen, waehrend " +
      "Flush #2 noch nicht einmal begonnen hat",
  );

  await store.drainFlushes();
  assert.deepEqual(
    completed,
    [1, 2],
    "drainFlushes() muss auch den waehrend des ersten Awaits neu angehaengten Flush abwarten",
  );
});
