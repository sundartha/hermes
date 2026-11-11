import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { anrufEinfuegen, wertVon, zeitpunkt } from "./kennzahlen-anrufe.js";

const ROLLE = "kennzahlen_leser";
const SPALTEN = ["messwert", "richtung", "ergebnis", "ziel", "plan", "wert"];
const RASTER_GROESSE = 25;
const VERBINDUNGSGRENZE = 2;

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: [ROLLE],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  ohneStartanruf: true,
});

async function alsLeser(db, text) {
  return db.transaction(async (transaktion) => {
    await transaktion.exec(`SET LOCAL ROLE ${ROLLE}`);
    return transaktion.query(text);
  });
}

async function sichtZeilen(db) {
  return (await alsLeser(db, "SELECT * FROM kennzahlen.messwerte")).rows;
}

function schluessel(zeile) {
  return [zeile.messwert, zeile.richtung, zeile.ergebnis, zeile.ziel, zeile.plan].join("|");
}

async function mandantEinfuegen(db, id, { spalten, kontoZeiten }) {
  await db.query(`INSERT INTO tenant (id, status, stripe_subscription_id, stripe_plan_slug, stripe_billing_hold) VALUES ($1, $2, $3, $4, $5)`, [
    id,
    spalten.status,
    spalten.abo ?? null,
    spalten.plan ?? null,
    spalten.sperre ?? null,
  ]);
  for (const [nr, zeit] of kontoZeiten.entries()) {
    await db.query(`INSERT INTO account (sub, email, tenant_id, created_at) VALUES ($1, $2, $3, $4)`, [`sub_${id}_${nr}`, `${id}_${nr}@kennzahlen.invalid`, id, zeit]);
  }
}

test("Leere Datenbank: genau 25 Zeilen, nur die sechs Zahlenspalten, alle Werte 0", async () => {
  const hermes = laufendesHermes();
  const zeilen = await sichtZeilen(hermes.db);
  assert.equal(zeilen.length, RASTER_GROESSE);
  assert.deepEqual(Object.keys(zeilen[0]), SPALTEN);
  assert.equal(new Set(zeilen.map(schluessel)).size, RASTER_GROESSE);
  assert.deepEqual(zeilen.filter((zeile) => Number(zeile.wert) !== 0), []);
  const erwartet = [
    ...["inbound", "outbound"].flatMap((richtung) =>
      ["angenommen", "nicht_angenommen", "besetzt", "fehlgeschlagen", "laufend", "sonstige"].map((ergebnis) => `anrufe_heute|${richtung}|${ergebnis}||`),
    ),
    ...["erreicht", "nicht_erreicht", "unbekannt"].map((ziel) => `zielerreichung_heute|||${ziel}|`),
    ...["gespraechsdauer_sekunden_heute", "beantwortete_anrufe_heute", "kosten_heute_cent"].flatMap((name) => [`${name}|inbound|||`, `${name}|outbound|||`]),
    "rueckfragen_heute||||",
    "anmeldungen_heute||||",
    "abos||||starter",
    "abos||||business",
  ];
  assert.deepEqual(zeilen.map(schluessel).sort(), erwartet.sort());
});

