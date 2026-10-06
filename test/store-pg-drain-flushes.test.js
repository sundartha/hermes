import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "./pg-helpers.js";

test("drainFlushes() wartet auf einen erst waehrend eines laufenden Awaits angehaengten Flush (S1-B)", async () => {
  const { store, runner } = await makePgTestStore();

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

  const shutdownSave = store.save();
  const snapshotAtResume = [];
  const shutdownResumed = shutdownSave.then(() => snapshotAtResume.push(...completed));

  setTimeout(() => store.save(), 0);
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

test("S1-2: drainFlushes() wirft den Fehler eines fehlgeschlagenen letzten Flush und cleart ihn nach Erfolg", async () => {
  const { store, runner } = await makePgTestStore();
  const realWithClient = runner.withClient.bind(runner);
  let failNext = false;
  runner.withClient = async (fn) => {
    if (failNext) {
      failNext = false;
      throw new Error("DB weg (Test)");
    }
    return realWithClient(fn);
  };

  store.save();
  await assert.doesNotReject(store.drainFlushes(), "sauberer Flush -> drainFlushes resolvt");

  failNext = true;
  store.save();
  await assert.rejects(
    store.drainFlushes(),
    /DB weg \(Test\)/,
    "fehlgeschlagener letzter Flush -> drainFlushes wirft",
  );

  store.save();
  await assert.doesNotReject(
    store.drainFlushes(),
    "erfolgreicher Folge-Flush cleart den Fehler (Voll-Upsert, nur letzter Flush zaehlt)",
  );
});
