import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgTestStore } from "../pg-helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { echteDatenbank } from "./echtes-postgres.js";
import { mitGestartetemHermes } from "./pg-start-umgebung.js";

const HTTP_OK = 200;
const ZEITGRENZE_MS = 90_000;
const PLATTFORM_MANDANT = "owner";
const KONTO_SUB = "konto-vor-der-versionstabelle";
const KONTO_EMAIL_GROSS = "Inhaber@Beispiel.Test";
const KONTO_EMAIL_KLEIN = "inhaber@beispiel.test";
const ERWARTETE_MIGRATIONEN = [
  { version: "1", name: "0001_ausgang" },
  { version: "2", name: "0002_versionstabelle" },
  { version: "3", name: "0003_bestaetigungscodes" },
  { version: "4", name: "0004_login_bremse" },
  { version: "5", name: "0005_webhook_zustellung" },
  { version: "6", name: "0006_not_placed_mail_marker" },
  { version: "7", name: "0007_einstellungen_stand" },
  { version: "8", name: "0008_plattform_kostenstelle_zeichen" },
  { version: "9", name: "0009_mandant_stand" },
  { version: "10", name: "0010_bestaetigungscodes_loeschen" },
  { version: "11", name: "0011_el_call_control_id" },
];

async function kontenZaehlen(verbindung) {
  const { rows } = await verbindung.query("SELECT count(*)::int AS anzahl FROM account");
  return rows[0].anzahl;
}

function startenUndHealthzLesen(adresse) {
  return mitGestartetemHermes(
    adresse,
    { HERMES_DEPLOY_TOKEN: "s1-migrationen-start-deploy-token-mindestens-32" },
    async (prozess) => (await abrufMitFrist(`${prozess.localUrl}/healthz`)).status,
  );
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
    "SELECT version::text AS version, name FROM schema_migrations ORDER BY schema_migrations.version",
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
  "S1: leere Datenbank, Start antwortet auf /healthz mit 200 und trägt 0001_ausgang, 0002_versionstabelle und 0003_bestaetigungscodes ein",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const ergebnis = await leereDatenbankGestartet(t);
    if (!ergebnis) return;
    assert.equal(ergebnis.healthz, HTTP_OK);
    assert.deepEqual(
      ergebnis.zeilen,
      ERWARTETE_MIGRATIONEN,
      "schema_migrations muss 0001_ausgang, 0002_versionstabelle und 0003_bestaetigungscodes tragen",
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
      [
        "0001_ausgang",
        "0002_versionstabelle",
        "0003_bestaetigungscodes",
        "0004_login_bremse",
        "0005_webhook_zustellung",
        "0006_not_placed_mail_marker",
        "0007_einstellungen_stand",
        "0008_plattform_kostenstelle_zeichen",
        "0009_mandant_stand",
        "0010_bestaetigungscodes_loeschen",
        "0011_el_call_control_id",
      ],
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
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
      "Version 1, 2 und 3 müssen eingetragen sein (0001_ausgang)",
    );
    assert.equal(await kontenZaehlen(verbindung), kontenVorher);
  },
);

test(
  "S14: Datenbank auf Stand 0010 mit Anrufen, Start legt die Spalte el_call_control_id an, Anrufe bleiben mit NULL",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const vorbereitet = await gestarteteDatenbankMitKonto(t, KONTO_EMAIL_KLEIN);
    if (!vorbereitet) return;
    const { db, verbindung } = vorbereitet;
    await verbindung.query("ALTER TABLE call DROP COLUMN el_call_control_id");
    await verbindung.query("DELETE FROM schema_migrations WHERE version = 11");
    await verbindung.query("BEGIN");
    await verbindung.query("SELECT set_config('app.current_tenant', $1, true)", [PLATTFORM_MANDANT]);
    await verbindung.query(
      "INSERT INTO call (id, tenant_id, stream_token, direction, goal) VALUES ('call-vor-0011', $1, 'token-vor-0011', 'outbound', 'ziel-vor-0011')",
      [PLATTFORM_MANDANT],
    );
    await verbindung.query("COMMIT");

    assert.equal(await startenUndHealthzLesen(db.adresse), HTTP_OK);

    const eintraege = (await eingetragen(verbindung)).map((zeile) => zeile.name);
    assert.ok(eintraege.includes("0011_el_call_control_id"));
    const spalte = await verbindung.query(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'call' AND column_name = 'el_call_control_id'",
    );
    assert.equal(spalte.rows[0].data_type, "text");
    const zeilen = await imMandantenbereich(
      verbindung,
      "SELECT goal, el_call_control_id FROM call WHERE tenant_id = $1",
    );
    assert.deepEqual(zeilen.rows, [{ goal: "ziel-vor-0011", el_call_control_id: null }]);
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

test("S1/S13/S3: Start trägt Version 1, 2 und 3 mit Namen ohne .sql und sha256-Prüfsumme ein (ohne echtes Postgres)", async () => {
  const { db } = await makePgTestStore();
  const { rows } = await db.query(
    "SELECT version::text AS version, name, checksum FROM schema_migrations ORDER BY schema_migrations.version",
  );
  assert.deepEqual(
    rows.map(({ version, name }) => ({ version, name })),
    ERWARTETE_MIGRATIONEN,
    "schema_migrations muss 0001_ausgang, 0002_versionstabelle und 0003_bestaetigungscodes tragen",
  );
  for (const zeile of rows) assert.match(zeile.checksum, /^[0-9a-f]{64}$/);
});
