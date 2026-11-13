import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { laufClients, starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const ROLLE = "kennzahlen_leser";
const PRAEFIX = "[kennzahlen] Lauf fehlgeschlagen: ";

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: [ROLLE],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
  unterKennzahlenLeser: true,
  kennzahlenAdresse: "postgres://kennzahlen-leser-attrappe.invalid/hermes",
  ohneStartanruf: true,
});

const zeitgeber = () => process.getActiveResourcesInfo().filter((art) => art === "Timeout").length;

async function speicher() {
  return import("../../src/store.js");
}

function fehlerZeilen() {
  const zeilen = [];
  mock.method(console, "error", (...teile) => {
    zeilen.push(teile.join(" "));
  });
  return zeilen;
}

async function scheitern(fehler) {
  const store = await speicher();
  await store.kennzahlenTakt();
  const client = laufClients.at(-1);
  const beendet = [];
  client.end = () => {
    beendet.push(client);
    return Promise.resolve();
  };
  client.query = () => Promise.reject(fehler);
  const zeilen = fehlerZeilen();
  await store.kennzahlenTakt();
  mock.restoreAll();
  return { client, beendet, zeilen, store };
}

test("Scheitert ein Takt mit Code, Namen oder ohne beides, nennt die Zeile genau diesen Grund und die Verbindung wird beendet", async () => {
  const faelle = [
    [Object.assign(new Error("x"), { code: "ABGEBROCHEN" }), "ABGEBROCHEN"],
    [new TypeError("y"), "TypeError"],
    [undefined, "unbekannt"],
    [{}, "unbekannt"],
  ];
  for (const [fehler, erwartet] of faelle) {
    const { beendet, zeilen, client, store } = await scheitern(fehler);
    assert.deepEqual(zeilen, [`${PRAEFIX}${erwartet}`]);
    assert.deepEqual(beendet, [client], "die verworfene Verbindung wird geschlossen");
    assert.equal(store.kennzahlenMomentaufnahme(), null);
  }
});

test("Jeder Takt stellt seine Frist von fünf Sekunden wieder ab", async () => {
  const store = await speicher();
  await store.kennzahlenTakt();
  const vorher = zeitgeber();
  await store.kennzahlenTakt();
  assert.equal(zeitgeber(), vorher);
});

test("Der Fehler einer ersetzten Verbindung verwirft die neue Verbindung nicht, der der aktuellen schon", async () => {
  const { client: alt, store } = await scheitern(new Error("weg"));
  await store.kennzahlenTakt();
  const neu = laufClients.at(-1);
  assert.notEqual(neu, alt);
  const beendet = [];
  neu.end = () => {
    beendet.push(neu);
    return Promise.resolve();
  };
  alt.emit("error", new Error("spät"));
  assert.notEqual(store.kennzahlenMomentaufnahme(), null);
  assert.deepEqual(beendet, []);
  neu.emit("error", new Error("aktuell"));
  assert.equal(store.kennzahlenMomentaufnahme(), null);
  assert.deepEqual(beendet, [neu]);
});

test("Scheitert die Prüfung der Leserolle, meldet der Lauf den Grund, öffnet keine Verbindung und hält keine Zahlen", async () => {
  const hermes = laufendesHermes();
  const store = await speicher();
  await store.kennzahlenTakt();
  assert.notEqual(store.kennzahlenMomentaufnahme(), null);
  const verbindungen = laufClients.length;
  const echteAbfrage = hermes.db.query;
  hermes.db.query = (text, parameter) =>
    String(text).includes("pg_roles") ? Promise.reject(Object.assign(new Error("z"), { code: "ROLLE_KAPUTT" })) : echteAbfrage.call(hermes.db, text, parameter);
  const zeilen = fehlerZeilen();
  try {
    await store.starteKennzahlenLauf();
  } finally {
    hermes.db.query = echteAbfrage;
    mock.restoreAll();
  }
  assert.deepEqual(zeilen, [`${PRAEFIX}ROLLE_KAPUTT`]);
  assert.equal(laufClients.length, verbindungen);
  assert.equal(store.kennzahlenMomentaufnahme(), null);
});

test("Findet die Rollenabfrage die Rolle der Verbindung nicht, meldet der Lauf KENNZAHLEN_ROLLE und keine Zahlen", async () => {
  const store = await speicher();
  await store.kennzahlenTakt();
  const client = laufClients.at(-1);
  client.end = () => Promise.resolve();
  client.query = () => Promise.resolve({ rows: [] });
  const zeilen = fehlerZeilen();
  await store.kennzahlenTakt();
  mock.restoreAll();
  assert.deepEqual(zeilen, [`${PRAEFIX}KENNZAHLEN_ROLLE`]);
  assert.equal(store.kennzahlenMomentaufnahme(), null);
});
