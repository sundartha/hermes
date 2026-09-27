// Oeffnet den pg-Store fuer ein Betreiber-Skript OHNE Migration (scripts/seed-reviewer-demo.mjs).
//
// Warum: der Server-Boot migriert (src/store.js -> makePgStore().init -> migrate, DDL aus
// src/db/schema.sql). Ein Skript, das denselben Weg nimmt, wendet die DDL SEINES Checkouts auf
// die Zieldatenbank an - liegt der Checkout vor oder hinter dem deployten Stand, also fremde
// DDL auf die Produktions-DB - und schreibt danach beim Flush alle Mandanten in der Zeilenform
// seines Stands zurueck. Deshalb laeuft gegen die Zieldatenbank hier KEINE DDL:
// - Das erwartete Schema entsteht in einer fluechtigen In-Memory-Datenbank (pglite) mit genau
//   der Migration dieses Checkouts - nie in der Zieldatenbank.
// - Gegen die Zieldatenbank laeuft statt migrate nur ein lesender Abgleich ueber
//   information_schema.columns. Fehlt eine erwartete Tabelle oder Spalte (Checkout neuer als
//   die DB) oder traegt eine erwartete Tabelle eine unbekannte Spalte (Checkout aelter als die
//   DB), wirft er: init endet dann VOR Hydrierung und jedem Schreiben.
// - Tabellen, die dieser Stand nicht kennt, bleiben aussen vor: der Flush beruehrt sie nie.
// Der Abgleich vergleicht Tabellen- und Spaltennamen, keine Typen oder Constraints.
// pglite ist eine Entwicklungs-Abhaengigkeit: das Skript laeuft aus einem vollstaendig
// installierten Checkout (npm ci), nie auf dem Dienst selbst.
import { makePgStore } from "../../src/store/pg.js";
import { migrate } from "../../src/db/migrate.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";

const SCHEMA_COLUMNS_SQL =
  "SELECT table_name, column_name FROM information_schema.columns " +
  "WHERE table_schema = current_schema()";

// Tabelle -> Menge ihrer Spalten im aktuellen Schema der Verbindung. Rein lesend.
export async function readSchemaColumns(db) {
  const { rows } = await db.query(SCHEMA_COLUMNS_SQL);
  const tables = new Map();
  for (const { table_name: table, column_name: column } of rows) {
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table).add(column);
  }
  return tables;
}

// Das Schema, das die Migration DIESES Checkouts erzeugt - in einer pglite-Instanz, die mit
// dem Aufruf wieder verschwindet.
export async function expectedSchemaColumns() {
  const { PGlite } = await import("@electric-sql/pglite");
  const scratch = new PGlite();
  try {
    await migrate(scratch, BOOTSTRAP_TENANT_ID);
    return await readSchemaColumns(scratch);
  } finally {
    await scratch.close();
  }
}

// Abweichungen von actual gegen expected als "tabelle" bzw. "tabelle.spalte".
export function schemaDifferences(expected, actual) {
  const missing = [];
  const unknown = [];
  for (const [table, columns] of expected) {
    const present = actual.get(table);
    if (!present) {
      missing.push(table);
      continue;
    }
    for (const column of columns) if (!present.has(column)) missing.push(`${table}.${column}`);
    for (const column of present) if (!columns.has(column)) unknown.push(`${table}.${column}`);
  }
  return { missing, unknown };
}

const listOrNone = (names) => (names.length === 0 ? "-" : names.join(", "));

// Schema-Schritt fuer makePgStore anstelle von migrate: liest nur und wirft bei Abweichung.
function schemaCheck(expected) {
  return async (client) => {
    const { missing, unknown } = schemaDifferences(expected, await readSchemaColumns(client));
    const matches = missing.length === 0 && unknown.length === 0;
    if (matches) return;
    throw new Error(
      `Schema der Zieldatenbank passt nicht zu diesem Checkout (fehlt: ${listOrNone(missing)}; ` +
        `unbekannt: ${listOrNone(unknown)}). Das Skript fuehrt keine DDL aus - vom deployten ` +
        "Commit aus starten. Nichts geschrieben.",
    );
  };
}

// pg-Store auf runner OHNE Migration: init prueft das Schema gegen expected (aus
// expectedSchemaColumns) und bricht bei jeder Abweichung ab, bevor hydriert oder geschrieben
// wird. Danach wie beim Boot: Hydrierung ueber die RLS-GUC je Mandant und dieselben
// Boot-Heilungen aus init (src/store/pg.js), die nur Fehlendes setzen: fehlender
// Begruessungshinweis je Mandant, KYC-Stufe des Betreiber-Mandanten und dessen idp_subject aus
// OWNER_IDP_SUBJECT der LOKALEN Konfiguration dieses Laufs. Ohne Wirkung bleiben sie nur, wenn
// die Zieldatenbank diese Werte schon traegt; fehlt dem Betreiber-Mandanten dort das
// idp_subject, schriebe der Lauf den lokalen Wert - korrekt nur, wenn die lokale .env der
// Produktion entspricht.
export async function openPgStoreWithoutMigration(runner, expected) {
  const store = makePgStore(runner, { prepareSchema: schemaCheck(expected) });
  await store.init();
  return store;
}
