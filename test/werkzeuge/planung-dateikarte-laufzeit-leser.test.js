import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dateiKarte, nachrichtenKarte } from "../../tools/auftrag/planung/funktionsliste.mjs";
import { LAUFZEIT_LESER } from "../../tools/testgraph.mjs";
import { probeRepository, REPO_ROOT } from "./probe-repo.js";

const MIGRATE = "src/db/migrate.js";
const MIGRATIONEN = "src/db/migrations";
const ERSTE = `${MIGRATIONEN}/0001_ausgang.sql`;
const NEUE = `${MIGRATIONEN}/0002_neu.sql`;
const DIREKT = "test/direkt.test.js";
const UEBER_HILFE = "test/ueber-hilfe.test.js";

function karteFuer(wurzel, ...dateien) {
  return dateiKarte(wurzel, [{ nummern: { S1: { aenderungen: dateien.map((datei) => ({ datei, von: 1, bis: 1 })) } } }]);
}

function testsDerKarte(karte, datei) {
  return karte.find((eintrag) => eintrag.datei === datei).tests;
}

function migrationsProbe(context) {
  const wurzel = probeRepository(context, {
    ".gitignore": "node_modules\n",
    "package.json": JSON.stringify({ type: "module" }),
    [MIGRATE]: 'import fs from "fs";\nexport const lies = () => fs.readFileSync(new URL("./migrations/0001_ausgang.sql", import.meta.url), "utf8");\n',
    [ERSTE]: "select 1;\n",
    "src/db/anderes/x.sql": "select 2;\n",
    "src/lose.js": "export const lose = 1;\n",
    "test/hilfe.js": 'import { lies } from "../src/db/migrate.js";\nexport const h = lies;\n',
    [UEBER_HILFE]: 'import { h } from "./hilfe.js";\nexport const x = h;\n',
    [DIREKT]: 'import { lies } from "../src/db/migrate.js";\nexport const x = lies;\n',
  });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(wurzel, "node_modules"));
  return wurzel;
}

test("dateikarte: ein Test, der migrate.js über eine Testhilfe erreicht, gilt für migrate.js", async (context) => {
  const karte = await karteFuer(migrationsProbe(context), MIGRATE);
  assert.deepEqual(testsDerKarte(karte, MIGRATE), [DIREKT, UEBER_HILFE]);
});

test("dateikarte: eine bestehende und eine neue Datei unter src/db/migrations/ bekommen dieselben Tests wie migrate.js", async (context) => {
  const karte = await karteFuer(migrationsProbe(context), MIGRATE, ERSTE, NEUE);
  const erwartet = testsDerKarte(karte, MIGRATE);
  assert.deepEqual(erwartet, [DIREKT, UEBER_HILFE]);
  assert.deepEqual(testsDerKarte(karte, ERSTE), erwartet);
  assert.deepEqual(testsDerKarte(karte, NEUE), erwartet);
});

test("dateikarte: die Nachrichtenform einer Migration nennt die Zahl aller Tests und die direkten Tests von migrate.js", async (context) => {
  const wurzel = migrationsProbe(context);
  const nachricht = await nachrichtenKarte(wurzel, await karteFuer(wurzel, NEUE));
  assert.deepEqual(nachricht.map(({ datei, testsGesamt, tests }) => ({ datei, testsGesamt, tests })), [{ datei: NEUE, testsGesamt: 2, tests: [DIREKT] }]);
});

test("dateikarte: eine Datei ohne Weg zu einem Test und eine .sql außerhalb von src/db/migrations/ bleiben bei 0 Tests", async (context) => {
  const wurzel = migrationsProbe(context);
  const karte = await karteFuer(wurzel, "src/lose.js", "src/db/anderes/x.sql", "src/db/migrations-alt/0001.sql");
  for (const { datei, tests } of karte) assert.deepEqual(tests, [], datei);
  const nachricht = await nachrichtenKarte(wurzel, karte);
  for (const { datei, testsGesamt, tests } of nachricht) assert.deepEqual({ testsGesamt, tests }, { testsGesamt: 0, tests: [] }, datei);
});

test("dateikarte: jeder feste Leser im Repo existiert und nennt den Ordner, dessen Dateien er zur Laufzeit liest", () => {
  for (const { ordner, leser } of LAUFZEIT_LESER) {
    assert.equal(existsSync(join(REPO_ROOT, leser)), true, leser);
    assert.equal(readdirSync(join(REPO_ROOT, ordner)).some((name) => name.endsWith(".sql")), true, ordner);
    const ordnername = ordner.split("/").filter(Boolean).at(-1);
    assert.match(readFileSync(join(REPO_ROOT, leser), "utf8"), new RegExp(`"${ordnername}"`), `${leser} nennt ${ordnername} nicht`);
  }
});
