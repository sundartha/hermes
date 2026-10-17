import assert from "node:assert/strict";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/migrationen-pruefen.mjs");
const EXIT_GREEN = 0;
const EXIT_RED = 1;
const SCHEMA = "src/db/schema.sql";
const START = "src/db/migrations/0001_ausgang.sql";
const SCHEMA_TEXT = "CREATE TABLE IF NOT EXISTS tenant (id text PRIMARY KEY);\n";
const LIMITS = "SET LOCAL lock_timeout = '2s';\nSET LOCAL statement_timeout = '30s';\n";
const ADD_COLUMN = `${LIMITS}ALTER TABLE tenant ADD COLUMN IF NOT EXISTS name text;\n`;
const DROP_COLUMN = `${LIMITS}ALTER TABLE tenant DROP COLUMN IF EXISTS name;\n`;

const BASE_FILES = {
  ".gitignore": "node_modules\n",
  "tools/basis/squawk.toml": 'pg_version = "16.0"\nassume_in_transaction = true\n',
  "src/db/migrate.js": "export const ANWENDEN = true;\n",
};

function run(repo, args) {
  const result = runIn(repo, process.execPath, [TOOL, ...args]);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function checkChange(context, before, after) {
  return checkChangeWith(context, { before, after, args: ["--basis", "HEAD~1"] });
}

function checkChangeWith(context, { before, after, args }) {
  const repo = probeRepository(context, { ...BASE_FILES, ...before });
  const removed = Object.keys(after).filter((path) => after[path] === null);
  for (const path of removed) rmSync(join(repo, path));
  writeFiles(
    repo,
    Object.fromEntries(Object.entries(after).filter(([, content]) => content !== null)),
  );
  commitAll(repo, "Stand");
  symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
  return run(repo, args);
}

function assertRed(result, ...fragments) {
  assert.equal(result.status, EXIT_RED, result.output);
  for (const fragment of fragments)
    assert.ok(result.output.includes(fragment), `${fragment}\n${result.output}`);
  assert.match(result.output, /^Ausweg: /m);
}

const MERGED = { [START]: SCHEMA_TEXT, "src/db/migrations/0002_name.sql": ADD_COLUMN };

test("migrationen: ohne Migrationen und ohne Schemaänderung im Code endet grün ohne Ausgabe", (context) => {
  const result = checkChange(
    context,
    { [SCHEMA]: SCHEMA_TEXT },
    { "src/a.js": "export const a = 1;\n" },
  );
  assert.equal(result.status, EXIT_GREEN, result.output);
  assert.equal(result.output, "");
});

test("migrationen: Ausgangsmigration ist nur als unveränderte Umbenennung von schema.sql von Squawk ausgenommen", (context) => {
  const moved = checkChange(
    context,
    { [SCHEMA]: SCHEMA_TEXT },
    { [SCHEMA]: null, [START]: SCHEMA_TEXT },
  );
  assert.equal(moved.status, EXIT_GREEN, moved.output);
  const changed = checkChange(
    context,
    { [SCHEMA]: SCHEMA_TEXT },
    { [SCHEMA]: null, [START]: `${SCHEMA_TEXT}DROP TABLE alt;\n` },
  );
  assertRed(changed, `${START}: Ausgangsmigration ist nicht unverändert`, "ban-drop-table");
  const besides = checkChange(context, { [SCHEMA]: SCHEMA_TEXT }, { [START]: SCHEMA_TEXT });
  assertRed(besides, `${SCHEMA}: liegt neben src/db/migrations/`);
});

test("migrationen: neue Migration mit Zeitgrenzen ist grün, ohne Zeitgrenzen rot", (context) => {
  const withLimits = checkChange(
    context,
    { [START]: SCHEMA_TEXT },
    { "src/db/migrations/0002_name.sql": ADD_COLUMN },
  );
  assert.equal(withLimits.status, EXIT_GREEN, withLimits.output);
  const without = checkChange(
    context,
    { [START]: SCHEMA_TEXT },
    {
      "src/db/migrations/0002_name.sql": "ALTER TABLE tenant ADD COLUMN IF NOT EXISTS name text;\n",
    },
  );
  assertRed(without, "require-lock-timeout", "require-statement-timeout");
});

test("migrationen: DROP COLUMN ist in einer normalen Migration rot und nur allein im Rückbau-Ordner grün", (context) => {
  assertRed(
    checkChange(context, MERGED, { "src/db/migrations/0003_weg.sql": DROP_COLUMN }),
    "ban-drop-column",
  );
  const alone = checkChange(context, MERGED, {
    "src/db/migrations/rueckbau/0003_weg.sql": DROP_COLUMN,
  });
  assert.equal(alone.status, EXIT_GREEN, alone.output);
  const withCode = checkChange(context, MERGED, {
    "src/db/migrations/rueckbau/0003_weg.sql": DROP_COLUMN,
    "src/store/name.js": "export const NAME = null;\n",
  });
  assertRed(withCode, "src/store/name.js: geändert im selben Stand wie eine Rückbau-Migration");
  const renamed = checkChange(context, MERGED, {
    "src/db/migrations/rueckbau/0003_neu.sql": `${LIMITS}ALTER TABLE tenant RENAME COLUMN name TO titel;\n`,
  });
  assertRed(renamed, "renaming-column");
});

test("migrationen: gemergte Migrationen bleiben unverändert, neue Nummern steigen und folgen dem Namensmuster", (context) => {
  const path = "src/db/migrations/0002_name.sql";
  assertRed(
    checkChange(context, MERGED, { [path]: `${ADD_COLUMN}SELECT 1;\n` }),
    `${path}: schon gemergte Migration geändert`,
  );
  assertRed(
    checkChange(context, MERGED, { [path]: null }),
    `${path}: schon gemergte Migration gelöscht`,
  );
  assertRed(
    checkChange(
      context,
      { ...MERGED, "src/db/migrations/0005_spaet.sql": ADD_COLUMN },
      { "src/db/migrations/0003_frueh.sql": ADD_COLUMN },
    ),
    "src/db/migrations/0003_frueh.sql: Nummer 0003 ist nicht größer als die höchste gemergte (0005)",
  );
  assertRed(
    checkChange(context, MERGED, { "src/db/migrations/0003_Gross.sql": ADD_COLUMN }),
    "0003_Gross.sql: Name passt nicht",
  );
  assertRed(
    checkChange(context, MERGED, {
      "src/db/migrations/0003_a.sql": ADD_COLUMN,
      "src/db/migrations/rueckbau/0003_b.sql": DROP_COLUMN,
    }),
    "Nummer 0003 hat schon",
  );
});

test("migrationen: Schemaänderung im Code und SQL-Dateien außerhalb des Ordners sind rot", (context) => {
  assertRed(
    checkChange(context, MERGED, {
      "src/store/heilung.js": 'export const SQL = "alter table tenant add column x text";\n',
    }),
    "src/store/heilung.js:1: Schemaänderung im Code",
  );
  assertRed(
    checkChange(context, MERGED, {
      "scripts/nachzug.mjs": "await db.exec(`CREATE INDEX i ON tenant (id)`);\n",
    }),
    "scripts/nachzug.mjs:1:",
  );
  assertRed(
    checkChange(context, MERGED, { "src/db/nachzug.sql": ADD_COLUMN }),
    "src/db/nachzug.sql: SQL-Datei außerhalb",
  );
});

test("migrationen: Schemaänderung mit Zusatzwort vor der Objektart ist im Code rot, Fließtext nicht", (context) => {
  const statements = [
    "CREATE MATERIALIZED VIEW umsatz AS SELECT id FROM tenant",
    "CREATE UNLOGGED TABLE zwischen (id text)",
    "DROP MATERIALIZED VIEW umsatz",
    "CREATE CONSTRAINT TRIGGER pruefen AFTER INSERT ON tenant",
    "CREATE TEMPORARY TABLE rest (id text)",
    "CREATE OR REPLACE RECURSIVE VIEW kette (id) AS SELECT 1",
  ];
  const prose = "create the table later";
  const lines = [...statements, prose].map((text) => `export const q = "${text}";`);
  const result = checkChange(context, MERGED, { "src/store/sonder.js": `${lines.join("\n")}\n` });
  assertRed(
    result,
    ...statements.map((_, index) => `src/store/sonder.js:${index + 1}: Schemaänderung im Code`),
  );
  assert.ok(!result.output.includes(`src/store/sonder.js:${lines.length}:`), result.output);
});

test("migrationen: eine eigene .squawk.toml lockert nichts", (context) => {
  const result = checkChange(context, MERGED, {
    ".squawk.toml": 'excluded_rules = ["ban-drop-column"]\n',
    "src/db/migrations/.squawk.toml": 'excluded_rules = ["ban-drop-column"]\n',
    "src/db/migrations/0003_weg.sql": DROP_COLUMN,
  });
  assertRed(result, "ban-drop-column", "src/db/migrations/.squawk.toml: Name passt nicht");
});

test("migrationen: ein Kommentar squawk-ignore in einer Migration lockert nichts", (context) => {
  const result = checkChange(context, MERGED, {
    "src/db/migrations/0003_weg.sql": `-- squawk-ignore-file\n${DROP_COLUMN}`,
    "src/db/migrations/rueckbau/0004_um.sql": `-- Squawk-Ignore renaming-column\n${LIMITS}ALTER TABLE tenant RENAME COLUMN name TO titel;\n`,
  });
  assertRed(
    result,
    "src/db/migrations/0003_weg.sql: Kommentar squawk-ignore",
    "src/db/migrations/rueckbau/0004_um.sql: Kommentar squawk-ignore",
  );
});

test("migrationen: ohne Basis prüft Squawk alle Migrationen außer der Ausgangsmigration, mit unlesbarer Basis ist es rot", (context) => {
  const whole = checkChangeWith(context, {
    before: MERGED,
    after: { "src/db/migrations/0003_weg.sql": DROP_COLUMN },
    args: [],
  });
  assertRed(whole, "ban-drop-column");
  assert.ok(!whole.output.includes(START), whole.output);
  assertRed(
    checkChangeWith(context, {
      before: MERGED,
      after: { "src/a.js": "export const a = 1;\n" },
      args: ["--basis", ""],
    }),
    '--basis "" ist kein lesbarer Commit',
  );
});
