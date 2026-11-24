import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

import { bausteinBefunde, bausteinPruefung, karteAus } from "../../tools/bausteine.mjs";

const WURZEL = resolve(import.meta.dirname, "../..");
const KARTE = "tools/bausteine.json";
const NEUE_DATEI = "src/routes/neue-probe.js";
const JS = /\.js$/;
const ordner = [];

after(() => {
  for (const eintrag of ordner) rmSync(eintrag, { recursive: true, force: true });
});

function roh() {
  return JSON.parse(readFileSync(join(WURZEL, KARTE), "utf8"));
}

function quelldateien() {
  const ausgabe = spawnSync("git", ["ls-files", "-z", "src"], { cwd: WURZEL, encoding: "utf8" }).stdout;
  return ausgabe.split("\0").filter((pfad) => /\.[jt]s$/.test(pfad) && !/\.d\.ts$/.test(pfad) && existsSync(join(WURZEL, pfad)));
}

function pruefe(rohKarte, dateien) {
  return bausteinPruefung(karteAus(rohKarte), { dateien, importe: [] });
}

test("eine neue .js-Datei unter src/ außerhalb der Bestandsliste bricht mit Pfad, Regel und npm run neu", () => {
  const { javascript } = pruefe(roh(), [...quelldateien(), NEUE_DATEI]);
  assert.equal(javascript.length, 1);
  assert.ok(javascript[0].includes(NEUE_DATEI));
  assert.match(javascript[0], /neue Dateien nur \.ts/);
  assert.match(javascript[0], /npm run neu/);
});

test("die Bestandsliste nennt genau die vorhandenen .js-Dateien unter src/, sortiert, ohne Doppelte", () => {
  const liste = roh().javascriptBestand;
  const vorhanden = quelldateien().filter((pfad) => JS.test(pfad));
  assert.deepEqual(liste, vorhanden.toSorted());
  assert.equal(new Set(liste).size, liste.length);
  assert.deepEqual(pruefe(roh(), quelldateien()).javascript, []);
});

test("ein Listeneintrag ohne Datei lässt die Prüfung rot werden und sagt, dass er aus der Liste zu streichen ist", () => {
  const verwaist = "src/routes/gibt-es-nicht.js";
  const karte = { ...roh(), javascriptBestand: [...roh().javascriptBestand, verwaist] };
  const { javascript } = pruefe(karte, quelldateien());
  assert.equal(javascript.length, 1);
  assert.ok(javascript[0].includes(verwaist));
  assert.match(javascript[0], /aus der Liste streichen/);
});

test("die Zusammenfassungszeile nennt die Zahl der .js-Dateien im Bestand", () => {
  const { zusammenfassung } = bausteinBefunde([]);
  assert.ok(zusammenfassung.includes(`${roh().javascriptBestand.length} .js-Dateien im Bestand`), zusammenfassung);
});

test("eine aus der Liste gestrichene und nach .ts umbenannte Datei lässt die Prüfung grün", () => {
  const umbenannt = "src/routes/intern-status.js";
  const karte = { ...roh(), javascriptBestand: roh().javascriptBestand.filter((pfad) => pfad !== umbenannt) };
  const dateien = quelldateien().map((pfad) => (pfad === umbenannt ? umbenannt.replace(JS, ".ts") : pfad));
  assert.deepEqual(pruefe(karte, dateien).javascript, []);
});

test("npm run neu erzeugt für route und fachdatei .ts-Dateien, die die Prüfung bestehen", () => {
  const root = mkdtempSync(join(tmpdir(), "neue-js-"));
  ordner.push(root);
  for (const eintrag of ["src", "tools", "package.json"]) cpSync(join(WURZEL, eintrag), join(root, eintrag), { recursive: true });
  symlinkSync(join(WURZEL, "node_modules"), join(root, "node_modules"));
  for (const argumente of [["route", "betrieb", "probe-route"], ["fachdatei", "abrechnung", "probe-abruf"]]) {
    const ergebnis = spawnSync(process.execPath, [join(root, "tools/neu.mjs"), "--wurzel", root, ...argumente], { cwd: root, encoding: "utf8" });
    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.match(ergebnis.stdout, /\.ts angelegt\./);
  }
  assert.ok(existsSync(join(root, "src/routes/probe-route.ts")));
  assert.ok(existsSync(join(root, "src/billing/probe-abruf.ts")));
  assert.equal(existsSync(join(root, "src/routes/probe-route.js")), false);
  assert.equal(existsSync(join(root, "src/billing/probe-abruf.js")), false);
  const dateien = ["src/routes/probe-route.ts", "src/billing/probe-abruf.ts"];
  const karte = JSON.parse(readFileSync(join(root, KARTE), "utf8"));
  assert.deepEqual(bausteinPruefung(karteAus(karte), { dateien: [...quelldateien(), ...dateien], importe: [] }).javascript, []);
});
