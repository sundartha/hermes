import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../../src/db/migrate.js";
import { neuePglite } from "../pglite-helfer.js";

const MANDANT = "owner";
const SICHT_DATEI = "kennzahlen.messwerte";
const FEHLER_TEXT = "Sicht kaputt";

async function datenbankMitRolle() {
  const db = await neuePglite();
  await db.exec("CREATE ROLE kennzahlen_leser NOLOGIN NOSUPERUSER NOBYPASSRLS;");
  return db;
}

function mitProtokoll(db, { scheitertBei = null } = {}) {
  const befehle = [];
  const huelle = {
    query: (text, parameter) => {
      befehle.push(String(text).trim());
      return db.query(text, parameter);
    },
    exec: (text) => {
      if (scheitertBei && text.includes(scheitertBei)) return Promise.reject(new Error(FEHLER_TEXT));
      befehle.push("exec");
      return db.exec(text);
    },
  };
  return { huelle, befehle };
}

function kennzahlenAbschnitt(befehle) {
  const rolle = befehle.findIndex((text) => text.startsWith("SELECT 1 FROM pg_roles"));
  return befehle.slice(rolle + 1, rolle + 4);
}

test("Die Sicht wird zwischen BEGIN und COMMIT angelegt", async () => {
  const db = await datenbankMitRolle();
  const { huelle, befehle } = mitProtokoll(db);
  await migrate(huelle, MANDANT);
  assert.deepEqual(kennzahlenAbschnitt(befehle), ["BEGIN", "exec", "COMMIT"]);
  const sicht = await db.query("SELECT to_regclass($1) AS sicht", [SICHT_DATEI]);
  assert.equal(sicht.rows[0].sicht, SICHT_DATEI);
});

test("Scheitert die Sicht, wird zurückgerollt und die Ursache mit dem Kennzahlen-Text weitergegeben", async () => {
  const db = await datenbankMitRolle();
  const { huelle, befehle } = mitProtokoll(db, { scheitertBei: "kennzahlen.messwerte" });
  const fehler = await migrate(huelle, MANDANT).then(
    () => null,
    (grund) => grund,
  );
  assert.equal(fehler?.message, `Kennzahlen-Sicht fehlgeschlagen: ${FEHLER_TEXT}`);
  assert.equal(fehler.cause.message, FEHLER_TEXT);
  assert.deepEqual(kennzahlenAbschnitt(befehle).slice(0, 2), ["BEGIN", "ROLLBACK"]);
});
