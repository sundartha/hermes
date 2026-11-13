import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { anrufEinfuegen, zeitpunkt } from "./kennzahlen-anrufe.js";

const ROLLE = "kennzahlen_leser";

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: [ROLLE],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
  kennzahlenAdresse: "postgres://app-rolle-attrappe.invalid/hermes",
  ohneStartanruf: true,
});

await anrufEinfuegen(laufendesHermes().db, {
  status: "completed",
  started_at: zeitpunkt(0, "09:00:00"),
  answered_at: zeitpunkt(0, "09:01:00"),
  ended_at: zeitpunkt(0, "09:05:00"),
});

test("S20: verbindet die Adresse mit der App-Rolle, meldet der Lauf keinen Messwert und nennt nur einen Code", async () => {
  const zeilen = [];
  mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const store = await import("../../src/store.js");
  await store.kennzahlenTakt();
  mock.restoreAll();
  assert.equal(store.kennzahlenMomentaufnahme(), null);
  assert.deepEqual(zeilen, ["[kennzahlen] Lauf fehlgeschlagen: KENNZAHLEN_ROLLE"]);
});
