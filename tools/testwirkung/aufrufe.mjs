import { extname } from "node:path";

import { Linter } from "eslint";

export const TESTDATEI = /^test\/.+\.test\.[cm]?js$/;
const TESTFUNKTIONEN = new Set(["test", "it"]);
const UNTERTEST = "test";
const MIN_UNTERTEST_ARGUMENTE = 2;
const FUNKTIONSARTEN = new Set(["ArrowFunctionExpression", "FunctionExpression"]);
const COMMONJS = ".cjs";
const REGEL = "testwirkung/testaufrufe";
const REGEX_ZEICHEN = /[.*+?^${}()|[\]\\]/g;
const BELIEBIG = ".*";
const SPALTE_AB_EINS = 1;

function istTestaufruf({ callee, arguments: argumente }) {
  if (TESTFUNKTIONEN.has(callee.name)) return true;
  if (callee.type !== "MemberExpression") return false;
  if (TESTFUNKTIONEN.has(callee.object.name)) return true;
  const letztes = argumente.at(-1);
  return callee.property.name === UNTERTEST && argumente.length >= MIN_UNTERTEST_ARGUMENTE && FUNKTIONSARTEN.has(letztes.type);
}

function festerName(argument) {
  if (argument?.type === "Literal") return typeof argument.value === "string" ? argument.value : undefined;
  if (argument?.type !== "TemplateLiteral" || argument.expressions.length > 0) return undefined;
  const [{ value }] = argument.quasis;
  return value.cooked;
}

export function maskiert(text) {
  return text.replace(REGEX_ZEICHEN, "\\$&");
}

function namensmuster(argument) {
  const name = festerName(argument);
  if (name !== undefined) return `^${maskiert(name)}$`;
  if (argument?.type !== "TemplateLiteral") return BELIEBIG;
  const stuecke = argument.quasis.map(({ value }) => maskiert(value.cooked ?? ""));
  return `^${stuecke.join(BELIEBIG)}$`;
}

function bezeichnung(quelle, argument) {
  if (argument === undefined) return "";
  return festerName(argument) ?? quelle.getText(argument);
}

function aufrufstelle({ callee }) {
  const benannt = callee.type === "MemberExpression" ? callee.property : callee;
  const { line, column } = benannt.loc.start;
  return { zeile: line, spalte: column + SPALTE_AB_EINS };
}

function erfasse(quelle, knoten) {
  const [erstes] = knoten.arguments;
  const vorfahren = quelle
    .getAncestors(knoten)
    .filter((vorfahr) => vorfahr.type === "CallExpression" && istTestaufruf(vorfahr));
  return {
    name: festerName(erstes),
    text: erstes === undefined ? "" : quelle.getText(erstes),
    vorfahren: vorfahren.map((vorfahr) => festerName(vorfahr.arguments[0])).filter((name) => name !== undefined),
    bezeichnung: bezeichnung(quelle, erstes),
    muster: [knoten, ...vorfahren].map((aufruf) => namensmuster(aufruf.arguments[0])),
    von: knoten.loc.start.line,
    bis: knoten.loc.end.line,
    ...aufrufstelle(knoten),
  };
}

export function testaufrufe(datei, quelltext) {
  const gefunden = [];
  const testaufrufeSammeln = {
    create: (kontext) => ({
      CallExpression: (knoten) => {
        if (istTestaufruf(knoten)) gefunden.push(erfasse(kontext.sourceCode, knoten));
      },
    }),
  };
  const konfiguration = {
    languageOptions: { ecmaVersion: "latest", sourceType: extname(datei) === COMMONJS ? "commonjs" : "module" },
    plugins: { testwirkung: { rules: { testaufrufe: testaufrufeSammeln } } },
    rules: { [REGEL]: "error" },
  };
  const fatal = new Linter().verify(quelltext, konfiguration, { filename: datei }).find((meldung) => meldung.fatal);
  if (fatal !== undefined) throw new Error(`${datei} lässt sich nicht lesen: ${fatal.message}`);
  return gefunden;
}
