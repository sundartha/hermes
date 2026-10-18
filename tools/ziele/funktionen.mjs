import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { eslintBefehl, fuehreAus } from "./werkzeuge.mjs";

export const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const KONFIGURATION = "eslint.config.js";
const FUNKTIONSARTEN = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"];
const FEHLER = 2;
const ladeModul = createRequire(import.meta.url);
export const JAVASCRIPT_DATEI = /\.[cm]?js$/;
export const TYPESCRIPT_DATEI = /\.[cm]?ts$/;
const TYPESCRIPT_MUSTER = ["**/*.ts", "**/*.mts", "**/*.cts"];
const MODUL = { ecmaVersion: "latest", sourceType: "module" };

export function typescriptParser() {
  return ladeModul("typescript-eslint").parser;
}

export function istQuelltext(datei) {
  return JAVASCRIPT_DATEI.test(datei) || TYPESCRIPT_DATEI.test(datei);
}

function sprachangaben(datei) {
  if (!TYPESCRIPT_DATEI.test(datei)) return { languageOptions: MODUL };
  return { files: TYPESCRIPT_MUSTER, languageOptions: { ...MODUL, parser: typescriptParser() } };
}

export function ungefilterteMeldungen(root, dateien) {
  const ordner = mkdtempSync(join(tmpdir(), "ziele-altfunktion-"));
  try {
    const leer = join(ordner, UNTERDRUECKUNGEN);
    writeFileSync(leer, "{}");
    const lauf = fuehreAus(eslintBefehl(["--config", resolve(root, KONFIGURATION), "--format", "json", "--suppressions-location", leer, ...dateien]), root);
    return JSON.parse(lauf.stdout || "[]");
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function funktionsname(knoten) {
  const { id, parent: eltern } = knoten;
  const benannt = id?.name ?? eltern?.id?.name ?? eltern?.key?.name;
  return benannt ?? `anonym ab Zeile ${knoten.loc.start.line}`;
}

export function funktionenIn(datei, quelltext) {
  const gefunden = [];
  const sammle = (knoten) => gefunden.push({ name: funktionsname(knoten), von: knoten.loc.start.line, bis: knoten.loc.end.line, start: knoten.range[0] });
  const regel = { create: () => Object.fromEntries(FUNKTIONSARTEN.map((art) => [art, sammle])) };
  const konfiguration = {
    ...sprachangaben(datei),
    plugins: { ziele: { rules: { funktionen: regel } } },
    rules: { "ziele/funktionen": "error" },
  };
  const { Linter } = ladeModul("eslint");
  new Linter().verify(quelltext, konfiguration, { filename: datei });
  return gefunden;
}

function innersteFunktion(funktionen, zeile) {
  const umschliessend = funktionen.filter(({ von, bis }) => von <= zeile && zeile <= bis);
  return umschliessend.toSorted((links, rechts) => rechts.start - links.start)[0];
}

export function regelnJeFunktion(funktionen, meldungen) {
  const jeFunktion = new Map();
  for (const { line, ruleId } of meldungen.filter(({ severity }) => severity === FEHLER)) {
    const funktion = innersteFunktion(funktionen, line);
    if (funktion !== undefined) jeFunktion.set(funktion, [...(jeFunktion.get(funktion) ?? []), ruleId]);
  }
  return jeFunktion;
}
