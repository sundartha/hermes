import { test } from "node:test";
import assert from "node:assert/strict";
import { newId } from "../../src/store.js";

const FESTER_ZUFALL = 0.123456789;
const UHR_MS = 1_900_000_000_000;

test("newId bleibt eindeutig, wenn die Uhr zwischen zwei Aufrufen springt", (t) => {
  t.mock.method(Math, "random", () => FESTER_ZUFALL);
  const folge = [UHR_MS, UHR_MS, UHR_MS, UHR_MS + 1];
  let i = 0;
  t.mock.method(Date, "now", () => folge[Math.min(i++, folge.length - 1)]);
  const erste = newId("n");
  const zweite = newId("n");
  assert.notEqual(erste, zweite);
});

test("newId liefert Präfix, Zeit in Base36 und vier Zufallsstellen", (t) => {
  t.mock.method(Math, "random", () => FESTER_ZUFALL);
  t.mock.method(Date, "now", () => UHR_MS + 5);
  assert.equal(newId("n"), `n_${(UHR_MS + 5).toString(36)}${FESTER_ZUFALL.toString(36).slice(2, 6)}`);
});
