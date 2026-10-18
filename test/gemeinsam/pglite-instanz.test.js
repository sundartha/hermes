import { test } from "node:test";
import assert from "node:assert/strict";
import { abfragenZaehlendeHuelle } from "./pglite-instanz.js";

function datenbankAttrappe() {
  const aufrufe = [];
  const offen = [];
  const merke = (name) => (...argumente) => {
    aufrufe.push([name, ...argumente]);
    return new Promise((resolve) => offen.push(resolve));
  };
  const pg = { query: merke("query"), exec: merke("exec"), transaction: merke("transaction"), sql: merke("sql") };
  return { pg, aufrufe, alleBeenden: () => offen.forEach((resolve) => resolve()) };
}

async function pruefeAbfrageart(name, argumente) {
  const { pg, aufrufe, alleBeenden } = datenbankAttrappe();
  const laufend = new Set();
  const ergebnis = abfragenZaehlendeHuelle(pg, laufend)[name](...argumente);

  assert.deepEqual(aufrufe, [[name, ...argumente]], `${name} bekommt nicht alle Argumente`);
  assert.equal(laufend.size, 1, `${name} läuft am Zähler vorbei`);
  alleBeenden();
  await ergebnis;
  await Promise.resolve();
  assert.equal(laufend.size, 0, `${name} bleibt nach dem Ende gezählt`);
}

test("query: alle Argumente kommen an, und die Abfrage zählt, bis sie fertig ist", () =>
  pruefeAbfrageart("query", ["SELECT $1", [1], { rowMode: "array" }]));

test("exec: alle Argumente kommen an, und die Abfrage zählt, bis sie fertig ist", () =>
  pruefeAbfrageart("exec", ["SELECT 1", { rowMode: "array" }]));

test("transaction: alle Argumente kommen an, und die Abfrage zählt, bis sie fertig ist", () =>
  pruefeAbfrageart("transaction", [async () => {}]));

test("sql: alle Argumente kommen an, und die Abfrage zählt, bis sie fertig ist", () =>
  pruefeAbfrageart("sql", [["SELECT ", ""], 1]));
