import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { anrufEinfuegen, zeitpunkt } from "./kennzahlen-anrufe.js";

const ROLLE = "kennzahlen_leser";
const ADRESSE = "postgres://kennzahlen-leser-attrappe.invalid/hermes";

const FESTE_MENGE = {
  richtung: ["", "inbound", "outbound"],
  ergebnis: ["", "angenommen", "nicht_angenommen", "besetzt", "fehlgeschlagen", "laufend", "sonstige"],
  ziel: ["", "erreicht", "nicht_erreicht", "unbekannt"],
  plan: ["", "starter", "business"],
};

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: [ROLLE],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
  unterKennzahlenLeser: true,
  kennzahlenAdresse: ADRESSE,
  ohneStartanruf: true,
});

async function zeilenMitZusammenfassung(text) {
  const { db } = laufendesHermes();
  await db.transaction(async (transaktion) => {
    await transaktion.query("SELECT set_config('app.current_tenant', (SELECT id FROM tenant ORDER BY created_at LIMIT 1), true)");
    await transaktion.query("DELETE FROM call");
  });
  await anrufEinfuegen(db, { answered_at: zeitpunkt(0, "09:01:00"), ended_at: zeitpunkt(0, "09:05:00") });
  await db.transaction(async (transaktion) => {
    await transaktion.query("SELECT set_config('app.current_tenant', (SELECT id FROM tenant ORDER BY created_at LIMIT 1), true)");
    await transaktion.query("UPDATE call SET summary = $1", [text]);
  });
  const store = await import("../../src/store.js");
  await store.kennzahlenTakt();
  return store.kennzahlenMomentaufnahme();
}

test("S9: der Anfang der Zusammenfassung Guten Tag steht in keinem Labelnamen, Labelwert und Messwertnamen", async () => {
  const zeilen = await zeilenMitZusammenfassung("Guten Tag, hier ist Hermes.");
  assert.ok(zeilen.length > 0);
  for (const zeile of zeilen) {
    const sichtbar = JSON.stringify([Object.keys(zeile), zeile.messwert, zeile.richtung, zeile.ergebnis, zeile.ziel, zeile.plan]);
    assert.equal(sichtbar.includes("Guten Tag"), false, `Guten Tag in ${sichtbar}`);
  }
});

test("S9: jeder Labelwert stammt aus der festen Menge", async () => {
  const zeilen = await zeilenMitZusammenfassung("Guten Tag, hier ist Hermes.");
  assert.ok(zeilen.length > 0);
  for (const zeile of zeilen) {
    for (const [label, erlaubt] of Object.entries(FESTE_MENGE)) {
      assert.ok(erlaubt.includes(zeile[label]), `${label}=${JSON.stringify(zeile[label])} nicht in der festen Menge`);
    }
  }
});
