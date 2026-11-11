import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { laufClients, starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const ROLLE = "kennzahlen_leser";
const TAKT_MS = 60000;
const ABFRAGE_BEGINN = "SELECT messwert";
const WARTE_RUNDEN = 500;

const zeitgeberHandles = [];
mock.timers.enable({ apis: ["setInterval"] });
const mockSetInterval = globalThis.setInterval;
globalThis.setInterval = (...argumente) => {
  const handle = mockSetInterval(...argumente);
  const eintrag = { handle, takt: argumente[1], aus: new Error().stack, unrefAufrufe: 0 };
  const echtesUnref = handle.unref.bind(handle);
  handle.unref = () => {
    eintrag.unrefAufrufe += 1;
    return echtesUnref();
  };
  zeitgeberHandles.push(eintrag);
  return handle;
};

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

const naechsteRunde = () => new Promise((fertig) => setImmediate(fertig));

async function wartePlus(zaehler, soll) {
  for (let runde = 0; runde < WARTE_RUNDEN && zaehler() < soll; runde += 1) await naechsteRunde();
}

test("Der Lauf liest die Sicht alle 60 Sekunden erneut und hält den Prozess nicht offen", async () => {
  const client = laufClients.at(-1);
  const echteAbfrage = client.query.bind(client);
  let abfragen = 0;
  client.query = (...argumente) => {
    if (String(argumente[0]).startsWith(ABFRAGE_BEGINN)) abfragen += 1;
    return echteAbfrage(...argumente);
  };
  const lauf = zeitgeberHandles.filter((eintrag) => eintrag.aus.includes("kennzahlen.js"));
  assert.equal(lauf.length, 1, "genau ein Zeitgeber des Kennzahlen-Laufs");
  assert.equal(lauf[0].takt, TAKT_MS);
  assert.equal(lauf[0].unrefAufrufe, 1, "der Zeitgeber hält den Prozess nicht offen");
  mock.timers.tick(TAKT_MS - 1);
  for (let runde = 0; runde < 20; runde += 1) await naechsteRunde();
  assert.equal(abfragen, 0, "vor Ablauf der Minute kein neuer Takt");
  mock.timers.tick(1);
  await wartePlus(() => abfragen, 1);
  assert.equal(abfragen, 1, "nach 60 Sekunden ein neuer Takt");
  assert.ok(laufendesHermes());
});
