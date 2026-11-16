import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { commitAll, probeRepository, runIn, writeFiles } from "../gemeinsam/umgebung.mjs";

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const ORDNER = "src/db/migrations";

function einstufung(context, dateien) {
  const repo = probeRepository(context, { "LIESMICH.md": "x\n" });
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(repo, Object.fromEntries(Object.entries(dateien).map(([name, sql]) => [`${ORDNER}/${name}`, sql])));
  commitAll(repo, "Migration");
  const lauf = runIn(repo, process.execPath, [join(WURZEL, "tools/pruefen.mjs"), "migrationen", "--einstufung", "--basis", basis]);
  return { repo, status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

const NICHT = [
  ["CREATE TABLE", "CREATE TABLE a (id int);"],
  ["ADD COLUMN nullable", "ALTER TABLE a ADD COLUMN b text;"],
  ["CREATE INDEX", "CREATE INDEX a_b ON a (b);"],
  ["alle drei zusammen", "CREATE TABLE a (id int);\nALTER TABLE a ADD COLUMN b text;\nCREATE INDEX a_b ON a (b);"],
  ["Gefährliches nur im Kommentar", "-- DROP TABLE a;\n/* DELETE FROM a;\nTRUNCATE a; */\nCREATE TABLE b (id int);"],
  ["Gefährliches im Text steht nicht im Kommentar", "INSERT INTO b VALUES ('-- x');\nCREATE TABLE c (id int);"],
];

for (const [name, sql] of NICHT) {
  test(`Einstufung nicht-zerstoerend: ${name}`, (context) => {
    const ergebnis = einstufung(context, { "0021_a.sql": sql });
    assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
    assert.match(ergebnis.ausgabe, /^Einstufung: nicht-zerstoerend$/m);
  });
}

const ZERSTOEREND = [
  ["DROP TABLE", "DROP TABLE a;"],
  ["DROP COLUMN", "ALTER TABLE a DROP COLUMN b;"],
  ["DELETE FROM", "DELETE FROM a;"],
  ["TRUNCATE", "TRUNCATE a;"],
  ["ALTER COLUMN TYPE", "ALTER TABLE a ALTER COLUMN b TYPE bigint;"],
  ["ALTER COLUMN SET DATA TYPE", "ALTER TABLE a ALTER COLUMN b SET DATA TYPE bigint;"],
  ["SET NOT NULL", "ALTER TABLE a ALTER COLUMN b SET NOT NULL;"],
  ["RENAME", "ALTER TABLE a RENAME TO c;"],
  ["Kleinschreibung", "drop table a;"],
  ["Gemischte Schreibweise", "Delete\n  From a;"],
  ["nach einem Kommentar in derselben Datei", "-- harmlos\nCREATE TABLE b (id int);\nDROP TABLE a;"],
  ["nach einem Text mit Kommentarzeichen", "SELECT '--'; DROP TABLE a;"],
];

for (const [name, sql] of ZERSTOEREND) {
  test(`Einstufung zerstoerend: ${name}`, (context) => {
    const ergebnis = einstufung(context, { "0021_a.sql": sql });
    assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
    assert.match(ergebnis.ausgabe, /^Einstufung: zerstoerend$/m);
  });
}

test("Mehrere Migrationen: eine zerstörende genügt", (context) => {
  const ergebnis = einstufung(context, { "0021_a.sql": "CREATE TABLE a (id int);", "0022_b.sql": "DROP TABLE a;", "0023_c.sql": "CREATE TABLE c (id int);" });
  assert.match(ergebnis.ausgabe, /^Einstufung: zerstoerend$/m);
});

test("Mehrere nicht zerstörende Migrationen bleiben nicht zerstörend", (context) => {
  const ergebnis = einstufung(context, { "0021_a.sql": "CREATE TABLE a (id int);", "0022_b.sql": "CREATE INDEX i ON a (id);" });
  assert.match(ergebnis.ausgabe, /^Einstufung: nicht-zerstoerend$/m);
});

test("Diff ohne Migration: keine-migration", (context) => {
  const repo = probeRepository(context, { "LIESMICH.md": "x\n" });
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(repo, { "LIESMICH.md": "y\n" });
  commitAll(repo, "Text");
  const lauf = runIn(repo, process.execPath, [join(WURZEL, "tools/pruefen.mjs"), "migrationen", "--einstufung", "--basis", basis]);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.match(lauf.stdout, /^Einstufung: keine-migration$/m);
});

test("Nicht lesbare Migrationsdatei: zerstoerend", (context) => {
  const repo = probeRepository(context, { "LIESMICH.md": "x\n" });
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(repo, { [`${ORDNER}/0021_a.sql`]: "CREATE TABLE a (id int);" });
  commitAll(repo, "Migration");
  chmodSync(join(repo, ORDNER, "0021_a.sql"), 0o000);
  const lauf = runIn(repo, process.execPath, [join(WURZEL, "tools/pruefen.mjs"), "migrationen", "--einstufung", "--basis", basis]);
  assert.match(lauf.stdout, /^Einstufung: zerstoerend$/m);
});

test("Ohne --einstufung bleibt die Ausgabe ohne Einstufung", (context) => {
  const repo = probeRepository(context, { "LIESMICH.md": "x\n" });
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const lauf = runIn(repo, process.execPath, [join(WURZEL, "tools/pruefen.mjs"), "migrationen", "--basis", basis]);
  assert.doesNotMatch(lauf.stdout, /Einstufung/);
});
