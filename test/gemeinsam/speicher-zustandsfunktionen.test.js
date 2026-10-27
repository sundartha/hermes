import assert from "node:assert/strict";
import { test } from "node:test";

import * as fassade from "../../src/store.js";
import { makePgTestStore } from "../pg-helpers.js";

test("jede Zustandsfunktion der Fassade gibt es auch im Postgres-Teststore", async () => {
  const { store } = await makePgTestStore();
  const namen = Object.keys(fassade.zustandsFunktionen(store));
  assert.ok(namen.length > 0, "zustandsFunktionen bindet keine Funktion");
  for (const name of namen) {
    assert.equal(typeof fassade[name], "function", `${name} fehlt in src/store.js`);
    assert.equal(typeof store[name], "function", `${name} fehlt im Postgres-Teststore`);
  }
});

test("anrufpauseAktiv liest im Postgres-Teststore den zuletzt gesetzten Wert", async () => {
  const { store } = await makePgTestStore();
  assert.equal(store.anrufpauseAktiv(), false);
  await store.setzeAnrufpause(true);
  assert.equal(store.anrufpauseAktiv(), true);
});
