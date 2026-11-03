import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer } from "../helpers.js";
import { makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { echteDatenbank } from "./echtes-postgres.js";

const HTTP_OK = 200;
const ZEITGRENZE_MS = 90_000;
const PLATTFORM_MANDANT = "owner";
const KONTO_SUB = "konto-vor-der-versionstabelle";
const KONTO_EMAIL_GROSS = "Inhaber@Beispiel.Test";
const KONTO_EMAIL_KLEIN = "inhaber@beispiel.test";
const ERWARTETE_MIGRATIONEN = [
  { version: "1", name: "0001_ausgang" },
  { version: "2", name: "0002_versionstabelle" },
];

async function kontenZaehlen(verbindung) {
  const { rows } = await verbindung.query("SELECT count(*)::int AS anzahl FROM account");
  return rows[0].anzahl;
}

function umgebung(adresse) {
  return {
    STORE_BACKEND: "pg",
    DATABASE_URL: adresse,
    BOOTSTRAP_E164: "+15005550006",
    BOOTSTRAP_PROVIDER: "telnyx",
    HERMES_DEPLOY_TOKEN: "s1-migrationen-start-deploy-token-mindestens-32",
  };
}

async function startenUndHealthzLesen(adresse) {
  const prozess = await startServer({ env: umgebung(adresse) });
  try {
    return (await abrufMitFrist(`${prozess.localUrl}/healthz`)).status;
  } finally {
    await prozess.stop();
  }
}

function kontoAnlegen(verbindung, email) {
  return verbindung.query("INSERT INTO account (sub, email, tenant_id) VALUES ($1, $2, $3)", [
    KONTO_SUB,
    email,
    PLATTFORM_MANDANT,
  ]);
}

async function imMandantenbereich(verbindung, abfrage) {
  await verbindung.query("BEGIN");
  try {
    await verbindung.query("SELECT set_config('app.current_tenant', $1, true)", [
      PLATTFORM_MANDANT,
    ]);
    return await verbindung.query(abfrage, [PLATTFORM_MANDANT]);
  } finally {
    await verbindung.query("COMMIT");
  }
}

async function eingetragen(verbindung) {
  const { rows } = await verbindung.query(
    "SELECT version::text AS version, name FROM schema_migrations ORDER BY version",
  );
  return rows;
}

async function leereDatenbankGestartet(t) {
  const db = await echteDatenbank(t);
  if (!db) return null;
  const healthz = await startenUndHealthzLesen(db.adresse);
  const verbindung = await db.verbinden();
  return { healthz, zeilen: await eingetragen(verbindung) };
}

async function gestarteteDatenbankMitKonto(t, email) {
  const db = await echteDatenbank(t);
  if (!db) return null;
  await startenUndHealthzLesen(db.adresse);
  const verbindung = await db.verbinden();
  await kontoAnlegen(verbindung, email);
  return { db, verbindung };
}

test(
  "S1: leere Datenbank, Start antwortet auf /healthz mit 200 und trägt 0001_ausgang und 0002_versionstabelle ein",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const ergebnis = await leereDatenbankGestartet(t);
    if (!ergebnis) return;
    assert.equal(ergebnis.healthz, HTTP_OK);
    assert.deepEqual(
      ergebnis.zeilen,
      ERWARTETE_MIGRATIONEN,
      "schema_migrations muss 0001_ausgang und 0002_versionstabelle tragen",
    );
  },
);

test(
  "S13: leere Datenbank, schema_migrations trägt je Migrationsdatei einen Namen ohne .sql",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const ergebnis = await leereDatenbankGestartet(t);
    if (!ergebnis) return;
    const namen = ergebnis.zeilen.map((zeile) => zeile.name);
    assert.deepEqual(
      namen,
      ["0001_ausgang", "0002_versionstabelle"],
      "ein Name je Datei: 0001_ausgang",
    );
    assert.ok(namen.every((name) => !name.endsWith(".sql")));
  },
);

test(
  "S3: Datenbank mit Konten, aber ohne schema_migrations, wird übernommen, Konten bleiben",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const vorbereitet = await gestarteteDatenbankMitKonto(t, KONTO_EMAIL_KLEIN);
    if (!vorbereitet) return;
    const { db, verbindung } = vorbereitet;
    await verbindung.query("DROP TABLE schema_migrations");
    const kontenVorher = await kontenZaehlen(verbindung);
    assert.equal(kontenVorher, 1);

    assert.equal(await startenUndHealthzLesen(db.adresse), HTTP_OK);

    const versionen = (await eingetragen(verbindung)).map((zeile) => zeile.version);
    assert.deepEqual(
      versionen,
      ["1", "2"],
      "Version 1 und 2 müssen eingetragen sein (0001_ausgang)",
    );
    assert.equal(await kontenZaehlen(verbindung), kontenVorher);
  },
);

test(
  "[NIE1] Nachzüge und Grunddaten laufen bei jedem Start weiter: Groß-E-Mail wird klein, gelöschte Einstellungen kehren zurück",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const vorbereitet = await gestarteteDatenbankMitKonto(t, KONTO_EMAIL_GROSS);
    if (!vorbereitet) return;
    const { db, verbindung } = vorbereitet;
    await imMandantenbereich(verbindung, "DELETE FROM settings WHERE tenant_id = $1");

    assert.equal(await startenUndHealthzLesen(db.adresse), HTTP_OK);

    const konto = await verbindung.query("SELECT email FROM account WHERE sub = $1", [KONTO_SUB]);
    assert.equal(konto.rows[0].email, KONTO_EMAIL_KLEIN);
    const einstellungen = await imMandantenbereich(
      verbindung,
      "SELECT 1 FROM settings WHERE tenant_id = $1",
    );
    assert.equal(einstellungen.rows.length, 1);
  },
);

test("S1/S13/S3: Start trägt Version 1 und 2 mit Namen ohne .sql und sha256-Prüfsumme ein (ohne echtes Postgres)", async () => {
  const { db } = await makePgTestStore();
  const { rows } = await db.query(
    "SELECT version::text AS version, name, checksum FROM schema_migrations ORDER BY version",
  );
  assert.deepEqual(
    rows.map(({ version, name }) => ({ version, name })),
    ERWARTETE_MIGRATIONEN,
    "schema_migrations muss 0001_ausgang und 0002_versionstabelle tragen",
  );
  for (const zeile of rows) assert.match(zeile.checksum, /^[0-9a-f]{64}$/);
});
