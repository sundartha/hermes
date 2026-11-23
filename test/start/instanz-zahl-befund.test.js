import assert from "node:assert/strict";
import { test } from "node:test";
import { instanzZahlFindings } from "../../src/boot-guard.ts";

function befundeZaehlen(eingabe) {
  const befunde = instanzZahlFindings(eingabe);
  for (const befund of befunde) assert.equal(befund.fatal, false);
  return befunde.length;
}

test("Instanzzahl: weniger lebende als eingestellt ergibt 0 Befund(e)", () => {
  assert.equal(befundeZaehlen({ serverInstanzen: 3, eigene: "a", lebende: ["a", "b"] }), 0);
});

test("Instanzzahl: genau so viele lebende wie eingestellt ergibt 0 Befund(e)", () => {
  assert.equal(befundeZaehlen({ serverInstanzen: 2, eigene: "a", lebende: ["a", "b"] }), 0);
});

test("Instanzzahl: eine mehr als eingestellt ergibt 1 Befund(e)", () => {
  assert.equal(befundeZaehlen({ serverInstanzen: 1, eigene: "a", lebende: ["a", "b"] }), 1);
});

test("Instanzzahl: Lebenszeichen nicht lesbar ergibt 0 Befund(e)", () => {
  assert.equal(befundeZaehlen({ serverInstanzen: 1, eigene: "a", lebende: null }), 0);
});

test("Instanzzahl: eigene Kennung fehlt noch in der Liste und zaehlt mit ergibt 1 Befund(e)", () => {
  assert.equal(befundeZaehlen({ serverInstanzen: 1, eigene: "a", lebende: ["b"] }), 1);
});

test("Instanzzahl: eigene Kennung wird nicht doppelt gezaehlt ergibt 0 Befund(e)", () => {
  assert.equal(befundeZaehlen({ serverInstanzen: 2, eigene: "a", lebende: ["a", "a", "b"] }), 0);
});

test("Instanzzahl: der Befund nennt SERVER_INSTANCES und beide Zahlen", () => {
  const [befund] = instanzZahlFindings({ serverInstanzen: 1, eigene: "a", lebende: ["a", "b", "c"] });
  assert.equal(
    befund.message,
    "SERVER_INSTANCES=1, aber 3 Instanzen leben - das Rate-Limit je Instanz ist dann in Summe zu gross. SERVER_INSTANCES auf die tatsaechliche Instanzzahl setzen.",
  );
});
