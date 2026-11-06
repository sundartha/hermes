import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { istRelativ, syntaxknoten, vorhandenesZiel } from "../tests-ausmisten/importe.mjs";

const TESTMODUL = "node:test";
const TESTAUFRUFE = new Set(["test", "it", "describe", "suite"]);
const ZUSAETZE = new Set(["only", "skip", "todo"]);
const ERLAUBTE_IMPORTE = new Set([...TESTAUFRUFE, "before", "after", "beforeEach", "afterEach", "mock"]);
const ERZEUGER_DATEI = /\.[cm]?[jt]s$/;
const ANALYSEN = new Map();
const OFFEN = { namen: [], ziele: [], offen: true };

function istDatei(wurzel, pfad) {
  const voll = join(wurzel, pfad);
  return existsSync(voll) && statSync(voll).isFile();
}

function vorlagenText(vorlage) {
  const [teil] = vorlage.quasis;
  return teil.value.cooked ?? undefined;
}

function festerName(aufruf) {
  const [erstes] = aufruf.arguments;
  if (erstes?.type === "Literal" && typeof erstes.value === "string") return erstes.value;
  if (erstes?.type === "TemplateLiteral" && erstes.expressions.length === 0) return vorlagenText(erstes);
  return undefined;
}

function heissenTestaufruf(knoten) {
  return knoten.type === "Identifier" && TESTAUFRUFE.has(knoten.name);
}

function eigenschaftsname(knoten) {
  return knoten.type === "MemberExpression" && !knoten.computed ? knoten.property.name : undefined;
}

function ohneZusatz(aufgerufen) {
  const zusatz = ZUSAETZE.has(eigenschaftsname(aufgerufen));
  const innen = zusatz ? aufgerufen.object : undefined;
  const sucht = innen !== undefined && (heissenTestaufruf(innen) || TESTAUFRUFE.has(eigenschaftsname(innen)));
  return sucht ? innen : aufgerufen;
}

function gedeckteKnoten(aufgerufen) {
  const kern = ohneZusatz(aufgerufen);
  if (heissenTestaufruf(kern)) return [kern];
  if (!TESTAUFRUFE.has(eigenschaftsname(kern))) return [];
  return heissenTestaufruf(kern.object) ? [kern.property, kern.object] : [kern.property];
}

function erzeugtRequire(eintrag) {
  const init = eintrag.type === "VariableDeclarator" ? eintrag.init : undefined;
  return init?.type === "CallExpression" && init.callee.name === "createRequire";
}

function requireNamen(knoten) {
  const erzeugt = knoten.filter((eintrag) => erzeugtRequire(eintrag) && eintrag.id.type === "Identifier");
  return new Set(["require", ...erzeugt.map((eintrag) => eintrag.id.name)]);
}

function ziele(wurzel, datei, knoten) {
  const ladenNamen = requireNamen(knoten);
  const rohe = knoten.flatMap((eintrag) => {
    if (eintrag.type === "ImportDeclaration" || eintrag.type === "ExportAllDeclaration" || eintrag.type === "ExportNamedDeclaration") return [eintrag.source];
    if (eintrag.type === "ImportExpression") return [eintrag.source];
    const requireAufruf = eintrag.type === "CallExpression" && eintrag.callee.type === "Identifier" && ladenNamen.has(eintrag.callee.name);
    return requireAufruf ? [eintrag.arguments[0]] : [];
  });
  const quellen = rohe.filter((quelle) => quelle !== null);
  const feste = quellen.filter((quelle) => quelle?.type === "Literal" && typeof quelle.value === "string");
  const relativ = feste.map((quelle) => quelle.value).filter(istRelativ);
  const aufgeloest = relativ.map((pfad) => vorhandenesZiel(datei, pfad, (ziel) => istDatei(wurzel, ziel)));
  return { ziele: aufgeloest.filter(Boolean), offen: feste.length !== quellen.length || aufgeloest.some((ziel) => ziel === undefined) };
}

