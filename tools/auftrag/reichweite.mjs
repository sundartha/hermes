import { existsSync, readFileSync } from "node:fs";
import { basename, join, posix } from "node:path";

import { TEST_FILE } from "../testgraph.mjs";

import { dateiAm } from "./git.mjs";
import { ALLES, huelle, lies, modell, nameVon, unterschied } from "./reichweite-modell.mjs";

const JAVASCRIPT = /\.[cm]?js$/;
const ENDUNGEN = ["", ".js", ".mjs", ".cjs", "/index.js"];
const ALLE = "*";
const STANDARD = "default";
const UNKLAR = Object.freeze({ unklar: true });

export function aenderungsReichweite(basis, geaendert, root) {
  const eintraege = geaendert
    .filter((pfad) => !TEST_FILE.test(pfad))
    .map((pfad) => [pfad, JAVASCRIPT.test(pfad) ? verglichen(basis, pfad, root) : ALLES]);
  return Object.fromEntries(eintraege.filter(([, eintrag]) => eintrag !== null));
}

function verglichen(basis, pfad, root) {
  const alt = dateiAm(basis, pfad, root);
  const datei = join(root, pfad);
  if (alt === null || !existsSync(datei)) return null;
  return unterschied(alt, readFileSync(datei, "utf8"));
}

function loestAuf(spezifizierer, importeur, ziel) {
  if (!spezifizierer.startsWith(".")) return false;
  const pfad = posix.normalize(posix.join(posix.dirname(importeur), spezifizierer));
  return ENDUNGEN.some((endung) => pfad + endung === ziel);
}

function anfangsText(knoten) {
  if (knoten?.type === "Literal") return knoten.value;
  if (knoten?.type !== "TemplateLiteral") return null;
  const [erste] = knoten.quasis;
  return erste.value.cooked;
}

function modulPfad(knoten) {
  const text = anfangsText(knoten);
  if (typeof text !== "string") return null;
  const abfrage = text.indexOf("?");
  if (abfrage === -1) return knoten.type === "Literal" ? text : null;
  return text.slice(0, abfrage);
}

function dynamischeZiele(baum) {
  const gefunden = [];
  const besuche = (knoten) => {
    if (knoten === null || typeof knoten !== "object") return;
    if (Array.isArray(knoten)) return knoten.forEach(besuche);
    if (knoten.type === "ImportExpression") gefunden.push(knoten.source);
    if (knoten.type === "CallExpression" && knoten.callee.name === "require") gefunden.push(knoten.arguments[0]);
    for (const [schluessel, kind] of Object.entries(knoten)) if (schluessel !== "range") besuche(kind);
  };
  besuche(baum);
  return gefunden;
}

const NAMENSZEICHEN = /[\w.-]/;

export function nenntDatei(text, ziel) {
  const name = basename(ziel);
  for (let stelle = text.indexOf(name); stelle !== -1; stelle = text.indexOf(name, stelle + 1)) {
    if (stelle === 0 || !NAMENSZEICHEN.test(text[stelle - 1])) return true;
  }
  return false;
}

function ohneBereiche(text, bereiche) {
  return [...bereiche].sort((links, rechts) => rechts[0] - links[0]).reduce((rest, [von, bis]) => rest.slice(0, von) + rest.slice(bis), text);
}

function namenAusImport(anweisung) {
  const angaben = anweisung.specifiers.map((angabe) => {
    if (angabe.type === "ImportNamespaceSpecifier") return UNKLAR;
    return { importiert: angabe.type === "ImportDefaultSpecifier" ? STANDARD : nameVon(angabe.imported), lokal: angabe.local.name };
  });
  return { importe: angaben.filter((angabe) => angabe !== UNKLAR), unklar: angaben.includes(UNKLAR) };
}

