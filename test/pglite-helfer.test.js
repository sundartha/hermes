import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makePgStore } from "../src/store/pg.js";
import { makePgTestStore } from "./pg-helpers.js";
import { neuePglite, vorlage } from "./pglite-helfer.js";

const KINDPROZESS_OBERGRENZE_MS = 20_000;
const KIND = fileURLToPath(new URL("./pglite-helfer-kind.js", import.meta.url));
const STRYKER_VARIABLE = "__STRYKER_ACTIVE_MUTANT__";
const VORLAGEN_ORDNER = path.join(os.tmpdir(), "hermes-pglite-vorlagen");

const TABELLE_ZAEHLEN =
  "SELECT count(*)::int AS anzahl FROM pg_tables WHERE tablename = 'isolationsprobe'";

async function anzahl(db, sql) {
  const { rows } = await db.query(sql);
  return rows[0].anzahl;
}

test("Isolation A: Speicher hinterlaesst Zeile und Tabelle", async () => {
  const { db } = await makePgTestStore();
  await db.query("INSERT INTO tenant (id) VALUES ('isolationsprobe')");
  await db.exec("CREATE TABLE isolationsprobe (wert int)");
  assert.equal(await anzahl(db, TABELLE_ZAEHLEN), 1);
});

test("Isolation B: neuer Speicher sieht weder Zeile noch Tabelle", async () => {
  const { db } = await makePgTestStore();
  const zeilen = "SELECT count(*)::int AS anzahl FROM tenant WHERE id = 'isolationsprobe'";
  assert.equal(await anzahl(db, zeilen), 0);
  assert.equal(await anzahl(db, TABELLE_ZAEHLEN), 0);
});

test("Isolation C: direkte Datenbank legt Tabelle an", async () => {
  const db = await neuePglite();
  await db.exec("CREATE TABLE isolationsprobe (wert int)");
  assert.equal(await anzahl(db, TABELLE_ZAEHLEN), 1);
});

test("Isolation D: neue direkte Datenbank sieht die Tabelle nicht", async () => {
  const db = await neuePglite();
  assert.equal(await anzahl(db, TABELLE_ZAEHLEN), 0);
});

async function mitStrykerVariable(wert, lauf) {
  const alt = process.env[STRYKER_VARIABLE];
  const setzen = (neu) => {
    if (neu === undefined) delete process.env[STRYKER_VARIABLE];
    else process.env[STRYKER_VARIABLE] = neu;
  };
  setzen(wert);
  try {
    await lauf();
  } finally {
    setzen(alt);
  }
}

function vorlagenDateien(name) {
  if (!fs.existsSync(VORLAGEN_ORDNER)) return [];
  return fs.readdirSync(VORLAGEN_ORDNER).filter((datei) => datei.startsWith(`${name}-`));
}

function vorlagenLoeschen(name) {
  for (const datei of vorlagenDateien(name)) fs.rmSync(path.join(VORLAGEN_ORDNER, datei));
}

const leerEinrichten = async () => {};
const DATEIEN_FUER_ZWEI_VERSCHIEDENE_SCHLUESSEL = 2;

test("Vorlagen: verschiedene Schluesselteile ergeben verschiedene Dateien, gleiche dieselbe", async () => {
  const name = `probe-schluessel-${process.pid}`;
  try {
    await mitStrykerVariable(undefined, async () => {
      await vorlage(name, leerEinrichten, ["eins"]);
      await vorlage(name, leerEinrichten, ["eins"]);
      assert.equal(vorlagenDateien(name).length, 1);
      await vorlage(name, leerEinrichten, ["zwei"]);
      assert.equal(vorlagenDateien(name).length, DATEIEN_FUER_ZWEI_VERSCHIEDENE_SCHLUESSEL);
    });
  } finally {
    vorlagenLoeschen(name);
  }
});

