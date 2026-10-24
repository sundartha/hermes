import { readFileSync, realpathSync } from "node:fs";
import { join, posix } from "node:path";

import { dependentsGraph, reachingFiles } from "../../testgraph.mjs";
import { besucheSyntaxbaum, funktionenIn } from "../../ziele/funktionen.mjs";
import { istObjekt, istText, liste } from "./erkundung.mjs";

const QUELLORDNER = "src/";
const GRAPHEN = new Map();
const VORWAERTS = new WeakMap();
const FUNKTIONSWERTE = new Set(["FunctionExpression", "ArrowFunctionExpression"]);

function vorwaerts(graph) {
  if (!VORWAERTS.has(graph)) {
    const kanten = new Map();
    for (const eintraege of graph.values()) for (const { source, resolved } of eintraege) kanten.set(source, [...(kanten.get(source) ?? []), resolved]);
    VORWAERTS.set(graph, kanten);
  }
  return VORWAERTS.get(graph);
}

function moduleZwischen(graph, eingang, ziel) {
  const erreichend = reachingFiles(ziel, graph);
  if (!erreichend.has(eingang)) return new Set();
  const kanten = vorwaerts(graph);
  const gesehen = new Set([eingang]);
  const offen = [eingang];
  while (offen.length > 0) {
    const neu = (kanten.get(offen.pop()) ?? []).filter((datei) => erreichend.has(datei) && !gesehen.has(datei));
    for (const datei of neu) gesehen.add(datei);
    offen.push(...neu);
  }
  return gesehen;
}

export function erreicht(graph, eingang, ziel) {
  return moduleZwischen(graph, eingang, ziel).size > 0;
}

function funktionsStart(definition) {
  if (definition.type === "FunctionName") return definition.node.range[0];
  const wert = definition.type === "Variable" ? definition.node.init : null;
  return FUNKTIONSWERTE.has(wert?.type) ? wert.range[0] : undefined;
}

function startDer(variable) {
  const [definition] = variable?.defs ?? [];
  return definition === undefined ? undefined : funktionsStart(definition);
}

function importAus(datei, { node: knoten, parent: erklaerung }) {
  const quelle = erklaerung.source.value;
  if (knoten.type !== "ImportSpecifier" || !quelle.startsWith(".")) return undefined;
  return { datei: posix.join(posix.dirname(datei), quelle), name: knoten.imported.name };
}

function zielDer(datei, referenz) {
  const [definition] = referenz.resolved?.defs ?? [];
  if (definition === undefined || !referenz.isRead()) return undefined;
  if (definition.type !== "ImportBinding") return { start: funktionsStart(definition) };
  return { herkunft: importAus(datei, definition) };
}

function zeileDer({ identifier: name }) {
  return name.loc.start.line;
}

function exportNamen(knoten) {
  const { declaration: erklaerung, source: quelle, specifiers: angaben } = knoten;
  if (quelle !== null) return [];
  if (erklaerung === null) return angaben.map(({ local: lokal, exported: aussen }) => ({ lokal: lokal.name, aussen: aussen.name }));
  const namen = erklaerung.type === "VariableDeclaration" ? erklaerung.declarations.map(({ id }) => id) : [erklaerung.id];
  return namen.filter((name) => name?.type === "Identifier").map(({ name }) => ({ lokal: name, aussen: name }));
}

function exporteDer(bereiche, exporte) {
  const modul = bereiche.find(({ type }) => type === "module") ?? bereiche[0];
  const namen = exporte.flatMap(exportNamen).map(({ lokal, aussen }) => [aussen, startDer(modul.set.get(lokal))]);
  return new Map(namen.filter(([, start]) => start !== undefined));
}

function dateiIndex(kontext, datei) {
  if (!kontext.dateien.has(datei)) {
    const quelltext = readFileSync(join(kontext.root, datei), "utf8");
    const exporte = [];
    const bezeichner = [];
    let bereiche = [];
    besucheSyntaxbaum(datei, quelltext, (regel) => ({
      ExportNamedDeclaration: (knoten) => exporte.push(knoten),
      Identifier: (knoten) => bezeichner.push({ name: knoten.name, zeile: knoten.loc.start.line }),
      "Program:exit": () => {
        bereiche = regel.sourceCode.scopeManager.scopes;
      },
    }));
    const aufrufe = bereiche.flatMap(({ references: referenzen }) => referenzen.map((referenz) => ({ zeile: zeileDer(referenz), ...zielDer(datei, referenz) })));
    kontext.dateien.set(datei, { bezeichner, funktionen: funktionenIn(datei, quelltext), aufrufe, exporte: exporteDer(bereiche, exporte) });
  }
  return kontext.dateien.get(datei);
}

export function gemeinteFunktion(funktionen, { funktion, von, bis }) {
  const gleichnamig = funktionen.filter(({ name }) => name === funktion);
  return gleichnamig.find((gefunden) => gefunden.von <= von && bis <= gefunden.bis) ?? gleichnamig[0];
}

function funktionDer(kontext, stelle) {
  const { datei } = stelle;
  const gewaehlt = gemeinteFunktion(dateiIndex(kontext, datei).funktionen, stelle);
  return gewaehlt === undefined ? undefined : { datei, funktion: gewaehlt };
}

