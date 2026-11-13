import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../src/store.js";

const ANRUF = "call_posteingang_1";

const POSTEINGANG = [
  ["callActionItems", [ANRUF], [{ text: "Rueckruf" }]],
  ["addActionItem", [ANRUF, "Rueckruf", "todo"], { duplicate: false }],
  ["markInboxEntry", [ANRUF, true], { id: ANRUF }],
  ["takeInboxEntries", ["owner", { limit: 20, includeSeen: false }], { entries: [], remaining: 0, marked: 0 }],
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

test("posteingang: jede Bereichsfunktion liefert ein Promise mit Argumenten und Ergebnis der Speicherfunktion", async () => {
  const { speicher, aufrufe } = attrappe(POSTEINGANG);
  const funktionen = speicherBereiche(speicher).posteingang;
  assert.deepEqual(Object.keys(funktionen), POSTEINGANG.map(([name]) => name));
  for (const [name, args, ergebnis] of POSTEINGANG) {
    const antwort = funktionen[name](...args);
    assert.ok(antwort instanceof Promise, name);
    assert.deepEqual(await antwort, ergebnis, name);
  }
  assert.deepEqual(aufrufe, POSTEINGANG.map(([name, args]) => [name, ...args]));
});

test("posteingang: Speicherfunktionen werden erst beim Aufruf gelesen", async () => {
  const { speicher } = attrappe(POSTEINGANG);
  const funktionen = speicherBereiche(speicher).posteingang;
  speicher.callActionItems = () => "spaet";
  assert.equal(await funktionen.callActionItems(ANRUF), "spaet");
});

test("posteingang: ein Wurf der Speicherfunktion wird zur Ablehnung", async () => {
  const { speicher } = attrappe(POSTEINGANG);
  const funktionen = speicherBereiche(speicher).posteingang;
  speicher.markInboxEntry = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(funktionen.markInboxEntry(ANRUF, true), /kaputt/);
});