function unerlaubterTestimport(knoten) {
  const importe = knoten.filter((eintrag) => eintrag.type === "ImportDeclaration" && eintrag.source.value === TESTMODUL);
  const sonstige = knoten.filter((eintrag) => eintrag.type === "Literal" && eintrag.value === TESTMODUL).length !== importe.length;
  const unbekannt = importe.flatMap((eintrag) => eintrag.specifiers).some((angabe) => {
    if (angabe.type === "ImportDefaultSpecifier") return angabe.local.name !== "test";
    if (angabe.type !== "ImportSpecifier") return true;
    return angabe.imported.name !== angabe.local.name || !ERLAUBTE_IMPORTE.has(angabe.imported.name);
  });
  const erzeugt = knoten.filter((eintrag) => eintrag.type === "CallExpression" && eintrag.callee.name === "createRequire").length;
  const benannt = knoten.filter(erzeugtRequire).length;
  return sonstige || unbekannt || erzeugt !== benannt;
}

function importierte(knoten) {
  const importe = knoten.filter((eintrag) => eintrag.type === "ImportDeclaration" && eintrag.source.value === TESTMODUL);
  return importe.flatMap((eintrag) => eintrag.specifiers).flatMap((angabe) => [angabe.local, angabe.imported].filter(Boolean));
}

function regexNamen(knoten) {
  const regex = (wert) => (wert?.type === "Literal" && wert.regex !== undefined) || (wert?.type === "NewExpression" && wert.callee.name === "RegExp");
  const deklariert = knoten.filter((eintrag) => eintrag.type === "VariableDeclarator" && eintrag.id.type === "Identifier" && regex(eintrag.init));
  return new Set(deklariert.map((eintrag) => eintrag.id.name));
}

function istRegex(objekt, regexe) {
  return (objekt.type === "Literal" && objekt.regex !== undefined) || (objekt.type === "Identifier" && regexe.has(objekt.name));
}

function ungeklaert(aufruf, regexe, registriert) {
  const kern = ohneZusatz(aufruf.callee);
  if (kern.type !== "MemberExpression") return true;
  const regexPruefung = istRegex(kern.object, regexe);
  const einArgument = aufruf.arguments.length === 1 && !registriert;
  return !regexPruefung && !einArgument;
}

function aufrufe(knoten) {
  const importiert = importierte(knoten);
  const registriert = importiert.some((eintrag) => TESTAUFRUFE.has(eintrag.name));
  const gedeckt = new Set(importiert);
  const regexe = regexNamen(knoten);
  const namen = [];
  let offen = false;
  for (const aufruf of knoten.filter((eintrag) => eintrag.type === "CallExpression")) {
    const deckt = gedeckteKnoten(aufruf.callee);
    if (deckt.length === 0) continue;
    for (const eintrag of deckt) gedeckt.add(eintrag);
    const name = festerName(aufruf);
    if (name !== undefined) namen.push(name);
    else if (ungeklaert(aufruf, regexe, registriert)) offen = true;
  }
  const ungedeckt = registriert && knoten.some((eintrag) => heissenTestaufruf(eintrag) && !gedeckt.has(eintrag));
  return { namen, offen: offen || ungedeckt };
}

function analysiere(wurzel, datei) {
  if (!ERZEUGER_DATEI.test(datei)) return { namen: [], ziele: [], offen: false };
  const knoten = istDatei(wurzel, datei) ? syntaxknoten(datei, readFileSync(join(wurzel, datei), "utf8")) : undefined;
  if (knoten === undefined) return OFFEN;
  const { namen, offen } = aufrufe(knoten);
  const kanten = ziele(wurzel, datei, knoten);
  return { namen, ziele: kanten.ziele, offen: offen || kanten.offen || unerlaubterTestimport(knoten) };
}

function analyse(wurzel, datei) {
  const schluessel = join(wurzel, datei);
  if (!ANALYSEN.has(schluessel)) ANALYSEN.set(schluessel, analysiere(wurzel, datei));
  return ANALYSEN.get(schluessel);
}

export function kannNamenErzeugen(datei, name, wurzel = ".") {
  const gesehen = new Set();
  const offen = [datei];
  while (offen.length > 0) {
    const aktuell = offen.pop();
    if (gesehen.has(aktuell)) continue;
    gesehen.add(aktuell);
    const befund = analyse(wurzel, aktuell);
    if (befund.offen || befund.namen.some((fest) => fest.includes(name))) return true;
    offen.push(...befund.ziele);
  }
  return false;
}
