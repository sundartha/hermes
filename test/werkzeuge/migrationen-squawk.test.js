import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { commitAll, probeRepository, runIn, writeFiles } from "../gemeinsam/umgebung.mjs";

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const ORDNER = "src/db/migrations";
const ROT = 1;
const KOPF = "SET LOCAL lock_timeout = '2s';\nSET LOCAL statement_timeout = '30s';\n";
const SAUBER = `${KOPF}
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stand BIGINT NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION tenant_stand_erhoehen() RETURNS trigger AS $$
BEGIN
  NEW.stand := OLD.stand + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tenant_stand ON tenant;
CREATE TRIGGER tenant_stand BEFORE UPDATE ON tenant
  FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION tenant_stand_erhoehen();
`;
const ALTLAST = `${KOPF}CREATE TABLE altlast (x int);\nALTER TABLE altlast DROP COLUMN x;\n`;
const BASIS_DATEIEN = { [`${ORDNER}/0001_t.sql`]: `${KOPF}CREATE TABLE t (x int, y int);\n` };
const GIT_IDENTITAET = ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "-c", "core.hooksPath=/dev/null"];

function basisVon(repo) {
  return runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
}

function schritt(repo, basis, wurzel = WURZEL) {
  const lauf = runIn(repo, process.execPath, [join(wurzel, "tools/pruefen.mjs"), "migrationen", "--basis", basis]);
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

function mitNeuen(context, neu, basisDateien = BASIS_DATEIEN) {
  const repo = probeRepository(context, basisDateien);
  const basis = basisVon(repo);
  writeFiles(repo, neu);
  commitAll(repo, "Stand");
  return schritt(repo, basis);
}

function migration(name, inhalt) {
  return { [`${ORDNER}/${name}`]: inhalt };
}

test("Neue Migration mit DROP COLUMN ist rot und nennt Regel und Datei", (context) => {
  const ergebnis = mitNeuen(context, migration("0010_x.sql", `${KOPF}ALTER TABLE t DROP COLUMN x;\n`));
  assert.equal(ergebnis.status, ROT);
  assert.match(ergebnis.ausgabe, /ban-drop-column/);
  assert.match(ergebnis.ausgabe, /0010_x\.sql/);
});

test("Neue Migration wie 0009 ist grün", (context) => {
  const ergebnis = mitNeuen(context, migration("0010_x.sql", SAUBER));
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
});

const GEBOTE = [
  ["DROP TABLE", `${KOPF}DROP TABLE t;\n`, "ban-drop-table"],
  ["Spaltentyp ändern", `${KOPF}ALTER TABLE t ALTER COLUMN x TYPE bigint;\n`, "changing-column-type"],
  ["Index ohne CONCURRENTLY", `${KOPF}CREATE INDEX t_x ON t (x);\n`, "require-concurrent-index-creation"],
  ["CHECK ohne NOT VALID", `${KOPF}ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0);\n`, "constraint-missing-not-valid"],
  ["NOT NULL ohne Vorgabe", `${KOPF}ALTER TABLE t ADD COLUMN z int NOT NULL;\n`, "adding-required-field"],
  ["ohne lock_timeout", "SET LOCAL statement_timeout = '30s';\nALTER TABLE t ADD COLUMN z int;\n", "require-lock-timeout"],
  ["ohne statement_timeout", "SET LOCAL lock_timeout = '2s';\nALTER TABLE t ADD COLUMN z int;\n", "require-statement-timeout"],
  ["CREATE INDEX CONCURRENTLY in Transaktion", `${KOPF}CREATE INDEX CONCURRENTLY t_x ON t (x);\n`, "ban-concurrent-index-creation-in-transaction"],
];

test("Gefährliche Migrationen sind rot und nennen ihre Regel", (context) => {
  for (const [fall, sql, regel] of GEBOTE) {
    const ergebnis = mitNeuen(context, migration("0010_x.sql", sql));
    assert.equal(ergebnis.status, ROT, fall);
    assert.match(ergebnis.ausgabe, new RegExp(regel), fall);
  }
});

test("Squawk-rote Altlast im Stand und der Basis zählt nicht, nur die geänderten Dateien", (context) => {
  const basisDateien = migration("0005_altlast.sql", ALTLAST);
  const ergebnis = mitNeuen(context, migration("0010_x.sql", SAUBER), basisDateien);
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
});

test("squawk-ignore in einer neuen Migration ist ein Befund und braucht die Freigabe", (context) => {
  const faelle = [
    `${KOPF}-- squawk-ignore ban-drop-column\nALTER TABLE t DROP COLUMN x;\n`,
    `${KOPF}-- squawk-ignore-file\nALTER TABLE t DROP COLUMN x;\n`,
    `${KOPF}-- SQUAWK-IGNORE ban-drop-column\nALTER TABLE t DROP COLUMN x;\n`,
    `${KOPF}/* squawk-ignore */\nALTER TABLE t ADD COLUMN z int;\n`,
  ];
  for (const sql of faelle) {
    const ergebnis = mitNeuen(context, migration("0010_x.sql", sql));
    assert.equal(ergebnis.status, ROT, sql);
    assert.match(ergebnis.ausgabe, /squawk-ignore/i, sql);
    assert.match(ergebnis.ausgabe, /Freigabe von Antonio/, sql);
  }
});

test("Ohne geänderte Migration ist der Schritt grün", (context) => {
  const repo = probeRepository(context, BASIS_DATEIEN);
  writeFiles(repo, { "README.md": "x\n" });
  const basis = basisVon(repo);
  commitAll(repo, "Stand");
  const ergebnis = schritt(repo, basis);
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, /keine geänderte Migration/);
});

