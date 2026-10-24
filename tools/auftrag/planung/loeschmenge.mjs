import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { cruise } from "dependency-cruiser";

import { schluesselName } from "../../eslint-rules/knoten.js";
import { besucheSyntaxbaum } from "../../ziele/funktionen.mjs";
import { istTestdatei } from "../format.mjs";
import { abschnitte } from "./abschnitte.mjs";

export const LOESCHEN = "## Löschen";
const EINSTIEG = /`([^`\s:]+):([^`]+)`/g;
const NUTZER_WURZELN = ["src", "scripts", "test", "tools/hermes-ctl.mjs", "tools/hermes-ctl"];
const GRAPH = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const ROUTEN_METHODEN = new Set(["all", "delete", "get", "patch", "post", "put", "use"]);
const NIE_GELOESCHT = new Set(["Parameter", "CatchClause", "ImplicitGlobalVariable"]);
const ALLES = "*";
const STANDARD = "default";
const TEST_LOESCHEN = "löschen";
const TEST_ANPASSEN = "anpassen";

export function loeschEinstiege(pitch) {
  const ausschnitt = abschnitte(pitch, [LOESCHEN]).abschnitte.get(LOESCHEN);
  if (ausschnitt === undefined) return undefined;
  return [...ausschnitt.matchAll(EINSTIEG)].map(([, datei, ziel]) => ({ datei, ziel: ziel.trim() }));
}

function istProjektdatei({ coreModule, couldNotResolve, matchesDoNotFollow, followable }) {
  return !coreModule && !couldNotResolve && !matchesDoNotFollow && followable !== false;
}

async function graph(root) {
  const wurzeln = NUTZER_WURZELN.filter((wurzel) => existsSync(join(root, wurzel)));
  const { output } = await cruise(wurzeln, { ...GRAPH, baseDir: root });
  const module = output.modules.filter(istProjektdatei);
  const ziele = (abhaengig) => new Map(abhaengig.filter(istProjektdatei).map(({ module: angabe, resolved }) => [angabe, resolved]));
  return new Map(module.map(({ source, dependencies, dependents }) => [source, { ziele: ziele(dependencies), importeure: dependents }]));
}

function bezeichner(knoten) {
  return knoten.type === "Identifier" ? knoten.name : String(knoten.value);
}

function enthaelt(aussen, innen) {
  return aussen.range[0] <= innen.range[0] && innen.range[1] <= aussen.range[1];
}

function istBezug({ parent: eltern }) {
  return eltern.type !== "ExportSpecifier" && eltern.type !== "ExportDefaultDeclaration";
}

function variablenIn(scopeManager) {
  const geloescht = (variable) => variable.defs.length > 0 && variable.defs.every(({ type }) => !NIE_GELOESCHT.has(type));
  const eintrag = (variable) => ({
    name: variable.name,
    modul: variable.scope.type === "module",
    knoten: variable.defs.map(({ node }) => node),
    bezuege: variable.references.map(({ identifier }) => identifier).filter(istBezug),
  });
  return scopeManager.scopes.flatMap(({ type, variables }) => (type === "function-expression-name" ? [] : variables.filter(geloescht).map(eintrag)));
}

function exportNamen(knoten, scopeManager) {
  const { declaration: deklaration, specifiers: angaben = [], source: quelle } = knoten;
  if (knoten.type === "ExportDefaultDeclaration") return [[STANDARD, deklaration.id?.name ?? (deklaration.type === "Identifier" ? deklaration.name : null)]];
  if (deklaration?.id) return [[deklaration.id.name, deklaration.id.name]];
  if (deklaration) return scopeManager.getDeclaredVariables(deklaration).map(({ name }) => [name, name]);
  return angaben.map(({ exported, local: lokal }) => [bezeichner(exported), quelle ? null : bezeichner(lokal)]);
}

function importAngaben(knoten) {
  const quelle = knoten.source.value;
  if (knoten.type !== "ImportDeclaration" || knoten.specifiers.length === 0) return [{ quelle, name: ALLES, knoten }];
  return knoten.specifiers.map((angabe) => {
    if (angabe.type === "ImportSpecifier") return { quelle, name: bezeichner(angabe.imported), knoten: angabe };
    return { quelle, name: angabe.type === "ImportDefaultSpecifier" ? STANDARD : ALLES, knoten: angabe };
  });
}

function nachgeladen(aufruf) {
  const [erstes] = aufruf.type === "ImportExpression" ? [aufruf.source] : aufruf.arguments;
  const istRequire = aufruf.type === "ImportExpression" || aufruf.callee.name === "require";
  return istRequire && erstes?.type === "Literal" ? [{ quelle: erstes.value, name: ALLES, knoten: aufruf }] : [];
}

function modulBindung(knoten) {
  if (knoten.type === "ImportNamespaceSpecifier") return knoten.local;
  const { parent: eltern } = knoten;
  const aussen = eltern.type === "AwaitExpression" ? eltern.parent : eltern;
  if (aussen.type === "VariableDeclarator") return aussen.id;
  return aussen.type === "AssignmentExpression" ? aussen.left : null;
}

function mitgliedsName(bezug) {
  const { parent: eltern } = bezug;
  return eltern.type === "MemberExpression" && eltern.object === bezug && !eltern.computed ? eltern.property.name : null;
}

function genutzteNamen(knoten, variablen) {
  if (knoten.type === "ImportDeclaration") return [];
  const bindung = modulBindung(knoten);
  if (bindung?.type === "ObjectPattern") {
    const namen = bindung.properties.map(schluesselName);
    return namen.includes(undefined) ? null : namen;
  }
  if (bindung?.type !== "Identifier") return null;
  const variable = variablen.find(({ knoten: definiert, bezuege }) => definiert.includes(bindung.parent) || bezuege.includes(bindung));
  const namen = (variable?.bezuege ?? [null]).filter((bezug) => bezug !== bindung).map((bezug) => bezug && mitgliedsName(bezug));
  return namen.includes(null) ? null : namen;
}

function analysiere(root, datei) {
  let baum;
  besucheSyntaxbaum(datei, readFileSync(join(root, datei), "utf8"), (kontext) => {
    const aufrufe = [];
    const merke = (knoten) => aufrufe.push(knoten);
    return { CallExpression: merke, ImportExpression: merke, "Program:exit": (programm) => (baum = { programm, aufrufe, scopeManager: kontext.sourceCode.scopeManager }) };
  });
  if (baum === undefined) return null;
  const { programm, aufrufe, scopeManager } = baum;
  const mitQuelle = programm.body.filter(({ type, source }) => type === "ImportDeclaration" || (type.startsWith("Export") && source));
  const variablen = variablenIn(scopeManager);
  const mitNamen = (angabe) => (angabe.name === ALLES ? { ...angabe, genutzt: genutzteNamen(angabe.knoten, variablen) } : angabe);
  return {
    programm,
    aufrufe,
    variablen,
    exporte: programm.body.filter(({ type }) => type.startsWith("Export")).flatMap((knoten) => exportNamen(knoten, scopeManager)),
    importe: [...mitQuelle.flatMap(importAngaben), ...aufrufe.flatMap(nachgeladen)].map(mitNamen),
  };
}

const OHNE_KANTEN = { ziele: new Map(), importeure: [] };

function neueLage(root, module) {
  const kanten = (datei) => module.get(datei) ?? OHNE_KANTEN;
  const lage = { root, module, analysen: new Map(), weg: new Map(), tot: new Set(), toteVariablen: new Set(), erzwungen: new Set(), einstiege: new Set() };
  lage.analyse = (datei) => {
    if (!lage.analysen.has(datei)) lage.analysen.set(datei, analysiere(root, datei));
    return lage.analysen.get(datei);
  };
  lage.ziele = (datei) => kanten(datei).ziele;
  lage.nutzer = (datei) => kanten(datei).importeure.filter((nutzer) => !istTestdatei(nutzer));
  lage.wegIn = (datei) => lage.weg.get(datei) ?? lage.weg.set(datei, []).get(datei);
  return lage;
}

function entfernt(lage, datei, knoten) {
  return lage.tot.has(datei) || lage.wegIn(datei).some((weg) => enthaelt(weg, knoten));
}

function importeVon(lage, nutzer, ziel) {
  const analyse = lage.analyse(nutzer);
  const lebt = (knoten) => !lage.tot.has(nutzer) && (knoten === null || !entfernt(lage, nutzer, knoten));
  if (analyse === null) return [{ name: ALLES, lebt: lebt(null) }];
  const ziele = lage.ziele(nutzer);
  return analyse.importe.filter(({ quelle }) => ziele.get(quelle) === ziel).map(({ name, knoten }) => ({ name, lebt: lebt(knoten) }));
}

function nutzerImporte(lage, ziel) {
  return lage.nutzer(ziel).flatMap((nutzer) => importeVon(lage, nutzer, ziel));
}

function exportLebt(lage, datei, name) {
  if (lage.erzwungen.has(`${datei}:${name}`)) return false;
  const importe = nutzerImporte(lage, datei).filter((angabe) => angabe.name === name || angabe.name === ALLES);
  return importe.length === 0 || importe.some(({ lebt }) => lebt);
}

function exportNamenVon(exporte, variable) {
  return variable.modul ? exporte.filter(([, lokal]) => lokal === variable.name).map(([name]) => name) : [];
}

function fremdeBezuege(variable) {
  return variable.bezuege.filter((bezug) => !variable.knoten.some((knoten) => enthaelt(knoten, bezug)));
}

function variableLebt(lage, datei, variable) {
  if (fremdeBezuege(variable).some((bezug) => !entfernt(lage, datei, bezug))) return true;
  return exportNamenVon(lage.analyse(datei).exporte, variable).some((name) => exportLebt(lage, datei, name));
}

function warLebendig(lage, datei, variable) {
  return exportNamenVon(lage.analyse(datei).exporte, variable).length > 0 || fremdeBezuege(variable).length > 0;
}

function anweisungWeg(lage, datei, anweisung) {
  if (entfernt(lage, datei, anweisung)) return true;
  const { type: art, specifiers: angaben = [], declarations: deklarationen, declaration: deklaration, source: quelle } = anweisung;
  if (art === "ImportDeclaration") return angaben.length > 0 && angaben.every((angabe) => entfernt(lage, datei, angabe));
  if (art === "VariableDeclaration") return deklarationen.every((einzeln) => entfernt(lage, datei, einzeln));
  if (art !== "ExportNamedDeclaration") return false;
  if (deklaration) return anweisungWeg(lage, datei, deklaration);
  return !quelle && angaben.length > 0 && angaben.every(({ exported }) => !exportLebt(lage, datei, bezeichner(exported)));
}

function stirbt(lage, datei, variable) {
  lage.toteVariablen.add(variable);
  const analyse = lage.analyse(datei);
  const frei = variable.knoten.filter((knoten) => analyse.variablen.every((andere) => lage.toteVariablen.has(andere) || !andere.knoten.includes(knoten)));
  lage.wegIn(datei).push(...frei);
}

function dateiStirbt(lage, datei) {
  const { programm } = lage.analyse(datei);
  const ohneNutzer = lage.nutzer(datei).length > 0 && !nutzerImporte(lage, datei).some(({ lebt }) => lebt);
  return ohneNutzer || (programm.body.length > 0 && programm.body.every((anweisung) => anweisungWeg(lage, datei, anweisung)));
}

function pruefe(lage, datei) {
  if (lage.tot.has(datei) || istTestdatei(datei) || lage.analyse(datei) === null) return false;
  const offen = (variable) => !lage.toteVariablen.has(variable) && warLebendig(lage, datei, variable);
  let geaendert = false;
  for (let sterbend = [null]; sterbend.length > 0; ) {
    sterbend = lage.analyse(datei).variablen.filter((variable) => offen(variable) && !variableLebt(lage, datei, variable));
    for (const variable of sterbend) stirbt(lage, datei, variable);
    geaendert ||= sterbend.length > 0;
  }
  if (!dateiStirbt(lage, datei)) return geaendert;
  lage.tot.add(datei);
  return true;
}

function routenKnoten(analyse, pfad) {
  const istPfad = (angabe) => angabe?.type === "Literal" && angabe.value === pfad;
  const treffer = analyse.aufrufe.filter(({ callee: aufgerufen, arguments: angaben }) => aufgerufen?.type === "MemberExpression" && ROUTEN_METHODEN.has(aufgerufen.property.name) && istPfad(angaben[0]));
  return treffer.map((aufruf) => (aufruf.parent.type === "ExpressionStatement" ? aufruf.parent : aufruf));
}

function setzeEinstieg(lage, { datei, ziel }) {
  const analyse = existsSync(join(lage.root, datei)) && lage.module.has(datei) ? lage.analyse(datei) : null;
  if (analyse === null) return false;
  if (ziel.startsWith("/")) {
    const knoten = routenKnoten(analyse, ziel);
    lage.wegIn(datei).push(...knoten);
    return knoten.length > 0;
  }
  const variable = analyse.variablen.toSorted((links, rechts) => Number(rechts.modul) - Number(links.modul)).find(({ name }) => name === ziel);
  if (variable === undefined) return false;
  lage.einstiege.add(variable);
  stirbt(lage, datei, variable);
  for (const [name, lokal] of analyse.exporte) if (variable.modul && lokal === ziel) lage.erzwungen.add(`${datei}:${name}`);
  return true;
}

function bisRuhe(lage, start) {
  const offen = new Set(start);
  for (const datei of offen) {
    offen.delete(datei);
    if (pruefe(lage, datei)) for (const ziel of lage.ziele(datei).values()) offen.add(ziel);
  }
}

function projektImporte(lage, datei) {
  const analyse = lage.analyse(datei);
  if (analyse === null) return [];
  const ziele = lage.ziele(datei);
  const einzeln = ({ quelle, name, genutzt }) => (genutzt ?? [name]).map((genannt) => ({ ziel: ziele.get(quelle), name: genannt }));
  return analyse.importe.flatMap(einzeln).filter(({ ziel }) => ziel && !istTestdatei(ziel));
}

function betroffeneTests(lage) {
  const betroffen = (ziel) => lage.tot.has(ziel) || lage.analysen.has(ziel);
  const geloescht = ({ ziel, name }) => lage.tot.has(ziel) || (name !== ALLES && !exportLebt(lage, ziel, name));
  const mitGeloeschtem = ({ ziel, name }) => name === ALLES && (lage.analyse(ziel)?.exporte ?? []).some(([genannt]) => !exportLebt(lage, ziel, genannt));
  const kandidaten = [...lage.module.keys()].filter((datei) => istTestdatei(datei) && [...lage.ziele(datei).values()].some(betroffen));
  return kandidaten.toSorted().flatMap((datei) => {
    const importe = projektImporte(lage, datei);
    if (!importe.some((angabe) => geloescht(angabe) || mitGeloeschtem(angabe))) return [];
    return [{ datei, art: importe.every(geloescht) ? TEST_LOESCHEN : TEST_ANPASSEN }];
  });
}

function bleibendeDateien(lage) {
  return [...lage.analysen].filter(([datei, analyse]) => analyse !== null && !lage.tot.has(datei) && !istTestdatei(datei));
}

function toteExporte(lage) {
  return bleibendeDateien(lage).flatMap(([datei, { exporte }]) =>
    exporte.filter(([name]) => !lage.erzwungen.has(`${datei}:${name}`) && !exportLebt(lage, datei, name)).map(([name]) => `${datei}:${name}`),
  );
}

function reste(lage) {
  return bleibendeDateien(lage).flatMap(([datei, { variablen, exporte }]) => {
    const exportiert = (variable) => exportNamenVon(exporte, variable).length > 0;
    const umschlossen = (knoten) => lage.wegIn(datei).some((weg) => weg !== knoten && enthaelt(weg, knoten));
    const eigenstaendig = (variable) => !variable.knoten.every(umschlossen);
    const rest = variablen.filter((variable) => lage.toteVariablen.has(variable) && !lage.einstiege.has(variable) && !exportiert(variable) && eigenstaendig(variable));
    return rest.map(({ name }) => `${datei}:${name}`);
  });
}

export async function loeschmenge(root, einstiege) {
  const lage = neueLage(root, await graph(root));
  const fehlend = einstiege.filter((einstieg) => !setzeEinstieg(lage, einstieg));
  bisRuhe(lage, einstiege.map(({ datei }) => datei).filter((datei) => lage.module.has(datei)));
  const sortiert = (liste) => [...new Set(liste)].toSorted();
  return {
    dateien: sortiert([...lage.tot]),
    exporte: sortiert(toteExporte(lage)),
    reste: sortiert(reste(lage)),
    tests: betroffeneTests(lage),
    fehlend: fehlend.map(({ datei, ziel }) => `${datei}:${ziel}`),
  };
}
