import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { anrufEinfuegen, wertVon, zeitpunkt } from "./kennzahlen-anrufe.js";

const ROLLE = "kennzahlen_leser";
const ADRESSE = "postgres://kennzahlen-leser-attrappe.invalid/hermes";

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

async function neuerLauf() {
  const { db } = laufendesHermes();
  await db.transaction(async (transaktion) => {
    await transaktion.query("SELECT set_config('app.current_tenant', (SELECT id FROM tenant ORDER BY created_at LIMIT 1), true)");
    await transaktion.query("DELETE FROM call");
  });
  return db;
}

async function takt() {
  const store = await import("../../src/store.js");
  await store.kennzahlenTakt();
  return store.kennzahlenMomentaufnahme();
}

test("S17: ein beantworteter Anruf, der mit budget-exhausted endet, zählt als angenommen", async () => {
  const db = await neuerLauf();
  await anrufEinfuegen(db, { answered_at: zeitpunkt(0, "09:01:00"), ended_at: zeitpunkt(0, "09:05:00"), failure_reason: "budget-exhausted" });
  const zeilen = await takt();
  assert.equal(wertVon(zeilen, "anrufe_heute", { richtung: "outbound", ergebnis: "angenommen" }), 1);
  assert.equal(wertVon(zeilen, "anrufe_heute", { richtung: "outbound", ergebnis: "fehlgeschlagen" }), 0);
});

test("S10: ein unbekannter Grund xyz zählt als sonstige und wird kein Label", async () => {
  const db = await neuerLauf();
  await anrufEinfuegen(db, { ended_at: zeitpunkt(0, "09:05:00"), failure_reason: "xyz" });
  const zeilen = await takt();
  assert.equal(wertVon(zeilen, "anrufe_heute", { richtung: "outbound", ergebnis: "sonstige" }), 1);
  assert.equal(zeilen.some((zeile) => JSON.stringify(zeile).includes("xyz")), false);
});

test("S9: Nummer, E-Mail-Adresse und Transkript erscheinen in keinem Label und keinem Messwertnamen", async () => {
  const db = await neuerLauf();
  const nummer = "+4915100000001";
  const mail = "kunde@example.org";
  const text = "Guten Tag, hier ist Hermes.";
  await db.query("INSERT INTO account (sub, email, tenant_id) SELECT 'sub_kennzahlen_s9', $1, id FROM tenant ORDER BY created_at LIMIT 1", [mail]);
  await anrufEinfuegen(db, { answered_at: zeitpunkt(0, "09:01:00"), ended_at: zeitpunkt(0, "09:05:00") });
  await db.transaction(async (transaktion) => {
    await transaktion.query("SELECT set_config('app.current_tenant', (SELECT id FROM tenant ORDER BY created_at LIMIT 1), true)");
    await transaktion.query("UPDATE call SET to_e164 = $1, summary = $2, caller_name = $3", [nummer, text, mail]);
  });
  const zeilen = await takt();
  assert.ok(zeilen.length > 0);
  for (const zeile of zeilen) {
    assert.deepEqual(Object.keys(zeile).sort(), ["ergebnis", "messwert", "plan", "richtung", "wert", "ziel"]);
    const sichtbar = JSON.stringify([zeile.messwert, zeile.richtung, zeile.ergebnis, zeile.ziel, zeile.plan]);
    for (const geheim of [nummer, "4915100000001", mail, "example.org", text, "Hermes."]) {
      assert.equal(sichtbar.includes(geheim), false, `${geheim} in ${sichtbar}`);
    }
  }
});
