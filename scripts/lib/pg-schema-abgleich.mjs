import { makePgStore } from "../../src/store/pg.js";
import { migrate } from "../../src/db/migrate.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";

const SCHEMA_COLUMNS_SQL =
  "SELECT table_name, column_name FROM information_schema.columns " +
  "WHERE table_schema = current_schema()";

export async function readSchemaColumns(db) {
  const { rows } = await db.query(SCHEMA_COLUMNS_SQL);
  const tables = new Map();
  for (const { table_name: table, column_name: column } of rows) {
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table).add(column);
  }
  return tables;
}

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

export async function openPgStoreWithoutMigration(runner, expected) {
  const store = makePgStore(runner, { prepareSchema: schemaCheck(expected) });
  await store.init();
  return store;
}
