import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { pruefung } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { REPO_ROOT } from "./probe-repo.js";

const SQUAWK_EINSTELLUNG = "tools/basis/squawk.toml";
const MIT_SQUAWK = { [SQUAWK_EINSTELLUNG]: readFileSync(join(REPO_ROOT, SQUAWK_EINSTELLUNG), "utf8") };
const GRENZEN = "SET LOCAL lock_timeout = '2s';\nSET LOCAL statement_timeout = '30s';\n";
const NEUE_SPALTE = `${GRENZEN}ALTER TABLE tenant ADD COLUMN IF NOT EXISTS name text;\n`;
const GELOESCHTE_SPALTE = `${GRENZEN}ALTER TABLE tenant DROP COLUMN IF EXISTS name;\n`;
const MIGRATIONEN = "migrationen";
const WOZU = "Wozu: Hermes ändert sein Datenbankschema nur über nummerierte Migrationen";
const ABSATZ_MIGRATIONEN = `Zweck ${MIGRATIONEN}: Drehbuchtext des Ersatz-Agenten.`;

function mitMigration(context, dateien) {
  return starte(context, { auftrag: UMBAU, drehbuch: { bau: dateien, "bau-antwort": ABSATZ_MIGRATIONEN }, dateien: MIT_SQUAWK });
}

function scheitertAnMigrationen(context, dateien, befund) {
  const { werkzeug, lauf, beleg } = mitMigration(context, dateien);
  const ergebnis = { status: lauf.status, ergebnis: beleg.ergebnis, grund: beleg.grund, exitCode: pruefung(beleg, MIGRATIONEN) };
  assert.deepEqual(ergebnis, { status: EXIT_ROT, ergebnis: "rot", grund: `${MIGRATIONEN} endete mit Exit ${EXIT_ROT}.`, exitCode: EXIT_ROT }, lauf.stdout + lauf.stderr);
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8");
  for (const teil of [`${MIGRATIONEN}:`, befund, WOZU, `dem Bau-Agenten: ${MIGRATIONEN}`]) assert.ok(zweiteRunde.includes(teil), `${teil}\n${zweiteRunde}`);
}

function endetGruen(context, dateien) {
  const { lauf, beleg } = mitMigration(context, dateien);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(pruefung(beleg, MIGRATIONEN), 0, JSON.stringify(beleg.pruefungen));
}

test("schreibt der Bau-Agent eine Migration mit falschem Namen, wird die Runde rot, und die zweite Runde bekommt Befund und Zweck-Text", (context) => {
  scheitertAnMigrationen(context, { "src/db/migrations/neue-spalte.sql": NEUE_SPALTE }, "src/db/migrations/neue-spalte.sql: Name passt nicht");
});

test("löscht die Migration des Bau-Agenten eine Spalte außerhalb des Rückbau-Ordners, wird die Runde rot", (context) => {
  scheitertAnMigrationen(context, { "src/db/migrations/0002_weg.sql": GELOESCHTE_SPALTE }, "ban-drop-column");
});

test("eine gültige Migration des Bau-Agenten besteht die Migrationsprüfung, und die Runde endet grün", (context) => {
  endetGruen(context, { "src/db/migrations/0002_name.sql": NEUE_SPALTE });
});

test("ein Auftrag ohne Migration durchläuft die Migrationsprüfung grün", (context) => {
  endetGruen(context, { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" });
});
