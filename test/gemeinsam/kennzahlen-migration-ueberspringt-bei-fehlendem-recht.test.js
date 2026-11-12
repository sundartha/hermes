import { mock, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { starteHermesMitPglite } from "../abrechnung/server-mit-testdatenbank.js";

const ROLLE = "kennzahlen_leser";
const SICHT = "kennzahlen.messwerte";
const KENNZAHLEN_PRAEFIX = "[migrate] kennzahlen übersprungen:";
const SPERRFRIST = "SET LOCAL lock_timeout = '5s';";
const FEHLENDES_RECHT = "42501";
const SPERRFEHLER = "55P03";
const HTTP_OK = 200;
const TABELLEN = ["call", "account", "tenant"];
const LETZTE_MIGRATION = "CREATE TABLE IF NOT EXISTS leitungsplatz";

const laufendesHermes = await starteHermesMitPglite({
  alarmPostfach: "",
  zusatzRollen: [ROLLE],
  appRolleDatenbankAnlegen: true,
  appRolleVerwaltetZusatzRollen: true,
  appRolleErstelltRollen: true,
  clientBruecke: true,
});

function fehlerMit(code, text) {
  return Object.assign(new Error(text), { code });
}

function mitProtokoll(ablehnen) {
  const befehle = [];
  const Basis = pg.Pool;
  pg.Pool = class ProtokollPool extends Basis {
    async connect() {
      const client = await super.connect();
      const echteAbfrage = client.query;
      return {
        ...client,
        query: (text, parameter) => {
          const eintrag = String(text).trim();
          const fehler = ablehnen(eintrag);
          befehle.push(eintrag);
          return fehler ? Promise.reject(fehler) : echteAbfrage(text, parameter);
        },
      };
    }
  };
  return {
    befehle,
    beenden: () => {
      pg.Pool = Basis;
    },
  };
}

async function startMitMitschnitt(hermes, ablehnen) {
  const protokoll = mitProtokoll(ablehnen);
  const stderr = [];
  const fehlerzeilen = [];
  const abbrueche = [];
  mock.method(process.stderr, "write", (zeile) => {
    stderr.push(String(zeile));
    return true;
  });
  mock.method(console, "error", (...teile) => {
    fehlerzeilen.push(teile.join(" "));
  });
  mock.method(process, "exit", (code) => {
    abbrueche.push(code);
  });
  try {
    await hermes.schemaErneutAnwenden();
  } finally {
    protokoll.beenden();
    mock.restoreAll();
  }
  return { befehle: protokoll.befehle, stderr, fehlerzeilen, abbrueche };
}

function kennzahlenSchritte(befehle) {
  const rolle = befehle.findIndex((text) => text.startsWith("SELECT 1 FROM pg_roles"));
  return befehle.slice(rolle + 1, rolle + 4).map((text) => (text.includes(SICHT) ? "sicht" : text));
}

async function leserVersucht(hermes, abfrage) {
  return hermes.db.transaction(async (transaktion) => {
    await transaktion.exec(`SET LOCAL ROLE ${ROLLE}`);
    return transaktion.query(abfrage).then(
      (ergebnis) => ({ zeilen: ergebnis.rows.length }),
      (fehler) => ({ code: fehler.code }),
    );
  });
}

test("S22: Hat die Leserolle vorher SELECT auf call, account und tenant, nimmt der Start es ihr und sie liest weiter die Sicht", async () => {
  const hermes = laufendesHermes();
  for (const tabelle of TABELLEN) await hermes.db.exec(`GRANT SELECT ON ${tabelle} TO ${ROLLE}`);
  for (const tabelle of TABELLEN) {
    const vorher = await leserVersucht(hermes, `SELECT 1 FROM ${tabelle} LIMIT 1`);
    assert.equal(vorher.code, undefined, `Vorbedingung: ${tabelle} ist lesbar`);
  }
  await startMitMitschnitt(hermes, () => null);
  for (const tabelle of TABELLEN) {
    assert.deepEqual(await leserVersucht(hermes, `SELECT 1 FROM ${tabelle} LIMIT 1`), { code: FEHLENDES_RECHT }, `${tabelle} ist gesperrt`);
  }
  const sicht = await leserVersucht(hermes, `SELECT 1 FROM ${SICHT} LIMIT 1`);
  assert.equal(sicht.code, undefined, "die Sicht bleibt lesbar");
  assert.ok(sicht.zeilen > 0);
});

test("S27 und B6: Ein Sperrfehler 55P03 der Kennzahlen-Migration bricht den Start ab; die Migration setzt vorher lock_timeout 5 s", async () => {
  const hermes = laufendesHermes();
  const fehler = fehlerMit(SPERRFEHLER, "canceling statement due to lock timeout");
  const lauf = await startMitMitschnitt(hermes, (text) => (text.includes(SICHT) ? fehler : null));
  const migration = lauf.befehle.find((text) => text.includes(SICHT));
  assert.ok(migration.startsWith(SPERRFRIST), migration.slice(0, 60));
  assert.deepEqual(kennzahlenSchritte(lauf.befehle).slice(0, 2), ["BEGIN", "sicht"]);
  assert.equal(kennzahlenSchritte(lauf.befehle)[2], "ROLLBACK");
  assert.deepEqual(lauf.abbrueche, [1]);
  assert.ok(
    lauf.fehlerzeilen.some((zeile) => zeile.endsWith("Ursache: Kennzahlen-Sicht fehlgeschlagen: canceling statement due to lock timeout")),
    lauf.fehlerzeilen.join("\n"),
  );
  assert.deepEqual(lauf.stderr.filter((zeile) => zeile.startsWith(KENNZAHLEN_PRAEFIX)), []);
});

test("B6: Scheitert eine andere Migration mit 42501, bricht der Start ab und die Kennzahlen-Migration wird nicht übersprungen", async () => {
  const hermes = laufendesHermes();
  await hermes.db.exec("DELETE FROM schema_migrations");
  const fehler = fehlerMit(FEHLENDES_RECHT, "permission denied for table leitungsplatz");
  const lauf = await startMitMitschnitt(hermes, (text) => (text.includes(LETZTE_MIGRATION) ? fehler : null));
  assert.deepEqual(lauf.abbrueche, [1]);
  assert.ok(
    lauf.fehlerzeilen.some((zeile) => zeile.includes("Migration fehlgeschlagen (0014_leitungsplatz.sql)") && zeile.endsWith("permission denied for table leitungsplatz")),
    lauf.fehlerzeilen.join("\n"),
  );
  assert.deepEqual(lauf.stderr.filter((zeile) => zeile.startsWith(KENNZAHLEN_PRAEFIX)), []);
  assert.ok(!lauf.befehle.some((text) => text.includes(SICHT)));
});

test("B5: Fehlt der App-Rolle ein Recht, läuft der Start durch, die Logzeile nennt die Meldung und es gibt keine Sicht", async () => {
  const hermes = laufendesHermes();
  await hermes.db.exec(`RESET ROLE; REVOKE CREATE ON DATABASE ${(await hermes.db.query("SELECT current_database() AS name")).rows[0].name} FROM kv2_app; SET ROLE kv2_app;`);
  await hermes.db.exec("DROP SCHEMA kennzahlen CASCADE");
  const lauf = await startMitMitschnitt(hermes, () => null);
  assert.deepEqual(lauf.abbrueche, []);
  assert.deepEqual(lauf.fehlerzeilen, []);
  assert.deepEqual(kennzahlenSchritte(lauf.befehle), ["BEGIN", "sicht", "ROLLBACK"]);
  const zeilen = lauf.stderr.filter((zeile) => zeile.startsWith(KENNZAHLEN_PRAEFIX));
  assert.equal(zeilen.length, 1, lauf.stderr.join(""));
  assert.match(zeilen[0], /^\[migrate\] kennzahlen übersprungen: permission denied for database \S+\n$/);
  assert.ok(!zeilen[0].includes("postgres://"));
  assert.equal((await hermes.anfrage("/healthz")).status, HTTP_OK);
  const sicht = await hermes.db.query("SELECT count(*)::int AS anzahl FROM pg_views WHERE schemaname = 'kennzahlen'");
  assert.equal(sicht.rows[0].anzahl, 0);
});
