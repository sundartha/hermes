import assert from "node:assert/strict";
import test from "node:test";

import { vorspannZustand } from "../../src/store.js";

const TTL_MS = 120_000;
const ANRUF = { tenantId: "t_ereignis", callId: "call_ereignis" };
const ANDERER = { tenantId: "t_ereignis", callId: "call_andere" };

test("Speicher-Zustand: frisch angelegt ist die Zeile ohne Bein, ohne Marken und nicht abgehoben, und eine Kopie ändert sie nicht", async () => {
  await vorspannZustand.anlegen({ ...ANRUF, token: "tok", text: "Satz", ttlMs: TTL_MS });
  const zeile = await vorspannZustand.lade(ANRUF);
  assert.deepEqual(zeile, { calleeId: null, token: "tok", text: "Satz", stand: {}, aufgelegt: [], abgehoben: false });
  zeile.stand.ABGEHOBEN = 1;
  assert.deepEqual((await vorspannZustand.lade(ANRUF)).stand, {});
  assert.equal(await vorspannZustand.lade(ANDERER), undefined);
  await vorspannZustand.loesche(ANRUF);
});

test("Speicher-Zustand: die erste Bein-Kennung gewinnt, und ohne Zeile gibt es keine", async () => {
  await vorspannZustand.anlegen({ ...ANRUF, token: "tok", text: "Satz", ttlMs: TTL_MS });
  assert.equal(await vorspannZustand.setzeCallee({ ...ANRUF, calleeId: "cc_eins" }), "cc_eins");
  assert.equal(await vorspannZustand.setzeCallee({ ...ANRUF, calleeId: "cc_zwei" }), "cc_eins");
  assert.equal((await vorspannZustand.lade(ANRUF)).calleeId, "cc_eins");
  assert.equal(await vorspannZustand.setzeCallee({ ...ANDERER, calleeId: "cc_drei" }), undefined);
  await vorspannZustand.loesche(ANRUF);
});

test("Speicher-Zustand: das Abheben lässt sich nur einmal beanspruchen", async () => {
  await vorspannZustand.anlegen({ ...ANRUF, token: "tok", text: "Satz", ttlMs: TTL_MS });
  assert.equal(await vorspannZustand.beanspruecheAbgehoben(ANRUF), true);
  assert.equal(await vorspannZustand.beanspruecheAbgehoben(ANRUF), false);
  assert.equal((await vorspannZustand.lade(ANRUF)).abgehoben, true);
  assert.equal(await vorspannZustand.beanspruecheAbgehoben(ANDERER), false);
  await vorspannZustand.loesche(ANRUF);
});

test("Speicher-Zustand: gespeicherte Marken bleiben, neue kommen dazu, die aufgelegten Beine ersetzt der neue Stand", async () => {
  await vorspannZustand.anlegen({ ...ANRUF, token: "tok", text: "Satz", ttlMs: TTL_MS });
  await vorspannZustand.speichere({ ...ANRUF, stand: { ABGEHOBEN: 1 }, aufgelegt: ["cc_eins", "cc_zwei"] });
  await vorspannZustand.speichere({ ...ANRUF, stand: { ABGEHOBEN: 9, WIEDERGABE: 2 }, aufgelegt: ["cc_zwei"] });
  const zeile = await vorspannZustand.lade(ANRUF);
  assert.deepEqual(zeile.stand, { ABGEHOBEN: 1, WIEDERGABE: 2 });
  assert.deepEqual(zeile.aufgelegt, ["cc_zwei"]);
  await vorspannZustand.speichere({ ...ANDERER, stand: { ABGEHOBEN: 1 }, aufgelegt: [] });
  assert.equal(await vorspannZustand.lade(ANDERER), undefined);
  await vorspannZustand.loesche(ANRUF);
});
