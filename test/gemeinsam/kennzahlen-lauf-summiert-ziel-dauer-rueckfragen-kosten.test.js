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

test("S2: drei beendete Anrufe mit true, false und unclear stehen je einmal bei erreicht, nicht_erreicht und unbekannt", async () => {
  const db = await neuerLauf();
  for (const ziel of ["true", "false", "unclear"]) {
    await anrufEinfuegen(db, { answered_at: zeitpunkt(0, "09:01:00"), ended_at: zeitpunkt(0, "09:05:00"), objective_achieved: ziel });
  }
  const zeilen = await takt();
  assert.equal(wertVon(zeilen, "zielerreichung_heute", { ziel: "erreicht" }), 1);
  assert.equal(wertVon(zeilen, "zielerreichung_heute", { ziel: "nicht_erreicht" }), 1);
  assert.equal(wertVon(zeilen, "zielerreichung_heute", { ziel: "unbekannt" }), 1);
});

test("S3: ein ausgehender Anruf von 10:00:00 bis 10:02:30 gibt 150 Sekunden und einen beantworteten Anruf", async () => {
  const db = await neuerLauf();
  await anrufEinfuegen(db, { answered_at: zeitpunkt(0, "10:00:00"), ended_at: zeitpunkt(0, "10:02:30") });
  const zeilen = await takt();
  assert.equal(wertVon(zeilen, "gespraechsdauer_sekunden_heute", { richtung: "outbound" }), 150);
  assert.equal(wertVon(zeilen, "beantwortete_anrufe_heute", { richtung: "outbound" }), 1);
  assert.equal(wertVon(zeilen, "gespraechsdauer_sekunden_heute", { richtung: "inbound" }), 0);
});

test("S4: ein Anruf mit drei Rückfragen gibt rueckfragen_heute = 3", async () => {
  const db = await neuerLauf();
  await anrufEinfuegen(db, { consults: JSON.stringify([{ frage: "a" }, { frage: "b" }, { frage: "c" }]) });
  const zeilen = await takt();
  assert.equal(wertVon(zeilen, "rueckfragen_heute"), 3);
});

test("S5: 40 Cent ausgehend und 15 Cent eingehend stehen je Richtung in kosten_heute_cent", async () => {
  const db = await neuerLauf();
  await anrufEinfuegen(db, { estimated_cost_cents: 40 });
  await anrufEinfuegen(db, { direction: "inbound", estimated_cost_cents: 15 });
  await anrufEinfuegen(db, {});
  const zeilen = await takt();
  assert.equal(wertVon(zeilen, "kosten_heute_cent", { richtung: "outbound" }), 40);
  assert.equal(wertVon(zeilen, "kosten_heute_cent", { richtung: "inbound" }), 15);
});
