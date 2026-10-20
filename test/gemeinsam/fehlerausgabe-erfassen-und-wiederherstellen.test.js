import assert from "node:assert/strict";
import test from "node:test";

import { fehlerausgabeVon, fehlerausgabeVonAsync } from "./fehlerausgabe.js";

const ERWARTETE_ZEILE = "Fehler undefined null 42";

function meldeMitLuecken() {
  console.error("Fehler", undefined, null, 42);
}

async function meldeNachWarten() {
  await Promise.resolve();
  meldeMitLuecken();
}

async function mitMarke(pruefung) {
  const bisher = console.error;
  const marke = () => {};
  console.error = marke;
  try {
    await pruefung();
    assert.equal(
      console.error,
      marke,
      "console.error muss nach der Aufgabe wieder die vorherige Funktion sein",
    );
  } finally {
    console.error = bisher;
  }
}

test("fehlerausgabeVon liefert die Zeilen samt undefined und null und stellt console.error nach erfüllter Aufgabe wieder her", () =>
  mitMarke(() => {
    assert.deepEqual(fehlerausgabeVon(meldeMitLuecken), [ERWARTETE_ZEILE]);
  }));

test("fehlerausgabeVon stellt console.error auch wieder her, wenn die Aufgabe wirft", () =>
  mitMarke(() => {
    const wirft = () => {
      meldeMitLuecken();
      throw new Error("Aufgabe kaputt");
    };
    assert.throws(() => fehlerausgabeVon(wirft), /Aufgabe kaputt/);
  }));

test("fehlerausgabeVonAsync wartet auf die Aufgabe, liefert die Zeilen samt undefined und null und stellt console.error wieder her", () =>
  mitMarke(async () => {
    assert.deepEqual(await fehlerausgabeVonAsync(meldeNachWarten), [ERWARTETE_ZEILE]);
  }));

test("fehlerausgabeVonAsync stellt console.error auch wieder her, wenn die Aufgabe abgelehnt wird", () =>
  mitMarke(async () => {
    const lehntAb = async () => {
      await meldeNachWarten();
      throw new Error("Aufgabe abgelehnt");
    };
    await assert.rejects(fehlerausgabeVonAsync(lehntAb), /Aufgabe abgelehnt/);
  }));
