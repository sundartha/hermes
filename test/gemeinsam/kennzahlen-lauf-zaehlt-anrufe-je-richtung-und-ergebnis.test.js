import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { laufClients, starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";
import { anrufEinfuegen, wertVon, zeitpunkt } from "./kennzahlen-anrufe.js";

const ROLLE = "kennzahlen_leser";
const ADRESSE = "postgres://kennzahlen-leser-attrappe.invalid/hermes";
const RASTER_GROESSE = 25;
const FRIST_MS = 5000;

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

async function takt() {
  const store = await import("../../src/store.js");
  await store.kennzahlenTakt();
  return store.kennzahlenMomentaufnahme();
}

async function anrufeLoeschen(db) {
  await db.transaction(async (transaktion) => {
    await transaktion.query("SELECT set_config('app.current_tenant', (SELECT id FROM tenant ORDER BY created_at LIMIT 1), true)");
    await transaktion.query("DELETE FROM call");
  });
}

const anrufe = (zeilen, richtung, ergebnis) => wertVon(zeilen, "anrufe_heute", { richtung, ergebnis });

test("S1: der Start meldet sofort das volle Raster mit Nullen, über eine eigene Verbindung der Leserolle", async () => {
  const hermes = laufendesHermes();
  const store = await import("../../src/store.js");
  const erste = store.kennzahlenMomentaufnahme();
  assert.equal(erste.length, RASTER_GROESSE);
  assert.equal(anrufe(erste, "outbound", "angenommen"), 0);
  assert.equal(laufClients.length, 1);
  assert.equal(laufClients[0].optionen.connectionString, ADRESSE);
  assert.equal(laufClients[0].optionen.statement_timeout, FRIST_MS);
  assert.equal(laufClients[0].optionen.connectionTimeoutMillis, FRIST_MS);
  const pool = await hermes.db.query("SELECT current_user AS rolle");
  assert.equal(pool.rows[0].rolle, "kv2_app", "der gemeinsame Pool bleibt bei der App-Rolle");
});

test("S1: zwei beantwortete und ein nicht beantworteter ausgehender Anruf sowie ein beantworteter eingehender Anruf zählen je Richtung und Ergebnis", async () => {
  const { db } = laufendesHermes();
  await anrufEinfuegen(db, { answered_at: zeitpunkt(0, "08:01:00"), ended_at: zeitpunkt(0, "08:05:00") });
  await anrufEinfuegen(db, { answered_at: zeitpunkt(0, "09:01:00"), ended_at: zeitpunkt(0, "09:05:00") });
  await anrufEinfuegen(db, { ended_at: zeitpunkt(0, "10:01:00"), failure_reason: "no-answer" });
  await anrufEinfuegen(db, { direction: "inbound", answered_at: zeitpunkt(0, "11:01:00"), ended_at: zeitpunkt(0, "11:05:00") });
  const zeilen = await takt();
  assert.equal(anrufe(zeilen, "outbound", "angenommen"), 2);
  assert.equal(anrufe(zeilen, "outbound", "nicht_angenommen"), 1);
  assert.equal(anrufe(zeilen, "inbound", "angenommen"), 1);
  assert.equal(anrufe(zeilen, "inbound", "nicht_angenommen"), 0);
  assert.equal(laufClients.length, 1, "der Takt nutzt dieselbe Verbindung weiter");
});

test("S8: der Tag ist der UTC-Tag von started_at, unabhängig von der Zeitzone der Sitzung", async () => {
  const { db } = laufendesHermes();
  await anrufeLoeschen(db);
  await anrufEinfuegen(db, { started_at: zeitpunkt(1, "23:30:00"), answered_at: zeitpunkt(1, "23:31:00"), ended_at: zeitpunkt(1, "23:40:00") });
  await anrufEinfuegen(db, { started_at: zeitpunkt(0, "00:30:00"), answered_at: zeitpunkt(0, "00:31:00"), ended_at: zeitpunkt(0, "00:40:00") });
  await db.exec("SET TIME ZONE 'Europe/Berlin'");
  const zeilen = await takt();
  assert.equal(anrufe(zeilen, "outbound", "angenommen"), 1);
});

test("S18: ein beantworteter, noch nicht beendeter Anruf zählt als laufend", async () => {
  const { db } = laufendesHermes();
  await anrufeLoeschen(db);
  await anrufEinfuegen(db, { answered_at: zeitpunkt(0, "00:05:00") });
  const zeilen = await takt();
  assert.equal(anrufe(zeilen, "outbound", "laufend"), 1);
  assert.equal(anrufe(zeilen, "outbound", "angenommen"), 0);
});

test("Ein Fehler der Verbindung löscht die Momentaufnahme, der nächste Takt öffnet eine neue Verbindung", async () => {
  const store = await import("../../src/store.js");
  const verbunden = laufClients.length;
  laufClients.at(-1).query = async () => {
    throw Object.assign(new Error("Verbindung weg"), { code: "08006" });
  };
  const meldungen = [];
  const echt = console.error;
  console.error = (...zeilen) => meldungen.push(zeilen.join(" "));
  try {
    assert.equal(await store.kennzahlenTakt(), null);
  } finally {
    console.error = echt;
  }
  assert.equal(store.kennzahlenMomentaufnahme(), null);
  assert.deepEqual(meldungen, ["[kennzahlen] Lauf fehlgeschlagen: 08006"]);
  const wieder = await takt();
  assert.equal(wieder.length, RASTER_GROESSE);
  assert.equal(laufClients.length, verbunden + 1);
});

test("Ein error-Ereignis der Verbindung im Leerlauf verwirft sie und löscht die Momentaufnahme", async () => {
  const store = await import("../../src/store.js");
  laufClients.at(-1).emit("error", new Error("Server beendet die Sitzung"));
  assert.equal(store.kennzahlenMomentaufnahme(), null);
});

test("Eine hängende Abfrage endet nach 5 Sekunden: Momentaufnahme gelöscht, Verbindung verworfen, kein zweiter Lauf zugleich", async () => {
  const store = await import("../../src/store.js");
  await takt();
  const verbunden = laufClients.length;
  laufClients.at(-1).query = () => new Promise(() => {});
  const meldungen = [];
  const echt = console.error;
  console.error = (...zeilen) => meldungen.push(zeilen.join(" "));
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const erster = store.kennzahlenTakt();
    const zweiter = store.kennzahlenTakt();
    assert.equal(erster, zweiter, "der zweite Aufruf bekommt den laufenden Takt");
    mock.timers.tick(FRIST_MS - 1);
    assert.deepEqual(meldungen, [], "vor Ablauf der Frist bleibt der Takt offen");
    mock.timers.tick(1);
    assert.equal(await erster, null);
  } finally {
    mock.timers.reset();
    console.error = echt;
  }
  assert.deepEqual(meldungen, ["[kennzahlen] Lauf fehlgeschlagen: KENNZAHLEN_FRIST"]);
  assert.equal(store.kennzahlenMomentaufnahme(), null);
  assert.equal((await takt()).length, RASTER_GROESSE);
  assert.equal(laufClients.length, verbunden + 1);
});

test("Verschwindet die Leserolle, löscht der Lauf die Momentaufnahme und öffnet nichts; mit der Rolle meldet er wieder", async () => {
  const { db } = laufendesHermes();
  const store = await import("../../src/store.js");
  await takt();
  await db.exec(`ALTER ROLE ${ROLLE} RENAME TO kennzahlen_leser_weg`);
  await store.starteKennzahlenLauf();
  assert.equal(store.kennzahlenMomentaufnahme(), null);
  const verbunden = laufClients.length;
  await db.exec(`ALTER ROLE kennzahlen_leser_weg RENAME TO ${ROLLE}`);
  await store.starteKennzahlenLauf();
  assert.equal(store.kennzahlenMomentaufnahme().length, RASTER_GROESSE);
  assert.equal(laufClients.length, verbunden + 1);
});