test("Summen je Regel: Ergebnis, Ziel, Dauer, Rückfragen, Kosten, Anmeldungen und Abos", async () => {
  const hermes = laufendesHermes();
  const { db } = hermes;
  const heute = (uhrzeit) => zeitpunkt(0, uhrzeit);
  await anrufEinfuegen(db, { answered_at: heute("10:00:00"), ended_at: heute("10:01:30"), objective_achieved: "true", consults: "[1, 2]", estimated_cost_cents: 20 });
  await anrufEinfuegen(db, {
    answered_at: heute("11:00:00"),
    ended_at: heute("11:00:30"),
    objective_achieved: "false",
    consults: '{"a": 1}',
    estimated_cost_cents: 5,
    failure_reason: "max-duration",
  });
  await anrufEinfuegen(db, { ended_at: heute("12:00:00"), failure_reason: "no-answer" });
  await anrufEinfuegen(db, { ended_at: heute("12:00:00"), failure_reason: "busy" });
  await anrufEinfuegen(db, { ended_at: heute("12:00:00"), failure_reason: "failed:603" });
  await anrufEinfuegen(db, { ended_at: heute("12:00:00"), failure_reason: "failed" });
  await anrufEinfuegen(db, { answered_at: heute("13:00:00") });
  await anrufEinfuegen(db, {});
  await anrufEinfuegen(db, { ended_at: heute("12:00:00"), failure_reason: "unbekannter-grund" });
  await anrufEinfuegen(db, { direction: "inbound", answered_at: heute("14:00:00"), ended_at: heute("14:00:20"), objective_achieved: "vielleicht", estimated_cost_cents: 7 });
  await anrufEinfuegen(db, { direction: "seitwaerts", answered_at: heute("15:00:00"), ended_at: heute("15:05:00"), objective_achieved: "true", estimated_cost_cents: 99 });
  await anrufEinfuegen(db, { answered_at: "kaputt", ended_at: heute("16:00:00") });
  await anrufEinfuegen(db, { started_at: zeitpunkt(1, "23:30:00"), answered_at: zeitpunkt(1, "23:31:00"), ended_at: zeitpunkt(1, "23:40:00"), objective_achieved: "true", estimated_cost_cents: 500 });
  await mandantEinfuegen(db, "t_neu", { spalten: { status: "active", abo: "sub_1", plan: "starter" }, kontoZeiten: [heute("08:00:00")] });
  await mandantEinfuegen(db, "t_alt", { spalten: { status: "active", abo: "sub_2", plan: "business" }, kontoZeiten: [zeitpunkt(5, "08:00:00"), heute("09:00:00")] });
  await mandantEinfuegen(db, "t_gehalten", { spalten: { status: "active", abo: "sub_3", plan: "starter", sperre: "payment_failed" }, kontoZeiten: [heute("07:00:00")] });
  await mandantEinfuegen(db, "t_inaktiv", { spalten: { status: "suspended", abo: "sub_4", plan: "business" }, kontoZeiten: [zeitpunkt(3, "08:00:00")] });
  await mandantEinfuegen(db, "t_sonderplan", { spalten: { status: "active", abo: "sub_5", plan: "gratis" }, kontoZeiten: [] });

  const zeilen = await sichtZeilen(db);
  assert.equal(zeilen.length, RASTER_GROESSE);
  const anrufe = (richtung, ergebnis) => wertVon(zeilen, "anrufe_heute", { richtung, ergebnis });
  assert.equal(anrufe("outbound", "angenommen"), 3);
  assert.equal(anrufe("outbound", "nicht_angenommen"), 1);
  assert.equal(anrufe("outbound", "besetzt"), 1);
  assert.equal(anrufe("outbound", "fehlgeschlagen"), 2);
  assert.equal(anrufe("outbound", "laufend"), 2);
  assert.equal(anrufe("outbound", "sonstige"), 1);
  assert.equal(anrufe("inbound", "angenommen"), 1);
  assert.equal(anrufe("inbound", "laufend") + anrufe("inbound", "sonstige") + anrufe("inbound", "nicht_angenommen"), 0);

  assert.equal(wertVon(zeilen, "zielerreichung_heute", { ziel: "erreicht" }), 2);
  assert.equal(wertVon(zeilen, "zielerreichung_heute", { ziel: "nicht_erreicht" }), 1);
  assert.equal(wertVon(zeilen, "zielerreichung_heute", { ziel: "unbekannt" }), 7);

  assert.equal(wertVon(zeilen, "gespraechsdauer_sekunden_heute", { richtung: "outbound" }), 120);
  assert.equal(wertVon(zeilen, "beantwortete_anrufe_heute", { richtung: "outbound" }), 2);
  assert.equal(wertVon(zeilen, "gespraechsdauer_sekunden_heute", { richtung: "inbound" }), 20);
  assert.equal(wertVon(zeilen, "beantwortete_anrufe_heute", { richtung: "inbound" }), 1);

  assert.equal(wertVon(zeilen, "rueckfragen_heute"), 2);
  assert.equal(wertVon(zeilen, "kosten_heute_cent", { richtung: "outbound" }), 25);
  assert.equal(wertVon(zeilen, "kosten_heute_cent", { richtung: "inbound" }), 7);
  assert.equal(wertVon(zeilen, "anmeldungen_heute"), 2);
  assert.equal(wertVon(zeilen, "abos", { plan: "starter" }), 1);
  assert.equal(wertVon(zeilen, "abos", { plan: "business" }), 1);
});

test("Die Leserolle sieht nur die Sicht, die Regel gilt nur für sie, und die Datei lässt sich erneut anwenden", async () => {
  const hermes = laufendesHermes();
  const { db } = hermes;
  await assert.rejects(alsLeser(db, "SELECT count(*) FROM call"), /permission denied/);
  await assert.rejects(alsLeser(db, "SELECT count(*) FROM tenant"), /permission denied/);
  const rolle = await db.query("SELECT rolbypassrls, rolsuper, rolconnlimit FROM pg_roles WHERE rolname = $1", [ROLLE]);
  assert.deepEqual(rolle.rows, [{ rolbypassrls: false, rolsuper: false, rolconnlimit: VERBINDUNGSGRENZE }]);
  const regel = await db.query("SELECT cmd, qual FROM pg_policies WHERE tablename = 'call' AND policyname = 'kennzahlen_lesen'");
  assert.equal(regel.rows.length, 1);
  assert.equal(regel.rows[0].cmd, "SELECT");
  assert.match(regel.rows[0].qual, /kennzahlen_leser/);
  const appSicht = await db.transaction(async (transaktion) => {
    await transaktion.query("SELECT set_config('app.current_tenant', 'fremder-mandant', true)");
    return transaktion.query("SELECT count(*)::int AS anzahl FROM call");
  });
  assert.equal(appSicht.rows[0].anzahl, 0, "die App-Sitzung eines anderen Mandanten sieht keine Anrufe");

  await db.exec(`DROP POLICY kennzahlen_lesen ON call; DROP VIEW kennzahlen.messwerte;`);
  await hermes.schemaErneutAnwenden();
  assert.equal((await sichtZeilen(db)).length, RASTER_GROESSE, "die erneut angewendete Datei legt die Sicht wieder an");
  const wieder = await db.query("SELECT count(*)::int AS anzahl FROM pg_policies WHERE tablename = 'call' AND policyname = 'kennzahlen_lesen'");
  assert.equal(wieder.rows[0].anzahl, 1);
  assert.equal((await sichtZeilen(db)).length, RASTER_GROESSE);
});
