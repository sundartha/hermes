import { test } from "node:test";
import assert from "node:assert/strict";
import { laufClients, starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const HTTP_OK = 200;

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: ["kennzahlen_leser"],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
  ohneStartanruf: true,
});

test("Ohne KENNZAHLEN_DATABASE_URL startet der Lauf nicht, auch wenn Sicht und Rolle da sind", async () => {
  const hermes = laufendesHermes();
  assert.equal((await hermes.anfrage("/healthz")).status, HTTP_OK);
  const sicht = await hermes.db.query("SELECT to_regclass('kennzahlen.messwerte') AS sicht");
  assert.equal(sicht.rows[0].sicht, "kennzahlen.messwerte");
  const store = await import("../../src/store.js");
  assert.equal(store.kennzahlenMomentaufnahme(), null);
  assert.equal(laufClients.length, 0);
});
