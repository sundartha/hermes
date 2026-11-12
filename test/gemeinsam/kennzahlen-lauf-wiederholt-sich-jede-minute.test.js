import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { laufClients, starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const ROLLE = "kennzahlen_leser";
const TAKT_MS = 60000;
const ABFRAGE_BEGINN = "SELECT messwert";
const WARTE_RUNDEN = 500;
const LEBENSDAUER_MS = 15000;

mock.timers.enable({ apis: ["setInterval"] });

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

test("Der Lauf liest die Sicht alle 60 Sekunden erneut", async () => {
  const client = laufClients.at(-1);
  const echteAbfrage = client.query.bind(client);
  let abfragen = 0;
  client.query = (...argumente) => {
    if (String(argumente[0]).startsWith(ABFRAGE_BEGINN)) abfragen += 1;
    return echteAbfrage(...argumente);
  };
  mock.timers.tick(TAKT_MS - 1);
  for (let runde = 0; runde < 20; runde += 1) await naechsteRunde();
  assert.equal(abfragen, 0, "vor Ablauf der Minute kein neuer Takt");
  mock.timers.tick(1);
  await wartePlus(() => abfragen, 1);
  assert.equal(abfragen, 1, "nach 60 Sekunden ein neuer Takt");
  assert.ok(laufendesHermes());
});

test("Der Minutentakt hält den Prozess nicht offen: ein Prozess mit gestartetem Lauf endet von selbst", () => {
  const modul = fileURLToPath(new URL("../../src/store.js", import.meta.url));
  const skript = `import { oeffneSpeicher, starteKennzahlenLauf } from ${JSON.stringify(modul)}; await oeffneSpeicher(); await starteKennzahlenLauf();`;
  const ergebnis = spawnSync(process.execPath, ["--input-type=module", "-e", skript], {
    env: { ...process.env, NODE_ENV: "test", STORE_BACKEND: "json" },
    timeout: LEBENSDAUER_MS,
    encoding: "utf8",
  });
  assert.equal(ergebnis.signal, null, `der Prozess endete nicht von selbst: ${ergebnis.stderr}`);
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
});
