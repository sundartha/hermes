import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { MELDUNG, befundeMeldenUndScheitern } from "./auftrag/zweck.mjs";
import { fileAt, git } from "./pruefungen-messen.mjs";
import { CHECKED_ROOTS, TYPESCRIPT_FILE, isCommit } from "./ts-dateien.mjs";

const STOCK_FILE = "tools/basis/ts-bestand.json";
const CHECKED_ROOT_LIST = new Intl.ListFormat("de", { type: "disjunction" }).format(CHECKED_ROOTS);
const NUL = "\0";

function stockOf(text, source) {
  const stock = JSON.parse(text);
  const valid = Array.isArray(stock) && stock.every((entry) => typeof entry === "string");
  if (!valid) throw new Error(`${source}: der Bestand ist keine Liste von Pfaden.`);
  return stock;
}

function typescriptFiles(listing) {
  return listing.split(NUL).filter((path) => TYPESCRIPT_FILE.test(path));
}

function stockAt(basis) {
  const before = fileAt(basis, STOCK_FILE);
  if (before !== undefined) return stockOf(before, `${basis}:${STOCK_FILE}`);
  return typescriptFiles(git(["ls-tree", "-r", "-z", "--name-only", basis]));
}

function basisFindings(stock, basis) {
  if (basis === undefined) return [];
  if (!isCommit(basis))
    return [
      `--basis ${JSON.stringify(basis)} ist kein lesbarer Commit; ohne Basis lässt sich der Bestand nicht vergleichen.`,
    ];
  const known = new Set(stockAt(basis));
  return stock
    .filter((path) => !known.has(path))
    .map(
      (path) => `${STOCK_FILE}: ${path} ist neu im Bestand; der Bestand darf nur kürzer werden.`,
    );
}

function findings(basis) {
  const stock = existsSync(STOCK_FILE) ? stockOf(readFileSync(STOCK_FILE, "utf8"), STOCK_FILE) : [];
  const allowed = new Set(stock);
  const tracked = typescriptFiles(git(["ls-files", "-z"]));
  return [
    ...tracked
      .filter((path) => !allowed.has(path))
      .map((path) => `${path}: TypeScript-Datei vor S71g`),
    ...stock
      .filter((path) => CHECKED_ROOTS.some((root) => path.startsWith(root)))
      .map(
        (path) =>
          `${STOCK_FILE}: ${path} liegt unter ${CHECKED_ROOT_LIST} und darf nicht im Bestand stehen.`,
      ),
    ...basisFindings(stock, basis),
  ];
}

const { values } = parseArgs({ options: { basis: { type: "string" } } });
befundeMeldenUndScheitern(findings(values.basis), MELDUNG.TS_SPERRE);