function nenntName(kontext, { datei, funktion }, name) {
  return dateiIndex(kontext, datei).bezeichner.some((eintrag) => eintrag.name === name && funktion.von <= eintrag.zeile && eintrag.zeile <= funktion.bis);
}

function funktionAm(kontext, datei, start) {
  const gefunden = start === undefined ? undefined : dateiIndex(kontext, datei).funktionen.find((funktion) => funktion.start === start);
  return gefunden === undefined ? [] : [{ datei, funktion: gefunden }];
}

function gliedZu(kontext, datei, { start, herkunft }) {
  if (herkunft === undefined) return funktionAm(kontext, datei, start);
  if (!kontext.module.has(herkunft.datei)) return [];
  return funktionAm(kontext, herkunft.datei, dateiIndex(kontext, herkunft.datei).exporte.get(herkunft.name));
}

function aufgerufene(kontext, { datei, funktion }) {
  const imRumpf = dateiIndex(kontext, datei).aufrufe.filter(({ zeile }) => funktion.von <= zeile && zeile <= funktion.bis);
  return imRumpf.flatMap((aufruf) => gliedZu(kontext, datei, aufruf)).filter((glied) => schluessel(glied) !== schluessel({ datei, funktion }));
}

function schluessel({ datei, funktion }) {
  return `${datei}:${funktion.start}`;
}

function zurueck(vorgaenger, ende) {
  const glieder = [];
  for (let glied = vorgaenger.get(schluessel(ende)); vorgaenger.get(schluessel(glied)) !== null; glied = vorgaenger.get(schluessel(glied))) glieder.unshift(glied);
  return glieder;
}

function suche(kontext, start, ziel) {
  const vorgaenger = new Map([[schluessel(start), null]]);
  const offen = [start];
  while (offen.length > 0) {
    const aktuell = offen.shift();
    const neu = aufgerufene(kontext, aktuell).filter((glied) => !vorgaenger.has(schluessel(glied)));
    for (const glied of neu) vorgaenger.set(schluessel(glied), aktuell);
    const treffer = neu.find(({ datei, funktion }) => datei === ziel.datei && funktion.name === ziel.funktion);
    if (treffer !== undefined) return zurueck(vorgaenger, treffer);
    offen.push(...neu);
  }
  return null;
}

function gerichtet(kontext, von, nach) {
  const module = moduleZwischen(kontext.graph, von.datei, nach.datei);
  if (module.size === 0) return null;
  return suche({ ...kontext, module }, von, { datei: nach.datei, funktion: nach.funktion.name });
}

function alsStelle({ datei, funktion: { name, von, bis } }) {
  return { datei, funktion: name, von, bis };
}

function ketteIn(kontext, von, nach) {
  if (![von, nach].every(({ datei }) => datei.startsWith(QUELLORDNER))) return null;
  const start = funktionDer(kontext, von);
  const ende = funktionDer(kontext, nach);
  if (start === undefined || ende === undefined) return null;
  if (nenntName(kontext, start, nach.funktion) || nenntName(kontext, ende, von.funktion)) return { zwischen: [] };
  const hin = gerichtet(kontext, start, ende);
  const glieder = hin ?? gerichtet(kontext, ende, start)?.toReversed();
  return glieder === undefined || glieder === null ? null : { zwischen: glieder.map(alsStelle) };
}

function neuerKontext(root, graph) {
  return { root, graph, dateien: new Map(), module: new Set() };
}

export function aufrufKette(root, graph, { von, nach }) {
  return ketteIn(neuerKontext(root, graph), von, nach);
}

function istCodeStelle(eintrag) {
  return istObjekt(eintrag) && eintrag.ausweg === undefined && istText(eintrag.datei) && istText(eintrag.funktion);
}

function stellenName({ datei, funktion }) {
  return `${datei}:${funktion}`;
}

function gliedText({ datei, funktion, von, bis }) {
  return `${funktion} (${datei}:${von}-${bis})`;
}

function wegLuecken(kontext, nummer, weg) {
  const gemeldet = new Set(weg.filter(istCodeStelle).map(stellenName));
  return weg.slice(1).flatMap((nach, stelle) => {
    const von = weg[stelle];
    if (!istCodeStelle(von) || !istCodeStelle(nach)) return [];
    const ungemeldet = (ketteIn(kontext, von, nach)?.zwischen ?? []).filter((glied) => !gemeldet.has(stellenName(glied)));
    if (ungemeldet.length === 0) return [];
    return [`${nummer}: zwischen ${von.funktion} (${von.datei}) und ${nach.funktion} (${nach.datei}) liegen ungemeldet ${ungemeldet.map(gliedText).join(", ")}; nenn sie als Stellen des Wegs`];
  });
}

export function kettenBefunde(root, graph, bericht) {
  const kontext = neuerKontext(root, graph);
  return Object.entries(bericht?.nummern ?? {}).flatMap(([nummer, angaben]) => wegLuecken(kontext, nummer, liste(angaben?.weg)));
}

function modulGraph(root) {
  if (!GRAPHEN.has(root)) GRAPHEN.set(root, dependentsGraph(realpathSync(root)));
  return GRAPHEN.get(root);
}

export async function mitKettenBefunden(root, ergebnis) {
  if (ergebnis.befunde.length > 0) return ergebnis;
  return { ...ergebnis, befunde: kettenBefunde(root, await modulGraph(root), ergebnis.bericht) };
}
