import { readFileSync } from "node:fs";
import path from "node:path";

import * as espree from "espree";

const OBERGRENZE_MS = 100;
const NAME = "echtWarten";
const MODUL_ENDE = "echt-warten.js";
const PARSER_OPTIONEN = { ecmaVersion: "latest", sourceType: "module", range: true };
const RECHENARTEN = new Map([
  ["+", (links, rechts) => links + rechts],
  ["-", (links, rechts) => links - rechts],
  ["*", (links, rechts) => links * rechts],
  ["/", (links, rechts) => links / rechts],
]);

function kinderVon(knoten) {
  return Object.values(knoten).flatMap((wert) => {
    if (Array.isArray(wert)) return wert.filter((element) => element?.type);
    return wert?.type ? [wert] : [];
  });
}

function* alleKnoten(wurzel) {
  const offen = [wurzel];
  while (offen.length > 0) {
    const knoten = offen.pop();
    yield knoten;
    offen.push(...kinderVon(knoten));
  }
}

function rechne(operator, links, rechts) {
  const rechenart = RECHENARTEN.get(operator);
  return rechenart && links !== null && rechts !== null ? rechenart(links, rechts) : null;
}

const AUSWERTER = new Map([
  ["Literal", (ausdruck) => (typeof ausdruck.value === "number" ? ausdruck.value : null)],
  ["Identifier", (ausdruck, konstanten) => konstanten.get(ausdruck.name) ?? null],
  [
    "UnaryExpression",
    (ausdruck, konstanten) =>
      ausdruck.operator === "-" ? rechne("*", -1, wertVon(ausdruck.argument, konstanten)) : null,
  ],
  [
    "BinaryExpression",
    (ausdruck, konstanten) =>
      rechne(
        ausdruck.operator,
        wertVon(ausdruck.left, konstanten),
        wertVon(ausdruck.right, konstanten),
      ),
  ],
]);

function wertVon(ausdruck, konstanten) {
  const auswerter = AUSWERTER.get(ausdruck.type);
  return auswerter ? auswerter(ausdruck, konstanten) : null;
}

function konstantenVon(programm) {
  const konstanten = new Map();
  const deklarationen = programm.body
    .map((knoten) => (knoten.type === "ExportNamedDeclaration" ? knoten.declaration : knoten))
    .filter((knoten) => knoten?.type === "VariableDeclaration" && knoten.kind === "const");
  for (const deklaration of deklarationen) {
    for (const { id, init } of deklaration.declarations) {
      const wert = id.type === "Identifier" && init ? wertVon(init, konstanten) : null;
      if (wert !== null) konstanten.set(id.name, wert);
    }
  }
  return konstanten;
}

function lokaleNamen(programm) {
  const namen = new Set([NAME]);
  const importe = programm.body.filter(
    (knoten) =>
      knoten.type === "ImportDeclaration" && String(knoten.source.value).endsWith(MODUL_ENDE),
  );
  for (const { specifiers } of importe) {
    for (const { imported, local } of specifiers)
      if (imported?.name === NAME) namen.add(local.name);
  }
  return namen;
}

function parse(text) {
  try {
    return espree.parse(text, PARSER_OPTIONEN);
  } catch {
    return espree.parse(text, { ...PARSER_OPTIONEN, sourceType: "script" });
  }
}

export function aufrufeIn(datei, text) {
  const programm = parse(text);
  const konstanten = konstantenVon(programm);
  const namen = lokaleNamen(programm);
  return [...alleKnoten(programm)]
    .filter((knoten) => knoten.type === "CallExpression" && namen.has(knoten.callee.name))
    .map(({ arguments: [argument] }) => ({
      datei,
      argument: argument ? text.slice(...argument.range) : "",
      wert: argument ? wertVon(argument, konstanten) : null,
    }));
}

function passt(eintrag, aufruf) {
  return eintrag.datei === aufruf.datei && eintrag.argument === aufruf.argument;
}

function befundFuer(aufruf, eintraege) {
  if (aufruf.wert !== null && aufruf.wert <= OBERGRENZE_MS) return null;
  const eintrag = eintraege.find((kandidat) => passt(kandidat, aufruf));
  const stelle = `${aufruf.datei}: echtWarten(${aufruf.argument})`;
  if (!eintrag) {
    const grund = aufruf.wert === null ? "Wert nicht bestimmbar" : `${aufruf.wert} ms`;
    return `${stelle}: ${grund}, über ${OBERGRENZE_MS} ms nur mit Eintrag in tools/basis/echte-wartezeiten.json`;
  }
  if (aufruf.wert !== null && aufruf.wert > eintrag.hoechstwert_ms) {
    return `${stelle}: ${aufruf.wert} ms liegt über dem Höchstwert ${eintrag.hoechstwert_ms} ms des Eintrags`;
  }
  return null;
}

export function echtWartenBefunde(aufrufe, eintraege) {
  const zuHoch = aufrufe.map((aufruf) => befundFuer(aufruf, eintraege)).filter(Boolean);
  const gebraucht = aufrufe.filter((aufruf) => befundFuer(aufruf, []) !== null);
  const verwaist = eintraege
    .filter((eintrag) => !gebraucht.some((aufruf) => passt(eintrag, aufruf)))
    .map(
      ({ datei, argument }) =>
        `tools/basis/echte-wartezeiten.json: Eintrag ${datei}: echtWarten(${argument}) passt zu keinem Aufruf über ${OBERGRENZE_MS} ms`,
    );
  return [...zuHoch, ...verwaist];
}

export function aufrufeInDateien(wurzel, dateien) {
  return dateien.flatMap((datei) =>
    aufrufeIn(datei, readFileSync(path.join(wurzel, datei), "utf8")),
  );
}
