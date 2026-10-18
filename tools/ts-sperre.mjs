import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { cwd } from "node:process";
import { parseArgs } from "node:util";

import { MELDUNG, befundeMeldenUndScheitern } from "./auftrag/zweck.mjs";
import { fileAt, git } from "./pruefungen-messen.mjs";
import { CHECKED_ROOTS, TYPESCRIPT_FILE, isCommit } from "./ts-dateien.mjs";

const STOCK_FILE = "tools/basis/ts-bestand.json";
const CHECKED_ROOT_LIST = new Intl.ListFormat("de", { type: "disjunction" }).format(CHECKED_ROOTS);
const NUL = "\0";
const CHECKED_EXTENSION = /\.[cm]?ts$/;
const UNRUN_TEST_FILE = /\.test\.[cm]ts$/;
const TSCONFIG = "tsconfig.json";

function stockOf(text, source) {
  const stock = JSON.parse(text);
  const valid = Array.isArray(stock) && stock.every((entry) => typeof entry === "string");
  if (!valid) throw new Error(`${source}: der Bestand ist keine Liste von Pfaden.`);
  return stock;
}

function isInCheckedPlace(path) {
  return CHECKED_EXTENSION.test(path) && CHECKED_ROOTS.some((root) => path.startsWith(root));
}

function typecheckedFiles(ts) {
  const { config, error } = ts.readConfigFile(TSCONFIG, ts.sys.readFile);
  if (error !== undefined) return undefined;
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, cwd());
  return new Set(parsed.fileNames.map((file) => relative(cwd(), file)));
}

async function eslintIgnored(ESLint, paths) {
  try {
    const eslint = new ESLint();
    return await Promise.all(paths.map((path) => eslint.isPathIgnored(path)));
  } catch {
    return undefined;
  }
}

function undecidable(paths, tool, reason) {
  return paths.map(
    (path) => `${path}: TypeScript-Datei, bei der sich nicht feststellen lässt, ob ${tool} sie prüft (${reason})`,
  );
}

async function placeFindings(paths) {
  if (paths.length === 0) return [];
  const [{ ESLint }, { default: ts }] = await Promise.all([import("eslint"), import("typescript")]);
  const typechecked = typecheckedFiles(ts);
  if (typechecked === undefined) return undecidable(paths, "tsc", `${TSCONFIG} fehlt oder ist nicht lesbar`);
  const ignored = await eslintIgnored(ESLint, paths);
  if (ignored === undefined) return undecidable(paths, "ESLint", "eslint.config.js lässt sich nicht laden");
  return paths.flatMap((path, index) => {
    if (ignored[index])
      return [`${path}: TypeScript-Datei, die ESLint nicht prüft (in eslint.config.js ausgenommen oder ohne passenden Block)`];
    if (!typechecked.has(path)) return [`${path}: TypeScript-Datei, die tsc nicht prüft (nicht in ${TSCONFIG} enthalten)`];
    if (UNRUN_TEST_FILE.test(path))
      return [`${path}: TypeScript-Testdatei, die der Testläufer nicht startet; Testdateien enden auf .test.ts`];
    return [];
  });
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

async function findings(basis) {
  const stock = existsSync(STOCK_FILE) ? stockOf(readFileSync(STOCK_FILE, "utf8"), STOCK_FILE) : [];
  const allowed = new Set(stock);
  const tracked = typescriptFiles(git(["ls-files", "-z"])).filter((path) => !allowed.has(path));
  return [
    ...tracked
      .filter((path) => !isInCheckedPlace(path))
      .map(
        (path) =>
          `${path}: TypeScript-Datei, die ESLint oder tsc nicht prüfen; geprüft wird nur .ts, .mts oder .cts klein geschrieben unter ${CHECKED_ROOT_LIST}`,
      ),
    ...stock
      .filter((path) => CHECKED_ROOTS.some((root) => path.startsWith(root)))
      .map(
        (path) =>
          `${STOCK_FILE}: ${path} liegt unter ${CHECKED_ROOT_LIST} und darf nicht im Bestand stehen.`,
      ),
    ...(await placeFindings(tracked.filter(isInCheckedPlace))),
    ...basisFindings(stock, basis),
  ];
}

const { values } = parseArgs({ options: { basis: { type: "string" } } });
befundeMeldenUndScheitern(await findings(values.basis), MELDUNG.TS_SPERRE);
