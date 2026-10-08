import { readFileSync, realpathSync } from "node:fs";
import { relative } from "node:path";

import { syntaxbaum } from "./importe.mjs";
import { git, gitGelingt } from "./pfade.mjs";

export const TROCKENLAUF_GESCHEITERT = /There were failed tests in the initial test run/;
export const UNVERAENDERT = "unverändert";
const SONDERZEICHEN = /[.*+?^${}()|[\]\\]/g;
const START = "test:start";
const BESTANDEN = "test:pass";
const TESTAUFRUFE = new Set(["test", "it", "describe", "suite"]);
const ZUSAETZE = new Set(["only", "skip", "todo"]);

export function muster(name) {
  return `^${name.replace(SONDERZEICHEN, "\\$&")}$`;
}

export function auslassungen(faelle) {
  return faelle.map(({ name }) => `--test-skip-pattern=${muster(name)}`);
}

export function faelleAusBericht(text, verzeichnis) {
  const wurzel = realpathSync(verzeichnis);
  const stapel = new Map();
  const faelle = [];
  for (const zeile of text.split("\n").filter(Boolean)) {
    const { art, name, tiefe, datei } = JSON.parse(zeile);
    const test = relative(wurzel, datei ?? "");
    const offen = stapel.get(test) ?? [];
    stapel.set(test, offen);
    if (art === START) {
      const vorfahren = offen.slice(0, tiefe).map((fall) => fall.name);
      offen.length = tiefe;
      offen.push({ test, name: [...vorfahren, name].join(" "), eigen: name, datei, ok: undefined });
      faelle.push(offen[tiefe]);
      continue;
    }
    const fall = offen[tiefe];
    if (fall?.eigen !== name) {
      if (art !== BESTANDEN) faelle.push({ test, name, eigen: name, datei, ok: false });
      continue;
    }
    fall.ok = art === BESTANDEN;
    if (!fall.ok) for (const vorfahr of offen.slice(0, tiefe)) vorfahr.kindGescheitert = true;
  }
  return faelle;
}

function fallFehler(fall, ohne) {
  if (fall.eigen === fall.datei || fall.eigen === fall.test)
    return `${fall.test}: die Datei scheitert als Ganzes, nicht an einem einzelnen Testfall`;
  const vorher = ohne.find(({ test, name }) => test === fall.test && name === fall.name);
  if (vorher?.ok !== true)
    return `${fall.test}: „${fall.name}“ besteht auch ohne Umbau der Quelldateien nicht`;
  const treffer = ohne.filter(({ name, eigen }) => name === fall.name || eigen === fall.name);
  if (treffer.length !== 1)
    return `${fall.test}: der Name „${fall.name}“ ist nicht eindeutig (${treffer.length} Testfälle)`;
  if (!imTextEindeutig(fall, vorher.datei))
    return `${fall.test}: „${fall.name}“ lässt sich im Text der Testdatei nicht eindeutig finden`;
  return undefined;
}

export function auswerten({ ohne, mit }) {
  const gescheitert = mit.filter(({ ok, kindGescheitert }) => ok === false && !kindGescheitert);
  if (gescheitert.length === 0)
    return {
      fehler: ["Der Trockenlauf scheitert, aber kein einzelner Testfall lässt sich nennen"],
    };
  const fehler = gescheitert.map((fall) => fallFehler(fall, ohne)).filter(Boolean);
  if (fehler.length > 0) return { fehler };
  return { faelle: gescheitert.map(({ test, name }) => ({ test, name })) };
}

function nameDes(knoten) {
  const [erstes] = knoten.arguments;
  if (erstes?.type === "Literal" && typeof erstes.value === "string") return erstes.value;
  if (erstes?.type !== "TemplateLiteral" || erstes.expressions.length > 0) return undefined;
  const [{ value }] = erstes.quasis;
  return value.cooked;
}

function istTestaufruf({ type, callee }) {
  if (type !== "CallExpression") return false;
  if (callee.type === "Identifier") return TESTAUFRUFE.has(callee.name);
  if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return false;
  const { object, property } = callee;
  if (property.name === "test") return true;
  return (
    object.type === "Identifier" && TESTAUFRUFE.has(object.name) && ZUSAETZE.has(property.name)
  );
}

export function testfaelleImText(datei, text) {
  const baum = syntaxbaum(datei, text);
  if (baum === undefined) return undefined;
  const faelle = new Map();
  const offen = [{ knoten: baum.ast, vorfahren: [] }];
  while (offen.length > 0) {
    const { knoten, vorfahren } = offen.pop();
    const name = istTestaufruf(knoten) ? nameDes(knoten) : undefined;
    const innen = name === undefined ? vorfahren : [...vorfahren, name];
    if (name !== undefined) {
      const voll = innen.join(" ");
      faelle.set(voll, faelle.has(voll) ? null : text.slice(...knoten.range));
    }
    for (const schluessel of baum.visitorKeys[knoten.type] ?? []) {
      for (const kind of [knoten[schluessel]].flat().filter(Boolean))
        offen.push({ knoten: kind, vorfahren: innen });
    }
  }
  return faelle;
}

function imTextEindeutig({ test, name }, datei) {
  return typeof testfaelleImText(test, readFileSync(datei, "utf8"))?.get(name) === "string";
}

export const DATEI_GEAENDERT = "Datei geändert";
export const HILFSDATEI_GEAENDERT = "Hilfsdatei geändert: ";
const TESTHILFE = /^test\//;

function fassung(rev, test, verzeichnis) {
  if (!gitGelingt(["cat-file", "-e", `${rev}:${test}`], verzeichnis)) return undefined;
  return git(["show", `${rev}:${test}`], verzeichnis);
}

function blob(rev, pfad, verzeichnis) {
  if (!gitGelingt(["cat-file", "-e", `${rev}:${pfad}`], verzeichnis)) return undefined;
  return git(["rev-parse", `${rev}:${pfad}`], verzeichnis).trim();
}

function gleich(pfad, { master, kopf, verzeichnis }) {
  return blob(master, pfad, verzeichnis) === blob(kopf, pfad, verzeichnis);
}

export function hilfsdateien(test, graphen) {
  const erreicht = new Set([test]);
  for (const datei of erreicht) {
    for (const { importe } of graphen) {
      for (const ziel of importe.get(datei) ?? []) if (TESTHILFE.test(ziel)) erreicht.add(ziel);
    }
  }
  erreicht.delete(test);
  return [...erreicht].sort();
}

function fallImBranch({ test, name }, { master, kopf, verzeichnis }) {
  const alt = testfaelleImText(test, fassung(master, test, verzeichnis) ?? "")?.get(name);
  if (alt === undefined || alt === null) return "nicht zuzuordnen";
  const neuText = fassung(kopf, test, verzeichnis);
  if (neuText === undefined) return "gelöscht";
  const neu = testfaelleImText(test, neuText)?.get(name);
  if (neu === undefined) return "gelöscht";
  return neu === alt ? UNVERAENDERT : "geändert";
}

export function imBranch(fall, lauf, graphen = []) {
  const stand = fallImBranch(fall, lauf);
  if (stand !== UNVERAENDERT) return stand;
  if (!gleich(fall.test, lauf)) return DATEI_GEAENDERT;
  const hilfe = hilfsdateien(fall.test, graphen).find((pfad) => !gleich(pfad, lauf));
  return hilfe === undefined ? UNVERAENDERT : `${HILFSDATEI_GEAENDERT}${hilfe}`;
}
