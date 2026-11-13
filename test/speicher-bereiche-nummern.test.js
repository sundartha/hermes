import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../src/store.js";

const NUMMERN = [
  ["nummerntauschKandidaten", [{ platformAniE164: "+4930123" }], [{ id: "num_1" }]],
  ["ersatzNummerAnfordern", [{ oldNumberId: "num_1", maxNumbers: 3 }], { ok: true, purchase: false }],
  ["registrierungAnhaengen", ["num_1", "phn_1"], { id: "num_1" }],
  ["markNumberElInboundTrunkBelegt", ["num_1", { nowIso: "2026-11-13T10:00:00.000Z", zugangFp: "fp" }], { id: "num_1" }],
  ["clearNumberElInboundTrunkBeleg", ["num_1"], { id: "num_1" }],
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

test("nummern: jede Bereichsfunktion liefert ein Promise mit Argumenten und Ergebnis der Speicherfunktion", async () => {
  const { speicher, aufrufe } = attrappe(NUMMERN);
  speicher.load = () => ({ numbers: [] });
  const funktionen = speicherBereiche(speicher).nummern;
  assert.deepEqual(Object.keys(funktionen), [...NUMMERN.map(([name]) => name), "aktiveNummern"]);
  for (const [name, args, ergebnis] of NUMMERN) {
    const antwort = funktionen[name](...args);
    assert.ok(antwort instanceof Promise, name);
    assert.deepEqual(await antwort, ergebnis, name);
  }
  assert.deepEqual(aufrufe, NUMMERN.map(([name, args]) => [name, ...args]));
});

test("nummern: aktiveNummern liefert nur Nummern im Status active, in der Reihenfolge des Zustands", async () => {
  const zustand = {
    numbers: [
      { id: "a", status: "active" },
      { id: "b", status: "released" },
      { id: "c", status: "requested" },
      { id: "d", status: "active" },
      { id: "e", status: "suspended" },
    ],
  };
  const antwort = speicherBereiche({ load: () => zustand }).nummern.aktiveNummern();
  assert.ok(antwort instanceof Promise);
  assert.deepEqual((await antwort).map(({ id }) => id), ["a", "d"]);
});

test("nummern: Speicherfunktionen werden erst beim Aufruf gelesen", async () => {
  const { speicher } = attrappe(NUMMERN);
  const funktionen = speicherBereiche(speicher).nummern;
  speicher.registrierungAnhaengen = () => "spaet";
  assert.equal(await funktionen.registrierungAnhaengen("num_1", "phn_1"), "spaet");
});

test("nummern: ein Wurf der Speicherfunktion wird zur Ablehnung", async () => {
  const { speicher } = attrappe(NUMMERN);
  const funktionen = speicherBereiche(speicher).nummern;
  speicher.ersatzNummerAnfordern = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(funktionen.ersatzNummerAnfordern({ oldNumberId: "x", maxNumbers: 1 }), /kaputt/);
});
