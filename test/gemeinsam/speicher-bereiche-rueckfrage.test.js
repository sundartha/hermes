import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";

const ANRUF = "call_rueckfrage_1";

const RUECKFRAGE = [
  ["ackConsult", [ANRUF, { eventId: "c0" }], { outcome: "accepted" }],
  ["answerConsult", [ANRUF, { eventId: "c0", facts: ["Freitag"] }], { outcome: "accepted", mergedFacts: 1 }],
  ["emitConsult", [ANRUF, ["Passt Freitag?"]], { id: ANRUF }],
  ["advanceInCallConsult", [ANRUF, { nowMs: 5, waitMs: 6, openMs: 7 }], "hold"],
  ["noteConsultPoll", [ANRUF], undefined],
  ["markConsultAskDelivered", [ANRUF, "c0"], undefined],
  ["pendingConsult", [ANRUF, "c-1"], { id: "c0", questions: ["Frage"] }],
  ["timeOutStagedConsult", [ANRUF, { consultId: "c0", reason: "stufe", nowMs: 9, stageMs: 3 }], undefined],
];

const RECHERCHE = [
  ["addLookupFacts", [ANRUF, ["Fakt eins"]], 1],
  ["finishCallLookup", [ANRUF, 2, { ok: true, factCount: 1, dauerMs: 40 }], undefined],
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

for (const [bereich, tabelle] of [
  ["rueckfrage", RUECKFRAGE],
  ["recherche", RECHERCHE],
]) {
  test(`${bereich}: jede Bereichsfunktion liefert ein Promise mit Argumenten und Ergebnis der Speicherfunktion`, async () => {
    const { speicher, aufrufe } = attrappe(tabelle);
    const funktionen = speicherBereiche(speicher)[bereich];
    assert.deepEqual(Object.keys(funktionen), tabelle.map(([name]) => name));
    for (const [name, args, ergebnis] of tabelle) {
      const antwort = funktionen[name](...args);
      assert.ok(antwort instanceof Promise, name);
      assert.deepEqual(await antwort, ergebnis, name);
    }
    assert.deepEqual(aufrufe, tabelle.map(([name, args]) => [name, ...args]));
  });

  test(`${bereich}: Speicherfunktionen werden erst beim Aufruf gelesen`, async () => {
    const { speicher } = attrappe(tabelle);
    const funktionen = speicherBereiche(speicher)[bereich];
    const [name, args] = tabelle[0];
    speicher[name] = () => "spaet";
    assert.equal(await funktionen[name](...args), "spaet");
  });

  test(`${bereich}: ein Wurf der Speicherfunktion wird zur Ablehnung`, async () => {
    const { speicher } = attrappe(tabelle);
    const funktionen = speicherBereiche(speicher)[bereich];
    const [name, args] = tabelle[0];
    speicher[name] = () => {
      throw new Error("kaputt");
    };
    await assert.rejects(funktionen[name](...args), /kaputt/);
  });
}
