import * as espree from "espree";

import { istTestdatei } from "./format.mjs";
import { ueberschneiden } from "./kollision.mjs";

const PARSER = { ecmaVersion: "latest", sourceType: "module", range: true };
const EINE_ZEILE = 1;

function zeilenBeginne(text) {
  const beginne = [0];
  for (let stelle = text.indexOf("\n"); stelle !== -1; stelle = text.indexOf("\n", stelle + 1)) beginne.push(stelle + 1);
  return beginne;
}

function zeileVon(beginne, stelle) {
  return beginne.filter((beginn) => beginn <= stelle).length;
}

function deklarierteNamen(anweisung) {
  const deklaration = anweisung.declaration ?? anweisung;
  if (deklaration.type === "VariableDeclaration") return deklaration.declarations.filter((eintrag) => eintrag.id.type === "Identifier").map((eintrag) => eintrag.id.name);
  if ((deklaration.type === "FunctionDeclaration" || deklaration.type === "ClassDeclaration") && deklaration.id !== null) return [deklaration.id.name];
  return [];
}

export function bezuegeIn(knoten, gefunden = new Set()) {
  if (knoten === null || typeof knoten !== "object") return gefunden;
  if (Array.isArray(knoten)) {
    for (const kind of knoten) bezuegeIn(kind, gefunden);
    return gefunden;
  }
  if (knoten.type === "Identifier") gefunden.add(knoten.name);
  for (const [schluessel, kind] of Object.entries(knoten)) if (schluessel !== "range") bezuegeIn(kind, gefunden);
  return gefunden;
}

export function lies(text) {
  try {
    return espree.parse(text, PARSER);
  } catch {
    return null;
  }
}

export function vermesse(text, namen) {
  const baum = lies(text);
  if (baum === null) return null;
  const beginne = zeilenBeginne(text);
  const stellen = new Map();
  for (const anweisung of baum.body) for (const name of deklarierteNamen(anweisung)) stellen.set(name, anweisung);
  const fehlend = namen.filter((name) => !stellen.has(name));
  if (fehlend.length > 0) return null;
  const bereiche = namen.map((name) => [zeileVon(beginne, stellen.get(name).range[0]), zeileVon(beginne, stellen.get(name).range[1] - 1)]);
  const bezuege = new Set();
  for (const name of namen) bezuegeIn(stellen.get(name), bezuege);
  for (const name of namen) bezuege.delete(name);
  const rahmen = baum.body.filter(istRahmen).map((anweisung) => [zeileVon(beginne, anweisung.range[0]), zeileVon(beginne, anweisung.range[1] - 1)]);
  const leer = new Set(text.split("\n").flatMap((zeile, index) => (zeile.trim() === "" ? [index + EINE_ZEILE] : [])));
  return { namen: new Set(namen), bereiche, bezuege, rahmen, leer };
}

function istRahmen(anweisung) {
  return anweisung.type === "ImportDeclaration" || ((anweisung.type === "ExportNamedDeclaration" || anweisung.type === "ExportAllDeclaration") && anweisung.source !== null);
}

export function ausserhalbBetrifft(messung, geaendert) {
  const erlaubt = [...messung.bereiche, ...messung.rahmen].map(([von, bis]) => [messung.leer.has(von - EINE_ZEILE) ? von - EINE_ZEILE : von, messung.leer.has(bis + EINE_ZEILE) ? bis + EINE_ZEILE : bis]);
  return geaendert.filter(([von, bis]) => !erlaubt.some(([erlaubtVon, erlaubtBis]) => von >= erlaubtVon && bis <= erlaubtBis));
}

function quelldateien(auftrag) {
  return (auftrag.erwarteteDateien ?? []).filter((datei) => !istTestdatei(datei));
}

function testdateien(auftrag) {
  return (auftrag.erwarteteDateien ?? []).filter(istTestdatei);
}

function gemeinsame(auftrag, anderer, dateienDes = quelldateien) {
  const andere = new Set(dateienDes(anderer));
  return dateienDes(auftrag).filter((datei) => andere.has(datei));
}

function messung(auftrag, datei, quelle) {
  const namen = auftrag.betrifft?.[datei];
  const text = quelle(datei);
  if (!Array.isArray(namen) || text === null) return null;
  return vermesse(text, namen);
}

function gemessen(spaeter, frueher, quelle) {
  const gruende = [];
  for (const datei of gemeinsame(spaeter, frueher)) {
    if (quelle(datei) === null) {
      gruende.push(`gleiche neue Zieldatei ${datei}`);
      continue;
    }
    const eigene = messung(spaeter, datei, quelle);
    const fremde = messung(frueher, datei, quelle);
    if (eigene === null || fremde === null) return null;
    if (ueberschneiden(eigene.bereiche, fremde.bereiche)) gruende.push(`Zeilenbereiche in ${datei} überschneiden sich`);
    for (const name of [...eigene.bezuege].filter((bezug) => fremde.namen.has(bezug))) gruende.push(`${spaeter.id} nutzt ${name} aus ${frueher.id}`);
    for (const name of [...fremde.bezuege].filter((bezug) => eigene.namen.has(bezug))) gruende.push(`${frueher.id} nutzt ${name} aus ${spaeter.id}`);
  }
  return gruende;
}

function dateiGruende(spaeter, frueher) {
  return gemeinsame(spaeter, frueher).map((datei) => `gleiche Datei ${datei}`);
}

function gruendeDes(spaeter, frueher, quelle) {
  const gemeinsamAnzahl = gemeinsame(spaeter, frueher).length;
  const beide = spaeter.betrifft !== undefined && frueher.betrifft !== undefined;
  const messbar = beide && gemeinsamAnzahl > 0 ? gemessen(spaeter, frueher, quelle) : null;
  const ausdruecklich = (spaeter.abhaengigVon ?? []).includes(frueher.id) ? ["abhaengigVon"] : [];
  const tests = gemeinsame(spaeter, frueher, testdateien).map((datei) => `gleiche Testdatei ${datei}`);
  return [...ausdruecklich, ...tests, ...(messbar ?? dateiGruende(spaeter, frueher))];
}

export function abhaengigkeitsgraph(auftraege, quelle) {
  const graph = new Map();
  auftraege.forEach((spaeter, index) => {
    const vorgaenger = new Map();
    for (const frueher of auftraege.slice(0, index)) {
      const gruende = gruendeDes(spaeter, frueher, quelle);
      if (gruende.length > 0) vorgaenger.set(frueher.id, gruende);
    }
    graph.set(spaeter.id, vorgaenger);
  });
  return graph;
}
