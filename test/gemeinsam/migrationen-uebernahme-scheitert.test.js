import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { startServer, startServerExpectExit } from "../helpers.js";
import { echteDatenbank } from "./echtes-postgres.js";
import { pgStartUmgebung } from "./pg-start-umgebung.js";

const START_FRIST_MS = 90_000;
const EXIT_NACH_ABBRUCH = 1;
const TOKEN = { HERMES_DEPLOY_TOKEN: "s4-uebernahme-scheitert-deploy-token-mindestens-32" };
const ERSTE_DATEI = "0001_ausgang.sql";
const ZWEITE_DATEI = "0002_versionstabelle.sql";
const FREMDE_DATEI = "0003_fremd.sql";
const ORDNER_VARIABLEN = ["MIGRATIONS_DIR", "MIGRATIONS_PATH", "HERMES_MIGRATIONS_DIR"];

async function tabelleVorhanden(verbindung, name) {
  const { rows } = await verbindung.query(
    "SELECT 1 FROM pg_class WHERE relname = $1 AND relkind = 'r'",
    [name],
  );
  return rows.length === 1;
}

test(
  "S4: scheitert 0002 bei fehlender Versionstabelle, endet der Start mit Exit 1, nennt beide Dateien und lässt nichts zurück",
  { timeout: START_FRIST_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const verbindung = await db.verbinden();
    await verbindung.query("CREATE TYPE schema_migrations AS ENUM ('kein_tabellenname')");

    const ergebnis = await startServerExpectExit({
      env: pgStartUmgebung(db.adresse, TOKEN),
      timeoutMs: START_FRIST_MS,
    });

    assert.equal(ergebnis.code, EXIT_NACH_ABBRUCH);
    assert.ok(
      ergebnis.output.includes(ERSTE_DATEI) && ergebnis.output.includes(ZWEITE_DATEI),
      `Meldung muss ${ERSTE_DATEI} und ${ZWEITE_DATEI} nennen:\n${ergebnis.output}`,
    );
    assert.equal(await tabelleVorhanden(verbindung, "schema_migrations"), false);
    assert.equal(
      await tabelleVorhanden(verbindung, "account"),
      false,
      "0001 gehört zur selben Transaktion und ist zurückgerollt",
    );
    assert.ok(!ergebnis.output.includes(db.adresse), "Zugangsdaten stehen nicht in der Ausgabe");
  },
);

test(
  "[NIE1] ein per Umgebungsvariable genannter Ordner mit einer weiteren Migration wird nicht ausgeführt",
  { timeout: START_FRIST_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const fremderOrdner = mkdtempSync(join(tmpdir(), "hermes-fremde-migrationen-"));
    writeFileSync(join(fremderOrdner, FREMDE_DATEI), "CREATE TABLE fremd_marker (id INT);");
    const ordnerUmgebung = Object.fromEntries(
      ORDNER_VARIABLEN.map((name) => [name, fremderOrdner]),
    );

    const prozess = await startServer({
      env: pgStartUmgebung(db.adresse, { ...TOKEN, ...ordnerUmgebung }),
    });
    await prozess.stop();

    const verbindung = await db.verbinden();
    assert.equal(await tabelleVorhanden(verbindung, "schema_migrations"), true);
    assert.equal(await tabelleVorhanden(verbindung, "fremd_marker"), false);
  },
);

test(
  "[NIE2] der Nachzug für Groß-E-Mails läuft bei jedem Start weiter, auch mit vorhandener Versionstabelle",
  { timeout: START_FRIST_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const umgebung = pgStartUmgebung(db.adresse, TOKEN);
    await (await startServer({ env: umgebung })).stop();
    const verbindung = await db.verbinden();
    await verbindung.query(
      "INSERT INTO account (sub, email, tenant_id) VALUES ('s4-konto', 'S4@Beispiel.Test', 'owner')",
    );

    await (await startServer({ env: umgebung })).stop();

    const { rows } = await verbindung.query("SELECT email FROM account WHERE sub = 's4-konto'");
    assert.equal(rows[0].email, "s4@beispiel.test");
  },
);
