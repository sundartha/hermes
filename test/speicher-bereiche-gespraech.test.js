import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../src/store.js";

const ANRUF = "call_gespraech_1";

const GESPRAECH = [
  ["getCall", [ANRUF], { id: ANRUF, status: "active" }],
  ["countCallerTurn", [ANRUF], { id: ANRUF, callerTurns: 3 }],
];

function attrappe(tabelle) {
  const aufrufe = [];
  const speicher = {};
  for (const [name, , ergebnis] of tabelle) {
    speicher[name] = (...args) => {
      aufrufe.push([name, ...args]);
      return ergebnis;
    };
  }
  return { speicher, aufrufe };
}

test("gespraech: jede Bereichsfunktion liefert ein Promise mit Argumenten und Ergebnis der Speicherfunktion", async () => {
  const { speicher, aufrufe } = attrappe(GESPRAECH);
  const funktionen = speicherBereiche(speicher).gespraech;
  assert.deepEqual(Object.keys(funktionen), GESPRAECH.map(([name]) => name));
  for (const [name, args, ergebnis] of GESPRAECH) {
    const antwort = funktionen[name](...args);
    assert.ok(antwort instanceof Promise, name);
    assert.deepEqual(await antwort, ergebnis, name);
  }
  assert.deepEqual(aufrufe, GESPRAECH.map(([name, args]) => [name, ...args]));
});

test("gespraech: Speicherfunktionen werden erst beim Aufruf gelesen und ein Wurf wird zur Ablehnung", async () => {
  const { speicher } = attrappe(GESPRAECH);
  const funktionen = speicherBereiche(speicher).gespraech;
  speicher.getCall = () => "spaet";
  assert.equal(await funktionen.getCall(ANRUF), "spaet");
  speicher.countCallerTurn = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(funktionen.countCallerTurn(ANRUF), /kaputt/);
});
