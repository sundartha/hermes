import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "../pg-helpers.js";

function abschnitt(spur, name) {
  return async () => {
    spur.push(`${name} rein`);
    await new Promise((weiter) => setImmediate(weiter));
    spur.push(`${name} raus`);
    return name;
  };
}

test("PG-Teststore: zwei gleichzeitige Abschnitte unter withStoreLock laufen nacheinander", async () => {
  const { store } = await makePgTestStore();
  const spur = [];
  const ergebnisse = await Promise.all([
    store.withStoreLock(abschnitt(spur, "erster")),
    store.withStoreLock(abschnitt(spur, "zweiter")),
  ]);
  assert.deepEqual(ergebnisse, ["erster", "zweiter"]);
  assert.deepEqual(spur, ["erster rein", "erster raus", "zweiter rein", "zweiter raus"]);
});

test("PG-Teststore: withStoreLock innerhalb von withStoreLock wirft den Verschachtelungsfehler", async () => {
  const { store } = await makePgTestStore();
  const verschachtelt = store.withStoreLock(async () => {
    await Promise.resolve();
    return store.withStoreLock(() => "nie");
  });
  const verklemmt = new Promise((weiter) => setImmediate(weiter, "verklemmt"));
  const ausgang = await Promise.race([verschachtelt, verklemmt]).catch((fehler) => fehler.message);
  assert.equal(
    ausgang,
    "withStoreLock reentrant: ein withStoreLock-Body darf NIE erneut withStoreLock aufrufen " +
      "(Deadlock-Schutz). Verschachtelten Store-Lock aufloesen; kritischen Abschnitt kurz halten.",
  );
  assert.equal(await store.withStoreLock(() => "danach frei"), "danach frei");
});

test("PG-Teststore: ein haengender Abschnitt im einen Store blockiert einen zweiten Store nicht", async () => {
  const { store: erster } = await makePgTestStore();
  const { store: zweiter } = await makePgTestStore();
  let freigeben;
  const haengt = erster.withStoreLock(() => new Promise((weiter) => (freigeben = weiter)));
  const frist = new Promise((weiter) => setImmediate(weiter, "blockiert"));
  try {
    const zweiterLauf = zweiter.withStoreLock(() => "zweiter frei");
    assert.equal(await Promise.race([zweiterLauf, frist]), "zweiter frei");
  } finally {
    freigeben?.("erster fertig");
  }
  assert.equal(await haengt, "erster fertig");
});
