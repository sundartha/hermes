import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { MELDUNG, befundeMeldenUndScheitern } from "./auftrag/zweck.mjs";
import { fileAt, git } from "./pruefungen-messen.mjs";
import { isCommit } from "./ts-dateien.mjs";

const FOLDER = "src/db/migrations/";
const ROLLBACK_FOLDER = `${FOLDER}rueckbau/`;
const SCHEMA = "src/db/schema.sql";
const CONFIG = "tools/basis/squawk.toml";
const SQUAWK = fileURLToPath(import.meta.resolve("squawk-cli/js/bin/squawk"));
const STARTING_NUMBER = 1;
const NUMBER_DIGITS = 4;
const NAME = /^(\d{4})_[a-z0-9]+(?:-[a-z0-9]+)*\.sql$/;
const SQL_FILE = /\.sql$/i;
const CODE_FILE = /\.(?:[cm]?js|[cm]?ts|tsx)$/i;
const CODE_ROOTS = ["src/", "scripts/"];
const DDL =
  /\b(?:alter|create|drop)\s+(?:(?:or\s+replace|unique|materialized|unlogged|temp|temporary|global|local|constraint|recursive)\s+)*(?:table|index|policy|trigger|function|column|view|type|extension|schema|sequence)\b/i;
const ROLLBACK_RULES = [
  "ban-drop-column",
  "ban-drop-table",
  "ban-drop-constraint",
  "ban-drop-not-null",
  "ban-drop-default",
  "ban-drop-function",
];
const SQUAWK_IGNORE = /squawk-ignore/i;
const NUL = "\0";

function numberText(number) {
  return String(number).padStart(NUMBER_DIGITS, "0");
}

function tracked() {
  return git(["ls-files", "-z"]).split(NUL).filter(Boolean);
}

function trackedAt(basis) {
  return git(["ls-tree", "-r", "-z", "--name-only", basis]).split(NUL).filter(Boolean);
}

function migrationsIn(paths) {
  return paths.filter((path) => path.startsWith(FOLDER));
}

function isRollback(path) {
  return path.startsWith(ROLLBACK_FOLDER);
}

function numberOf(path) {
  const name = isRollback(path) ? path.slice(ROLLBACK_FOLDER.length) : path.slice(FOLDER.length);
  const match = NAME.exec(name);
  return match ? Number(match[1]) : undefined;
}

function nameFindings(migrations) {
  const seen = new Map();
  const found = [];
  for (const path of migrations) {
    const number = numberOf(path);
    if (number === undefined) {
      found.push(
        `${path}: Name passt nicht; erlaubt sind ${FOLDER}<vierstellige Nummer>_<name>.sql und ${ROLLBACK_FOLDER}<vierstellige Nummer>_<name>.sql, kleingeschrieben, Wörter mit Bindestrich.`,
      );
      continue;
    }
    if (seen.has(number))
      found.push(`${path}: Nummer ${numberText(number)} hat schon ${seen.get(number)}.`);
    else seen.set(number, path);
  }
  return found;
}

function placeFindings(paths, migrations) {
  const found = paths
    .filter(
      (path) =>
        SQL_FILE.test(path) &&
        path.startsWith("src/") &&
        !path.startsWith(FOLDER) &&
        path !== SCHEMA,
    )
    .map(
      (path) =>
        `${path}: SQL-Datei außerhalb von ${FOLDER}; Schemaänderungen gehören in eine Migration.`,
    );
  if (migrations.length > 0 && paths.includes(SCHEMA))
    found.push(
      `${SCHEMA}: liegt neben ${FOLDER}; seit es Migrationen gibt, ändert nur eine neue Migration das Schema.`,
    );
  return found;
}

function ddlFindings(paths) {
  const found = [];
  for (const path of paths) {
    if (
      !CODE_FILE.test(path) ||
      !CODE_ROOTS.some((root) => path.startsWith(root)) ||
      !existsSync(path)
    )
      continue;
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (DDL.test(line))
        found.push(
          `${path}:${index + 1}: Schemaänderung im Code; sie gehört in eine Migration unter ${FOLDER}.`,
        );
    });
  }
  return found;
}

function ignoreFindings(migrations) {
  return migrations
    .filter((path) => existsSync(path) && SQUAWK_IGNORE.test(readFileSync(path, "utf8")))
    .map(
      (path) =>
        `${path}: Kommentar squawk-ignore schaltet Squawk-Regeln ab; jede Migration wird ganz geprüft.`,
    );
}

function isStartingMigration(path) {
  return numberOf(path) === STARTING_NUMBER && !isRollback(path);
}

