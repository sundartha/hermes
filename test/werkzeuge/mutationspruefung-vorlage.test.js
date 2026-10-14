import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cwd } from "node:process";
import { test } from "node:test";

import { vorlagenKette } from "../pg-helpers.js";
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
    "src/db/schema.sql": "CREATE TABLE eins (wert int);\n",
    "src/store/defaults.js": "export const STANDARD = 1;\n",
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

test("Vorlagenkette: enthält den Aufbau der Vorlage und seine Importe, nicht den Speicher, gleich wie im Testhelfer", async () => {
  const kette = await vorlagenkette(cwd());
  for (const datei of IN_DER_KETTE) assert.ok(kette.includes(datei), datei);
  assert.ok(!kette.includes(STORE));
  assert.deepEqual(kette, vorlagenKette());
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

test("Kettensumme: ändert sich mit jeder Datei der Kette und mit schema.sql, nicht mit dem Speicher", async () => {
  const wurzel = attrappe();
  try {
    assert.deepEqual(await vorlagenkette(wurzel), ["src/db/migrate.js", "src/store/defaults.js"]);
    const anfang = await summeNach(wurzel);
    assert.equal(await summeNach(wurzel, "src/store/pg.js", "export const ANDERS = 2;\n"), anfang);
    const nachDefaults = await summeNach(wurzel, "src/store/defaults.js", "export const ANDERS = 2;\n");
    assert.notEqual(nachDefaults, anfang);
    assert.notEqual(await summeNach(wurzel, "src/db/schema.sql", "CREATE TABLE zwei (wert int);\n"), nachDefaults);
  } finally {
    fs.rmSync(wurzel, { recursive: true, force: true });
  }
});