test("Ein ungültiger --basis ist rot", (context) => {
  const repo = probeRepository(context, BASIS_DATEIEN);
  const ergebnis = schritt(repo, "0000000");
  assert.equal(ergebnis.status, ROT);
});

test("Eine neue Migration mit Syntaxfehler ist rot", (context) => {
  const ergebnis = mitNeuen(context, migration("0010_x.sql", `${KOPF}ALTER TABEL t ADD;\n`));
  assert.equal(ergebnis.status, ROT);
});

test("Fehlt das Programm squawk, ist der Schritt rot und nennt npm ci", (context) => {
  const kopie = mkdtempSync(join(tmpdir(), "werkzeuge-"));
  context.after(() => rmSync(kopie, { recursive: true, force: true }));
  cpSync(join(WURZEL, "tools"), join(kopie, "tools"), { recursive: true });
  const repo = probeRepository(context, BASIS_DATEIEN);
  const basis = basisVon(repo);
  writeFiles(repo, migration("0010_x.sql", SAUBER));
  commitAll(repo, "Stand");
  const ergebnis = schritt(repo, basis, kopie);
  assert.equal(ergebnis.status, ROT);
  assert.match(ergebnis.ausgabe, /npm ci/);
});

test("Eine geänderte bestehende Migration mit DROP COLUMN ist rot", (context) => {
  const repo = probeRepository(context, BASIS_DATEIEN);
  const basis = basisVon(repo);
  writeFiles(repo, migration("0001_t.sql", `${KOPF}ALTER TABLE t DROP COLUMN x;\n`));
  commitAll(repo, "Stand");
  const ergebnis = schritt(repo, basis);
  assert.equal(ergebnis.status, ROT);
  assert.match(ergebnis.ausgabe, /ban-drop-column/);
});

test("Eine umbenannte Migration mit DROP COLUMN ist rot", (context) => {
  const repo = probeRepository(context, BASIS_DATEIEN);
  const basis = basisVon(repo);
  runIn(repo, "git", ["mv", `${ORDNER}/0001_t.sql`, `${ORDNER}/0002_t.sql`]);
  writeFiles(repo, migration("0002_t.sql", `${KOPF}CREATE TABLE t (x int, y int);\nALTER TABLE t DROP COLUMN x;\n`));
  commitAll(repo, "Stand");
  assert.equal(runIn(repo, "git", [...GIT_IDENTITAET, "diff", "--name-status", "-M", basis, "HEAD"]).stdout.startsWith("R"), true);
  const ergebnis = schritt(repo, basis);
  assert.equal(ergebnis.status, ROT);
  assert.match(ergebnis.ausgabe, /ban-drop-column/);
});

test("Die Endung .SQL wird geprüft und .sql.txt ist ein Befund", (context) => {
  const gross = mitNeuen(context, migration("0010_x.SQL", `${KOPF}ALTER TABLE t DROP COLUMN x;\n`));
  assert.equal(gross.status, ROT);
  assert.match(gross.ausgabe, /ban-drop-column/);
  const text = mitNeuen(context, migration("0010_x.sql.txt", SAUBER));
  assert.equal(text.status, ROT);
  assert.match(text.ausgabe, /0010_x\.sql\.txt/);
});
