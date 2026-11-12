import { test } from "node:test";
import assert from "node:assert/strict";
import { laufClients, starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const HTTP_OK = 200;
const logzeilen = [];
const echtesLog = console.log;
console.log = (...teile) => {
  logzeilen.push(teile.join(" "));
  echtesLog(...teile);
};

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  clientBruecke: true,
  kennzahlenAdresse: "postgres://kennzahlen-leser-attrappe.invalid/hermes",
  ohneStartanruf: true,
});

test("B3: ohne Leserolle startet Hermes, die Sicht fehlt, und der Lauf meldet nichts", async () => {
  const hermes = laufendesHermes();
  assert.equal((await hermes.anfrage("/healthz")).status, HTTP_OK);
  assert.ok(logzeilen.includes("[migrate] kennzahlen übersprungen: Rolle fehlt"));
  const sicht = await hermes.db.query("SELECT to_regclass('kennzahlen.messwerte') AS sicht");
  assert.equal(sicht.rows[0].sicht, null);
  const store = await import("../../src/store.js");
  assert.equal(store.kennzahlenMomentaufnahme(), null);
  assert.equal(laufClients.length, 0, "ohne Rolle öffnet der Lauf keine Verbindung");
});