function nutzung(text, importeur, ziel) {
  const baum = lies(text, { range: true });
  if (baum === null) return UNKLAR;
  const treffer = baum.body.filter((anweisung) => anweisung.source?.type === "Literal" && loestAuf(anweisung.source.value, importeur, ziel));
  const dynamisch = dynamischeZiele(baum);
  const beschrieben = dynamisch.some((knoten) => {
    const pfad = modulPfad(knoten);
    return pfad === null || loestAuf(pfad, importeur, ziel);
  });
  const rest = ohneBereiche(text, treffer.map(({ source }) => source.range));
  if (treffer.length === 0 || beschrieben || nenntDatei(rest, ziel)) return UNKLAR;
  return zusammen(treffer);
}

function zusammen(treffer) {
  const importe = treffer.filter((anweisung) => anweisung.type === "ImportDeclaration").map(namenAusImport);
  const weiter = treffer.filter((anweisung) => anweisung.type === "ExportNamedDeclaration").flatMap((anweisung) => anweisung.specifiers.map((angabe) => ({ importiert: nameVon(angabe.local), exportiert: nameVon(angabe.exported) })));
  const stern = treffer.filter((anweisung) => anweisung.type === "ExportAllDeclaration");
  return {
    unklar: importe.some(({ unklar }) => unklar) || stern.some((anweisung) => anweisung.exported !== null),
    importe: importe.flatMap((eintrag) => eintrag.importe),
    weiter,
    stern: stern.length > 0,
  };
}

function getroffen(verwendung, namen) {
  if (verwendung.unklar || namen === ALLE) return true;
  const genutzt = [...verwendung.importe.map(({ importiert }) => importiert), ...verwendung.weiter.map(({ importiert }) => importiert)];
  return verwendung.stern || genutzt.some((name) => namen.has(name));
}

function folgenFuer(text, verwendung, namen) {
  if (verwendung.unklar || namen === ALLE) return ALLE;
  const stand = modell(text);
  if (stand === null) return ALLE;
  const anfang = verwendung.importe.filter(({ importiert }) => namen.has(importiert)).map(({ lokal }) => lokal);
  const gehuellt = huelle(stand, anfang);
  if (gehuellt.alle) return ALLE;
  const durchgereicht = verwendung.weiter.filter(({ importiert }) => namen.has(importiert)).map(({ exportiert }) => exportiert);
  return new Set([...gehuellt.namen, ...durchgereicht, ...(verwendung.stern ? namen : [])]);
}

function lesen(wurzel, pfad) {
  const datei = join(wurzel, pfad);
  return existsSync(datei) ? readFileSync(datei, "utf8") : null;
}

export function folgeImporteur({ importeur, ziel, namen }, wurzel) {
  const text = lesen(wurzel, importeur);
  const verwendung = text === null ? UNKLAR : nutzung(text, importeur, ziel);
  if (!getroffen(verwendung, namen)) return null;
  return text === null || TEST_FILE.test(importeur) ? ALLE : folgenFuer(text, verwendung, namen);
}

function vereinigt(bekannt, neu) {
  if (bekannt === ALLE || neu === bekannt) return null;
  if (neu === ALLE) return ALLE;
  const fehlend = [...neu].filter((name) => bekannt === undefined || !bekannt.has(name));
  return fehlend.length === 0 ? null : new Set([...(bekannt ?? []), ...fehlend]);
}

export function direkteImporteure(graph, datei) {
  return (graph.get(datei) ?? []).map((kante) => kante.source);
}

export function testsInReichweite(start, eintrag, { graph, wurzel }) {
  const tests = new Set();
  const gesehen = new Map();
  const offen = [[start, eintrag.alle ? ALLE : new Set(eintrag.namen)]];
  while (offen.length > 0) {
    const [datei, namen] = offen.pop();
    const erweitert = vereinigt(gesehen.get(datei), namen);
    if (erweitert === null) continue;
    gesehen.set(datei, erweitert);
    for (const importeur of direkteImporteure(graph, datei)) {
      const folge = folgeImporteur({ importeur, ziel: datei, namen: erweitert }, wurzel);
      if (folge === null) continue;
      if (TEST_FILE.test(importeur)) tests.add(importeur);
      offen.push([importeur, folge]);
    }
  }
  return [...tests].sort();
}
