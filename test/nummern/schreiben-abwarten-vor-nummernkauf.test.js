import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";

function speicherMit(nummernSql) {
  const ereignisse = [];
  const speicher = {
    nummernSql: () => nummernSql,
    drainFlushes: async () => {
      ereignisse.push("drain");
    },
  };
  return { ereignisse, bereich: speicherBereiche(speicher).nummernkauf };
}

test("schreibenAbwarten wartet im pg-Speicher genau einmal auf die ausstehenden Gesamt-Flushes", async () => {
  const { ereignisse, bereich } = speicherMit({});
  const antwort = bereich.schreibenAbwarten();
  assert.ok(antwort instanceof Promise);
  await antwort;
  assert.deepEqual(ereignisse, ["drain"]);
});

test("schreibenAbwarten tut mit dem JSON-Speicher nichts", async () => {
  const { ereignisse, bereich } = speicherMit(null);
  await bereich.schreibenAbwarten();
  assert.deepEqual(ereignisse, []);
});

test("schreibenAbwarten reicht einen Fehler des Flush weiter, damit nichts gekauft wird", async () => {
  const speicher = {
    nummernSql: () => ({}),
    drainFlushes: async () => {
      throw new Error("flush kaputt");
    },
  };
  await assert.rejects(speicherBereiche(speicher).nummernkauf.schreibenAbwarten(), /flush kaputt/);
});
