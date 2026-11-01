import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cwd } from "node:process";
import { test } from "node:test";

import {
  VORLAGE_UNABHAENGIG,
  kettensumme,
  vorlageEinstellen,
  vorlagenkette,
} from "../../tools/mutationspruefung/vorlage.mjs";

const IN_DER_KETTE = ["src/db/migrate.js", "src/store/defaults.js", "src/i18n/locales.js", "src/i18n/prompts/de.js"];
const STORE = "src/store/pg.js";
const GEERBT = "geerbt";

async function mitGeerbterVariable(lauf) {
  const alt = process.env[VORLAGE_UNABHAENGIG];
  process.env[VORLAGE_UNABHAENGIG] = GEERBT;
  try {
    return await lauf();
  } finally {
    if (alt === undefined) delete process.env[VORLAGE_UNABHAENGIG];
    else process.env[VORLAGE_UNABHAENGIG] = alt;
  }
}

function attrappe() {
  const wurzel = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vorlagenkette-")));
  const dateien = {
    "src/db/migrate.js": 'import { STANDARD } from "../store/defaults.js";\nexport const ANWENDEN = STANDARD;\n',
    "src/db/migrations/0001_ausgang.sql": "CREATE TABLE eins (wert int);\n",
    "src/store/defaults.js": 'import { EINS } from "./grund.js";\nexport const STANDARD = EINS;\n',
    "src/store/grund.js": "export const EINS = 1;\n",
    "src/store/pg.js": 'import { ANWENDEN } from "../db/migrate.js";\nexport const SPEICHER = ANWENDEN;\n',
  };
  for (const [datei, inhalt] of Object.entries(dateien)) {
    fs.mkdirSync(path.dirname(path.join(wurzel, datei)), { recursive: true });
    fs.writeFileSync(path.join(wurzel, datei), inhalt);
  }
  return wurzel;
}

async function summeNach(wurzel, datei, inhalt) {
  if (datei) fs.appendFileSync(path.join(wurzel, datei), inhalt);
  return kettensumme(await vorlagenkette(wurzel), wurzel);
}

test("Vorlagenkette: enthält den Aufbau der Vorlage und seine Importe, nicht den Speicher", async () => {
  const kette = await vorlagenkette(cwd());
  for (const datei of IN_DER_KETTE) assert.ok(kette.includes(datei), datei);
  assert.ok(!kette.includes(STORE));
});

test("Vorlage: für eine Datei der Kette wird eine geerbte Freigabe gelöscht und ohne Cache gemeldet", async () => {
  await mitGeerbterVariable(async () => {
    for (const datei of IN_DER_KETTE) {
      process.env[VORLAGE_UNABHAENGIG] = GEERBT;
      assert.equal(await vorlageEinstellen(datei), `Vorlage: abhängig von ${datei}, ohne Cache`);
      assert.equal(process.env[VORLAGE_UNABHAENGIG], undefined);
    }
  });
});

test("Vorlage: für den Speicher wird die Kettensumme gesetzt und mit Cache gemeldet", async () => {
  await mitGeerbterVariable(async () => {
    assert.equal(await vorlageEinstellen(STORE), `Vorlage: unabhängig von ${STORE}, mit Cache`);
    const wurzel = cwd();
    assert.equal(process.env[VORLAGE_UNABHAENGIG], kettensumme(await vorlagenkette(wurzel), wurzel));
  });
});

test("Vorlage: ohne migrate.js wird eine geerbte Freigabe gelöscht und ohne Cache gemeldet", async () => {
  const wurzel = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ohne-vorlage-")));
  try {
    await mitGeerbterVariable(async () => {
      assert.equal(await vorlageEinstellen(STORE, wurzel), "Vorlage: ohne src/db/migrate.js, ohne Cache");
      assert.equal(process.env[VORLAGE_UNABHAENGIG], undefined);
    });
  } finally {
    fs.rmSync(wurzel, { recursive: true, force: true });
  }
});

test("Kettensumme: ändert sich mit jeder Datei der Kette, auch einer nur mittelbar importierten, und mit der Ausgangsmigration, nicht mit dem Speicher", async () => {
  const wurzel = attrappe();
  try {
    assert.deepEqual(await vorlagenkette(wurzel), ["src/db/migrate.js", "src/store/defaults.js", "src/store/grund.js"]);
    const anfang = await summeNach(wurzel);
    assert.equal(await summeNach(wurzel, "src/store/pg.js", "export const ANDERS = 2;\n"), anfang);
    const nachDefaults = await summeNach(wurzel, "src/store/defaults.js", "export const ANDERS = 2;\n");
    assert.notEqual(nachDefaults, anfang);
    const nachGrund = await summeNach(wurzel, "src/store/grund.js", "export const ZWEI = 2;\n");
    assert.notEqual(nachGrund, nachDefaults);
    assert.notEqual(await summeNach(wurzel, "src/db/migrations/0001_ausgang.sql", "CREATE TABLE zwei (wert int);\n"), nachGrund);
  } finally {
    fs.rmSync(wurzel, { recursive: true, force: true });
  }
});

test("Kettensumme: ändert sich mit jeder Migrationsdatei, auch im Rückbau-Ordner, und gilt auch ohne schema.sql", async () => {
  const wurzel = attrappe();
  try {
    fs.mkdirSync(path.join(wurzel, "src/db/migrations/rueckbau"), { recursive: true });
    const anfang = await summeNach(wurzel);
    const nachAusgang = await summeNach(wurzel, "src/db/migrations/0001_ausgang.sql", "CREATE TABLE zwei (wert int);\n");
    assert.notEqual(nachAusgang, anfang);
    const nachNeuer = await summeNach(wurzel, "src/db/migrations/0002_neu.sql", "CREATE TABLE drei (wert int);\n");
    assert.notEqual(nachNeuer, nachAusgang);
    assert.notEqual(await summeNach(wurzel, "src/db/migrations/rueckbau/0003_weg.sql", "DROP TABLE drei;\n"), nachNeuer);
  } finally {
    fs.rmSync(wurzel, { recursive: true, force: true });
  }
});
