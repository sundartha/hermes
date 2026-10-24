import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { relative } from "node:path";

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

export function echterRepoPfad(wurzel, datei) {
  return relative(wurzel, realpathSync(datei));
}

export function istQuelltext(datei) {
  return JAVASCRIPT_DATEI.test(datei) || TYPESCRIPT_DATEI.test(datei);
}

function sprachangaben(datei) {
  if (!TYPESCRIPT_DATEI.test(datei)) return { languageOptions: MODUL };
  return { files: TYPESCRIPT_MUSTER, languageOptions: { ...MODUL, parser: typescriptParser() } };
}

function funktionsname(knoten) {
  const { id, parent: eltern } = knoten;
  const benannt = id?.name ?? eltern?.id?.name ?? eltern?.key?.name;
  return benannt ?? `anonym ab Zeile ${knoten.loc.start.line}`;
}

export function besucheSyntaxbaum(datei, quelltext, besucher) {
  const konfiguration = {
    ...sprachangaben(datei),
    plugins: { ziele: { rules: { besuch: { create: besucher } } } },
    rules: { "ziele/besuch": "error" },
  };
  const { Linter } = ladeModul("eslint");
  new Linter().verify(quelltext, konfiguration, { filename: datei });
}

export function funktionenIn(datei, quelltext) {
  const gefunden = [];
  const sammle = (knoten) => gefunden.push({ name: funktionsname(knoten), von: knoten.loc.start.line, bis: knoten.loc.end.line, start: knoten.range[0] });
  besucheSyntaxbaum(datei, quelltext, () => Object.fromEntries(FUNKTIONSARTEN.map((art) => [art, sammle])));
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