function isUnchangedSchemaMove(path, basis, baseMigrations) {
  return (
    isStartingMigration(path) &&
    baseMigrations.length === 0 &&
    fileAt(basis, SCHEMA) === readFileSync(path, "utf8")
  );
}

function mergedFindings(basis, baseMigrations, migrations) {
  const current = new Set(migrations);
  return baseMigrations.flatMap((path) => {
    if (!current.has(path))
      return [
        `${path}: schon gemergte Migration gelöscht; Rückbau geht nur über eine neue Migration.`,
      ];
    if (fileAt(basis, path) !== readFileSync(path, "utf8"))
      return [
        `${path}: schon gemergte Migration geändert; jede Änderung braucht eine neue Migration.`,
      ];
    return [];
  });
}

function freshFindings(basis, baseMigrations, fresh) {
  const highest = Math.max(
    0,
    ...baseMigrations.map(numberOf).filter((number) => number !== undefined),
  );
  return fresh.flatMap((path) => {
    const number = numberOf(path);
    const found = [];
    if (number !== undefined && number <= highest)
      found.push(
        `${path}: Nummer ${numberText(number)} ist nicht größer als die höchste gemergte (${numberText(highest)}).`,
      );
    if (isStartingMigration(path) && !isUnchangedSchemaMove(path, basis, baseMigrations))
      found.push(
        `${path}: Ausgangsmigration ist nicht unverändert ${SCHEMA} der Basis; sie wird wie jede andere Migration geprüft.`,
      );
    return found;
  });
}

function rollbackFindings(basis, fresh) {
  if (!fresh.some(isRollback)) return [];
  const changed = git(["diff", "--name-only", "-z", basis]).split(NUL).filter(Boolean);
  return changed
    .filter((path) => !isRollback(path))
    .map(
      (path) =>
        `${path}: geändert im selben Stand wie eine Rückbau-Migration; Rückbau kommt allein, nachdem der Code die Spalte oder Tabelle nicht mehr nutzt.`,
    );
}

function basisFindings(basis, migrations) {
  if (!isCommit(basis))
    return {
      found: [
        `--basis ${JSON.stringify(basis)} ist kein lesbarer Commit; ohne Basis lassen sich die Migrationen nicht vergleichen.`,
      ],
      fresh: [],
    };
  const baseMigrations = migrationsIn(trackedAt(basis));
  const fresh = migrations.filter((path) => !baseMigrations.includes(path));
  return {
    found: [
      ...mergedFindings(basis, baseMigrations, migrations),
      ...freshFindings(basis, baseMigrations, fresh),
      ...rollbackFindings(basis, fresh),
    ],
    fresh: fresh.filter((path) => !isUnchangedSchemaMove(path, basis, baseMigrations)),
  };
}

function squawk(files, extra) {
  if (files.length === 0) return [];
  const result = spawnSync(
    process.execPath,
    [SQUAWK, "-c", CONFIG, "--reporter", "gcc", ...extra, ...files],
    { encoding: "utf8" },
  );
  if (result.error)
    return [
      `${SQUAWK}: Squawk lässt sich nicht starten (${result.error.message}); erst npm ci ausführen.`,
    ];
  if (result.status === 0) return [];
  const lines = `${result.stdout}${result.stderr}`.split("\n").filter((line) => line.trim() !== "");
  return lines.length > 0 ? lines : [`Squawk endete mit ${result.status} ohne Meldung.`];
}

function squawkFindings(files) {
  if (files.length === 0) return [];
  if (!existsSync(CONFIG)) return [`${CONFIG}: fehlt; Squawk läuft nur mit dieser Einstellung.`];
  return [
    ...squawk(
      files.filter((path) => !isRollback(path)),
      [],
    ),
    ...squawk(files.filter(isRollback), ["--exclude", ROLLBACK_RULES.join(",")]),
  ];
}

function findings(basis) {
  const paths = tracked();
  const migrations = migrationsIn(paths);
  const own = [
    ...nameFindings(migrations),
    ...placeFindings(paths, migrations),
    ...ddlFindings(paths),
    ...ignoreFindings(migrations),
  ];
  if (basis === undefined) {
    const checked = migrations.filter(
      (path) => numberOf(path) !== undefined && !isStartingMigration(path),
    );
    return [...own, ...squawkFindings(checked)];
  }
  const { found, fresh } = basisFindings(basis, migrations);
  return [
    ...own,
    ...found,
    ...squawkFindings(fresh.filter((path) => numberOf(path) !== undefined)),
  ];
}

const { values } = parseArgs({ options: { basis: { type: "string" } } });
befundeMeldenUndScheitern(findings(values.basis), MELDUNG.MIGRATIONEN);
