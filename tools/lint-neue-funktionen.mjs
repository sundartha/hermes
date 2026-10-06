import { join } from "node:path";
import { ESLint, Linter } from "eslint";

import { GEBUNDENE_KNOTEN, gebundeneNamen } from "./eslint-rules/namen-ohne-begruendung.js";
import {
  STATUS_NEU,
  ausfuehren,
  basisAusAufruf,
  dateiInhalt,
  geaenderteDateien,
  hunks,
} from "./pr-aenderungen.mjs";

const JS_DATEIEN = ["*.js", "*.mjs", "*.cjs"];
const FUNKTIONEN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const STRENGE_NEBENREGELN = {
  "no-unused-expressions": "error",
  "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  "no-sequences": ["error", { allowInParentheses: false }],
};
const BESTANDS_REGELN = [
  { regel: "hermes/keine-kommentare" },
  { regel: "hermes/kein-quelltext-als-text", files: ["test/**"] },
];
const OHNE_BESTAND = {};
const LEERRAUM = /\s+/g;
const NICHT_ZEILENENDE = /[^\n]/g;
const ZEILENENDE = "\n";
const LANGER_NAME = 40;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const AUFRUF = "Aufruf: node tools/lint-neue-funktionen.mjs --basis <commit>";

function zeilenOhneKommentare(text, kommentare) {
  let ohne = text;
  for (const { range } of kommentare) {
    const [anfang, ende] = range;
    const leer = ohne.slice(anfang, ende).replace(NICHT_ZEILENENDE, " ");
    ohne = `${ohne.slice(0, anfang)}${leer}${ohne.slice(ende)}`;
  }
  return ohne.split(ZEILENENDE).map((zeile) => zeile.replace(LEERRAUM, ""));
}

async function geparst(werkzeug, datei, text) {
  const config = await werkzeug.eslint.calculateConfigForFile(join(werkzeug.root, datei));
  const meldungen = werkzeug.linter.verify(text, { languageOptions: config?.languageOptions ?? {} });
  if (meldungen.some(({ fatal }) => fatal)) return { code: zeilenOhneKommentare(text, []) };
  const sourceCode = werkzeug.linter.getSourceCode();
  return { sourceCode, code: zeilenOhneKommentare(text, sourceCode.getAllComments()) };
}

function codeVon(seite, { start, anzahl }) {
  return seite.code.slice(start - 1, start - 1 + anzahl);
}

function hunkAuswerten(hunk, alt, neu) {
  const entfernt = codeVon(alt, hunk.alt);
  const hinzu = codeVon(neu, hunk.neu);
  if (entfernt.join("") === hinzu.join("")) return { zeilen: [], loeschungen: [] };
  const offen = new Map();
  for (const code of entfernt.filter(Boolean)) offen.set(code, (offen.get(code) ?? 0) + 1);
  const zeilen = [];
  for (const [index, code] of hinzu.entries()) {
    const uebrig = offen.get(code) ?? 0;
    if (code !== "" && uebrig === 0) zeilen.push(hunk.neu.start + index);
    offen.set(code, uebrig - 1);
  }
  const codeGeloescht = [...offen.values()].some((anzahl) => anzahl > 0);
  if (!codeGeloescht) return { zeilen, loeschungen: [] };
  const { start, anzahl } = hunk.neu;
  return { zeilen, loeschungen: [{ von: start, bis: anzahl === 0 ? start + 1 : start }] };
}

export function geaenderteStellen(hunkListe, alt, neu) {
  const ergebnisse = hunkListe.map((hunk) => hunkAuswerten(hunk, alt, neu));
  return {
    zeilen: new Set(ergebnisse.flatMap(({ zeilen }) => zeilen)),
    loeschungen: ergebnisse.flatMap(({ loeschungen }) => loeschungen),
  };
}

function knoten(sourceCode, passt) {
  const gefunden = [];
  const offen = sourceCode === undefined ? [] : [sourceCode.ast];
  while (offen.length > 0) {
    const node = offen.pop();
    if (passt(node)) gefunden.push(node);
    for (const schluessel of sourceCode.visitorKeys[node.type] ?? []) {
      offen.push(...[node[schluessel]].flat().filter(Boolean));
    }
  }
  return gefunden;
}

function vorOderGleich(links, rechts) {
  return links.line < rechts.line || (links.line === rechts.line && links.column <= rechts.column);
}

function innerste(funktionen) {
  return funktionen.toSorted((links, rechts) => rechts.range[0] - links.range[0])[0];
}

function umschliesst({ loc }, anfang, ende) {
  return vorOderGleich(loc.start, anfang) && vorOderGleich(ende, loc.end);
}

function innersteFunktion(funktionen, stelle) {
  return innerste(funktionen.filter((funktion) => umschliesst(funktion, stelle, stelle)));
}

function zeilenGrenzen(zeilen, nummer) {
  const zeile = zeilen[nummer - 1] ?? "";
  return {
    anfang: { line: nummer, column: zeile.length - zeile.trimStart().length },
    ende: { line: nummer, column: zeile.trimEnd().length },
  };
}