test("Vorlagen: unter aktivem Mutanten entsteht keine Datei", async () => {
  const name = `probe-mutant-${process.pid}`;
  try {
    await mitStrykerVariable("1", async () => {
      await vorlage(name, leerEinrichten, ["eins"]);
    });
    assert.deepEqual(vorlagenDateien(name), []);
  } finally {
    vorlagenLoeschen(name);
  }
});

function kindAusfuehren(fall) {
  const ergebnis = spawnSync(process.execPath, [KIND, fall], {
    timeout: KINDPROZESS_OBERGRENZE_MS,
    encoding: "utf8",
  });
  const ausgabe = `${ergebnis.stdout}\n${ergebnis.stderr}`;
  assert.equal(ergebnis.signal, null, `Kind ${fall} erreichte die Frist:\n${ausgabe}`);
  assert.equal(ergebnis.status, 0, `Kind ${fall} endete rot:\n${ausgabe}`);
}

test("Aufraeumen (a): laufender Speichervorgang", () => kindAusfuehren("a"));
test("Aufraeumen (b): laufende Abfrage ohne Speicher", () => kindAusfuehren("b"));
test("Aufraeumen (c): verlorener Haken", () => kindAusfuehren("c"));

const KATALOG_ABFRAGEN_SCHEMA_PUBLIC = {
  spalten: `SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`,
  constraints: `SELECT conrelid::regclass::text AS tabelle, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`,
  indexe:
    "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2",
  policies: "SELECT * FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname",
  trigger: `SELECT tgrelid::regclass::text AS tabelle, tgname, pg_get_triggerdef(oid) AS def
    FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`,
  funktionen: `SELECT proname, pg_get_function_identity_arguments(oid) AS argumente,
    pg_get_functiondef(oid) AS def, proacl::text AS rechte
    FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY 1, 2`,
  zeilensicherheit: `SELECT relname, relkind, relrowsecurity, relforcerowsecurity, relacl::text AS rechte
    FROM pg_class WHERE relnamespace = 'public'::regnamespace ORDER BY 1`,
  rechte: `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema = 'public' ORDER BY 1, 2, 3`,
  sequenzen: "SELECT * FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename",
};

async function tabellenDaten(db) {
  const { rows: tabellen } = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
  );
  const daten = {};
  for (const { tablename } of tabellen) {
    const { rows } = await db.query(`SELECT * FROM public."${tablename}"`);
    const ohneAnlagezeit = rows.map((zeile) => {
      const kopie = { ...zeile };
      if (tablename === "tenant") delete kopie.created_at;
      return JSON.stringify(kopie);
    });
    daten[tablename] = ohneAnlagezeit.sort();
  }
  return daten;
}

async function beschreibung(db) {
  const katalog = {};
  for (const [bereich, sql] of Object.entries(KATALOG_ABFRAGEN_SCHEMA_PUBLIC))
    katalog[bereich] = (await db.query(sql)).rows;
  return { katalog, daten: await tabellenDaten(db) };
}

test("Gleichheit: Schema-Vorlage plus init gleicht frischer Datenbank plus init", async () => {
  const frisch = await neuePglite();
  const frischerStore = makePgStore({ withClient: (fn) => fn(frisch) });
  await frischerStore.init();
  await frischerStore.drainFlushes();
  const ausVorlage = await makePgTestStore();
  await ausVorlage.store.drainFlushes();

  const erwartet = await beschreibung(frisch);
  const erhalten = await beschreibung(ausVorlage.db);
  assert.ok(erwartet.daten.tenant.length > 0, "frische Seite: keine Owner-Zeile in tenant gelesen");
  assert.ok(
    erhalten.daten.tenant.length > 0,
    "Vorlagen-Seite: keine Owner-Zeile in tenant gelesen",
  );
  for (const bereich of Object.keys(KATALOG_ABFRAGEN_SCHEMA_PUBLIC)) {
    assert.deepEqual(erhalten.katalog[bereich], erwartet.katalog[bereich], `Katalog: ${bereich}`);
  }
  assert.deepEqual(erhalten.daten, erwartet.daten);
});