function funktionenDerZeile(funktionen, zeilen, nummer) {
  const { anfang, ende } = zeilenGrenzen(zeilen, nummer);
  const beruehrt = funktionen.filter(({ loc }) => loc.start.line <= nummer && nummer <= loc.end.line);
  const ganz = beruehrt.filter((funktion) => umschliesst(funktion, anfang, ende));
  const teilweise = beruehrt.filter((funktion) => !ganz.includes(funktion));
  return [innerste(ganz), ...teilweise].filter(Boolean);
}

function geaenderteFunktionen(funktionen, stellen, zeilen) {
  const geaendert = new Set();
  for (const nummer of stellen.zeilen) {
    for (const funktion of funktionenDerZeile(funktionen, zeilen, nummer)) geaendert.add(funktion);
  }
  for (const { von, bis } of stellen.loeschungen) {
    const umschliessend = funktionen.filter(({ loc }) => loc.start.line <= von && bis <= loc.end.line);
    const funktion = innerste(umschliessend);
    if (funktion !== undefined) geaendert.add(funktion);
  }
  return geaendert;
}

function meldungZaehlt(meldung, { funktionen, geaendert, stellen }) {
  const stelle = { line: meldung.line, column: (meldung.column ?? 1) - 1 };
  const funktion = innersteFunktion(funktionen, stelle);
  if (funktion !== undefined) return geaendert.has(funktion);
  return stellen.zeilen.has(meldung.line);
}

function langeNamen(sourceCode, stellen) {
  const gebunden = knoten(sourceCode, (node) => GEBUNDENE_KNOTEN.includes(node.type)).flatMap(
    gebundeneNamen,
  );
  return gebunden.filter(
    ({ name, node }) => name.length > LANGER_NAME && stellen.zeilen.has(node.loc.start.line),
  );
}

async function dateiPruefen(werkzeug, { status, datei }) {
  const { basis, root } = werkzeug;
  const neuText = dateiInhalt("HEAD", datei, root);
  const altText = status === STATUS_NEU ? "" : dateiInhalt(basis, datei, root);
  const alt = await geparst(werkzeug, datei, altText);
  const neu = await geparst(werkzeug, datei, neuText);
  const stellen = geaenderteStellen(hunks(basis, datei, root), alt, neu);
  const funktionen = knoten(neu.sourceCode, (node) => FUNKTIONEN.has(node.type));
  const geaendert = geaenderteFunktionen(funktionen, stellen, neuText.split(ZEILENENDE));
  const [ergebnis] = await werkzeug.eslint.lintText(neuText, {
    filePath: join(root, datei),
    warnIgnored: false,
  });
  const meldungen = (ergebnis?.messages ?? []).filter((meldung) =>
    meldungZaehlt(meldung, { funktionen, geaendert, stellen }),
  );
  return { datei, meldungen, namen: langeNamen(neu.sourceCode, stellen) };
}

async function genutzteRegeln(eslint, root, dateien) {
  const regeln = new Set();
  for (const { datei } of dateien) {
    const config = await eslint.calculateConfigForFile(join(root, datei));
    for (const regel of Object.keys(config?.rules ?? {})) regeln.add(regel);
  }
  return regeln;
}

export async function eslintOhneBestand(root, dateien) {
  const ohneZusatz = new ESLint({ cwd: root, applySuppressions: false });
  const regeln = await genutzteRegeln(ohneZusatz, root, dateien);
  const zusatz = BESTANDS_REGELN.filter(({ regel }) => regeln.has(regel)).map(({ regel, files }) => ({
    ...(files !== undefined && { files }),
    rules: { [regel]: ["error", OHNE_BESTAND] },
  }));
  const overrideConfig = [{ rules: STRENGE_NEBENREGELN }, ...zusatz];
  return new ESLint({ cwd: root, applySuppressions: false, overrideConfig });
}

async function gelinteteDateien(root, basis) {
  const pruefer = new ESLint({ cwd: root });
  const alle = geaenderteDateien(basis, root, { filter: "AM", muster: JS_DATEIEN });
  const gelintet = [];
  for (const eintrag of alle) {
    if (!(await pruefer.isPathIgnored(join(root, eintrag.datei)))) gelintet.push(eintrag);
  }
  return gelintet;
}

function berichten(ergebnisse) {
  const gezaehlt = ergebnisse.flatMap(({ datei, meldungen }) =>
    meldungen.map(({ line, ruleId, message }) => `${datei}:${line} ${ruleId ?? "Parser"}: ${message}`),
  );
  for (const zeile of gezaehlt) console.error(zeile);
  for (const { datei, namen } of ergebnisse) {
    for (const { name, node } of namen) {
      console.log(
        `Hinweis (sperrt nicht): ${datei}:${node.loc.start.line} der neue Name „${name}“ hat ${name.length} Zeichen.`,
      );
    }
  }
  const dateien = ergebnisse.length;
  console.log(`Lint neuer Funktionen: ${gezaehlt.length} Meldungen in ${dateien} geänderten Dateien.`);
  return gezaehlt.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}

async function pruefen(root, basis) {
  const dateien = await gelinteteDateien(root, basis);
  const werkzeug = {
    root,
    basis,
    eslint: await eslintOhneBestand(root, dateien),
    linter: new Linter({ cwd: root }),
  };
  const ergebnisse = [];
  for (const eintrag of dateien) ergebnisse.push(await dateiPruefen(werkzeug, eintrag));
  return berichten(ergebnisse);
}

await ausfuehren(async (root) => pruefen(root, basisAusAufruf(AUFRUF, root)));
