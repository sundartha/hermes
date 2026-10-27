import { lstatSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ESLint } from "eslint";
import { VisitorKeys } from "espree";

import { istAusfuehrbarerTest, istTestdatei } from "../auftrag/format.mjs";
import { git } from "../auftrag/git.mjs";
import { alleKnoten } from "../eslint-rules/knoten.js";
import { einstellungenFuer, gelesen, gleicherBaum } from "../syntaxbaum.mjs";
import { TEST_FILE } from "../testgraph.mjs";
import { besucheSyntaxbaum } from "../ziele/funktionen.mjs";
import { GEAENDERT, GELOESCHT, HINZUGEFUEGT, QUELLKNOTEN, RELATIVE_QUELLE, aenderungen, liestEigenenPfad, umschreibbareQuelle } from "../umbenennung.mjs";

const ARTEN = new Set([GELOESCHT, HINZUGEFUEGT, GEAENDERT]);
const CODEDATEI = /\.[cm]?[jt]sx?$/;
const VERZEICHNIS = "__dirname";
const ERFORDERN = "require";
const IMPORT = "ImportDeclaration";
const OHNE_WIRKUNG = new Set(["Literal", "ArrowFunctionExpression", "FunctionExpression"]);
const WEITERREICHUNG = new Set(["ExportAllDeclaration", "ExportNamedDeclaration"]);
const GLEICHNAMIG = new Set(["ImportSpecifier", "ExportSpecifier"]);
const EINFRIEREN = { objekt: "Object", methode: "freeze" };

function laeuftAlsTest(pfad) {
  return istAusfuehrbarerTest(pfad) || TEST_FILE.test(pfad);
}

function nurTesthilfenUndTests(basis, root) {
  const nachArt = aenderungen(basis, undefined, root);
  const pfade = Object.values(nachArt).flatMap((menge) => [...menge]);
  if (pfade.length === 0 || !Object.keys(nachArt).every((art) => ARTEN.has(art)) || !pfade.every(istTestdatei)) return null;
  const sortiert = (art) => [...(nachArt[art] ?? [])].sort();
  return { geloescht: sortiert(GELOESCHT), hinzugefuegt: sortiert(HINZUGEFUEGT), angepasst: sortiert(GEAENDERT) };
}

function tiefe(pfad) {
  return pfad.split("/").length;
}

function verschiebbar(alt, neu) {
  return tiefe(neu) === tiefe(alt) && !laeuftAlsTest(alt) && !laeuftAlsTest(neu);
}

function paare({ geloescht, hinzugefuegt }, { basis, root }) {
  const neuNachInhalt = Map.groupBy(hinzugefuegt, (pfad) => git(["hash-object", "--", pfad], { cwd: root }).trim());
  const gepaart = geloescht.map((alt) => {
    const kandidaten = neuNachInhalt.get(git(["rev-parse", `${basis}:${alt}`], { cwd: root }).trim()) ?? [];
    return kandidaten.length === 1 && verschiebbar(alt, kandidaten[0]) ? { alt, neu: kandidaten[0] } : null;
  });
  const eindeutig = gepaart.every(Boolean) && new Set(gepaart.map(({ neu }) => neu)).size === gepaart.length;
  const vollstaendig = gepaart.length > 0 && gepaart.length === hinzugefuegt.length && eindeutig;
  return vollstaendig ? gepaart : null;
}

function knoten(baum) {
  return alleKnoten({ ast: baum, visitorKeys: VisitorKeys });
}

function istQuelle(eintrag) {
  return QUELLKNOTEN.has(eintrag.type) && eintrag.source !== null;
}

function istErfordern({ type, callee }) {
  return type === "CallExpression" && callee.type === "Identifier" && callee.name === ERFORDERN;
}

function istBezeichner({ type, name }, gesucht) {
  return type === "Identifier" && name === gesucht;
}

function quelleDerVerschobenen(eintrag) {
  if (istQuelle(eintrag)) return umschreibbareQuelle(eintrag) ?? null;
  const [argument] = eintrag.arguments;
  return argument?.type === "Literal" && typeof argument.value === "string" ? argument : null;
}

function pfadeDerVerschobenen(baum) {
  if (liestEigenenPfad(baum)) return null;
  const alle = knoten(baum);
  const aufgerufen = new Set(alle.filter(istErfordern).map(({ callee }) => callee));
  const pfade = [];
  for (const eintrag of alle) {
    if (istBezeichner(eintrag, VERZEICHNIS) || (istBezeichner(eintrag, ERFORDERN) && !aufgerufen.has(eintrag))) return null;
    if (!istQuelle(eintrag) && !istErfordern(eintrag)) continue;
    const quelle = quelleDerVerschobenen(eintrag);
    if (quelle === null) return null;
    pfade.push(quelle.value);
  }
  return pfade;
}

function ziel(datei, pfad) {
  return posix.join(posix.dirname(datei), pfad);
}

async function baumIm(text, pfad, eslint) {
  return gelesen(text, await einstellungenFuer(pfad, eslint));
}

async function zeigtGleichWeiter({ alt, neu }, { root, neuFuer, eslint }) {
  if (!CODEDATEI.test(neu)) return true;
  const baum = await baumIm(readFileSync(join(root, neu), "utf8"), join(root, neu), eslint);
  const pfade = baum === undefined ? null : pfadeDerVerschobenen(baum);
  if (pfade === null) return false;
  return pfade.filter((pfad) => RELATIVE_QUELLE.test(pfad)).every((pfad) => ziel(neu, pfad) === (neuFuer.get(ziel(alt, pfad)) ?? ziel(alt, pfad)));
}

function zerlegt(text, baum) {
  const quellen = [];
  for (const eintrag of knoten(baum)) {
    const quelle = istQuelle(eintrag) ? umschreibbareQuelle(eintrag) : undefined;
    if (quelle !== undefined) quellen.push(quelle);
  }
  quellen.sort((links, rechts) => links.range[0] - rechts.range[0]);
  const gerippe = [];
  let bis = 0;
  for (const { range } of quellen) {
    gerippe.push(text.slice(bis, range[0]));
    bis = range[1];
  }
  return { gerippe: [...gerippe, text.slice(bis)], pfade: quellen.map(({ value }) => value) };
}

function zeigtAufVerschobene(datei, [vorher, nachher], neuFuer) {
  return RELATIVE_QUELLE.test(vorher) && RELATIVE_QUELLE.test(nachher) && neuFuer.get(ziel(datei, vorher)) === ziel(datei, nachher);
}

async function nurImportpfade(datei, { basis, root, neuFuer, eslint }) {
  if (!CODEDATEI.test(datei)) return false;
  const [vorher, nachher] = [git(["show", `${basis}:${datei}`], { cwd: root }), readFileSync(join(root, datei), "utf8")];
  const [alterBaum, neuerBaum] = [await baumIm(vorher, join(root, datei), eslint), await baumIm(nachher, join(root, datei), eslint)];
  if (alterBaum === undefined || neuerBaum === undefined) return false;
  const [alt, neu] = [zerlegt(vorher, alterBaum), zerlegt(nachher, neuerBaum)];
  if (!isDeepStrictEqual(alt.gerippe, neu.gerippe)) return false;
  const geaendert = alt.pfade.map((pfad, index) => [pfad, neu.pfade[index]]).filter(([links, rechts]) => links !== rechts);
  return geaendert.length > 0 && geaendert.every((paar) => zeigtAufVerschobene(datei, paar, neuFuer));
}

async function alleWahr(eintraege, pruefung) {
  for (const eintrag of eintraege) if (!(await pruefung(eintrag))) return false;
  return true;
}

async function nurVerschobenUndNachgezogen(verschoben, angepasst, stand) {
  return (await alleWahr(verschoben, (paar) => zeigtGleichWeiter(paar, stand))) && (await alleWahr(angepasst, (datei) => nurImportpfade(datei, stand)));
}

export async function reineVerschiebung(basis, root) {
  const aenderung = nurTesthilfenUndTests(basis, root);
  const verschoben = aenderung === null ? null : paare(aenderung, { basis, root });
  if (verschoben === null) return null;
  const stand = { basis, root, neuFuer: new Map(verschoben.map(({ alt, neu }) => [alt, neu])), eslint: new ESLint({ cwd: root }) };
  return (await nurVerschobenUndNachgezogen(verschoben, aenderung.angepasst, stand)) ? { verschoben, angepasst: aenderung.angepasst } : null;
}

export function verschiebungsZeile({ verschoben, angepasst }) {
  const dateien = verschoben.map(({ alt, neu }) => `${alt} → ${neu}`).join(", ");
  return `reine Verschiebung: keine Testumbau-Mutation (Dateien ${dateien}; nur Importpfade nachgezogen in ${angepasst.join(", ") || "keiner weiteren Datei"}). Grund: gleicher Inhalt in gleicher Verzeichnistiefe, sonst ändern sich nur Importpfade auf die verschobenen Dateien; eine Verschiebung kann keinen Test schwächen.`;
}

function auslagerbar({ geloescht, angepasst, hinzugefuegt }, root) {
  const beteiligt = [...angepasst, ...hinzugefuegt];
  return geloescht.length === 0 && angepasst.length === 1 && hinzugefuegt.length > 0 && beteiligt.every((pfad) => !laeuftAlsTest(pfad) && !lstatSync(join(root, pfad)).isSymbolicLink());
}

async function gelesenAlle(texte, { root, eslint }) {
  const dateien = [];
  for (const { pfad, text } of texte) {
    const baum = await baumIm(text, join(root, pfad), eslint);
    if (baum === undefined) return null;
    dateien.push({ pfad, text, baum });
  }
  return dateien;
}

function istImport({ type }) {
  return type === IMPORT;
}

function zielDer(datei, quelle) {
  return RELATIVE_QUELLE.test(quelle) ? ziel(datei, quelle) : quelle;
}

function name(bezeichner) {
  return bezeichner.name ?? bezeichner.value;
}

function ohneUmbenennung({ type, exported, specifiers }) {
  if (type === "ExportAllDeclaration") return exported === null;
  return specifiers.every((eintrag) => GLEICHNAMIG.has(eintrag.type) && name(eintrag.imported ?? eintrag.exported) === name(eintrag.local));
}

function holtAusNeuer(datei, anweisung, neue) {
  const quelle = umschreibbareQuelle(anweisung);
  return quelle !== undefined && neue.includes(zielDer(datei, quelle.value)) && ohneUmbenennung(anweisung);
}

function istWeiterreichung(datei, anweisung, neue) {
  return WEITERREICHUNG.has(anweisung.type) && holtAusNeuer(datei, anweisung, neue);
}

function verteilt(folge, ziele) {
  const zeiger = ziele.map(() => 0);
  for (const anweisung of folge) {
    const index = ziele.findIndex((liste, stelle) => zeiger[stelle] < liste.length && gleicherBaum(liste[zeiger[stelle]], anweisung));
    if (index === -1) return false;
    zeiger[index] += 1;
  }
  return ziele.every((liste, stelle) => zeiger[stelle] === liste.length);
}

function istEingefroren({ type, callee, arguments: argumente }) {
  const freeze = type === "CallExpression" && callee.type === "MemberExpression" && !callee.computed && istBezeichner(callee.object, EINFRIEREN.objekt) && istBezeichner(callee.property, EINFRIEREN.methode);
  return freeze && argumente.length === 1 && wirktNichtBeimLaden(argumente[0]);
}

function wirktNichtBeimLaden(ausdruck) {
  if (OHNE_WIRKUNG.has(ausdruck.type)) return true;
  if (ausdruck.type === "ArrayExpression") return ausdruck.elements.every((element) => element !== null && wirktNichtBeimLaden(element));
  if (ausdruck.type === "ObjectExpression") return ausdruck.properties.every((eigenschaft) => eigenschaft.type === "Property" && !eigenschaft.computed && wirktNichtBeimLaden(eigenschaft.value));
  return istEingefroren(ausdruck);
}

function istDeklarationOhneWirkung(anweisung) {
  const deklaration = anweisung.type === "ExportNamedDeclaration" ? anweisung.declaration : anweisung;
  if (deklaration?.type === "FunctionDeclaration") return true;
  return deklaration?.type === "VariableDeclaration" && deklaration.kind === "const" && deklaration.declarations.every(({ id, init }) => id.type === "Identifier" && wirktNichtBeimLaden(init));
}

function ortsfest(baum) {
  return !liestEigenenPfad(baum) && !knoten(baum).some((eintrag) => eintrag.type === "ImportExpression" || istBezeichner(eintrag, VERZEICHNIS) || istBezeichner(eintrag, ERFORDERN));
}

function importeVon({ body }) {
  return body.filter(istImport);
}

function bindungen(datei, baum) {
  return importeVon(baum).flatMap(({ source, specifiers }) =>
    specifiers.map(({ type, imported, local }) => JSON.stringify([zielDer(datei, source.value), type, imported?.name ?? imported?.value ?? null, local.name])),
  );
}

function importeAusVorher(vorher, { pfad, baum }) {
  const gebunden = new Set(bindungen(vorher.pfad, vorher.baum));
  return importeVon(baum).every(({ specifiers }) => specifiers.length > 0) && bindungen(pfad, baum).every((bindung) => gebunden.has(bindung));
}

function zieleVon({ pfad, baum }) {
  return importeVon(baum).map(({ source }) => zielDer(pfad, source.value));
}

function laedtAlleNeuen({ pfad, baum }, neue) {
  return neue.every((neu) => baum.body.some((anweisung) => holtAusNeuer(pfad, anweisung, [neu])));
}

function nichtsFaelltWeg(vorher, nachher, neue) {
  const geladen = new Set([nachher, ...neue].flatMap(zieleVon));
  return laedtAlleNeuen(nachher, neue.map(({ pfad }) => pfad)) && zieleVon(vorher).every((datei) => geladen.has(datei));
}

function importeDerHilfe(vorher, nachher, neue) {
  const alte = importeVon(vorher.baum);
  return importeVon(nachher.baum).every((anweisung) => holtAusNeuer(nachher.pfad, anweisung, neue) || alte.some((alt) => gleicherBaum(alt, anweisung)));
}

function namenDerDeklaration(deklaration) {
  if (deklaration?.type === "FunctionDeclaration") return [deklaration.id.name];
  return (deklaration?.declarations ?? []).filter(({ id }) => id.type === "Identifier").map(({ id }) => id.name);
}

function alleWeitergereichten(datei, { source, exported }, exporteDerNeuen) {
  if (exported !== null) return [name(exported)];
  const weitergereicht = exporteDerNeuen.get(zielDer(datei, source.value)) ?? [`* ${source.value}`];
  return [...weitergereicht].filter((eintrag) => eintrag !== "default");
}

const EXPORTE = new Map([
  ["ExportDefaultDeclaration", () => ["default"]],
  ["ExportNamedDeclaration", (datei, { specifiers, declaration }) => [...specifiers.map(({ exported }) => name(exported)), ...namenDerDeklaration(declaration)]],
  ["ExportAllDeclaration", alleWeitergereichten],
]);

function exportNamen(datei, baum, exporteDerNeuen = new Map()) {
  return new Set(baum.body.flatMap((anweisung) => EXPORTE.get(anweisung.type)?.(datei, anweisung, exporteDerNeuen) ?? []));
}

function geltungsbereich({ pfad, text }) {
  const bereich = { namen: new Set(), frei: new Set() };
  besucheSyntaxbaum(pfad, text, (context) => ({
    "Program:exit": (programm) => {
      const global = context.sourceCode.getScope(programm);
      const oben = global.childScopes.find(({ type }) => type === "module") ?? global;
      for (const { name } of oben.variables) bereich.namen.add(name);
      for (const { identifier } of global.through) bereich.frei.add(identifier.name);
    },
  }));
  return bereich;
}

function ohneVerlorenenNamen(vorher, danach) {
  const { namen } = geltungsbereich(vorher);
  return danach.every((datei) => ![...geltungsbereich(datei).frei].some((name) => namen.has(name)));
}

function verschobeneAnweisungen(vorher, nachher, neue) {
  const neuePfade = neue.map(({ pfad }) => pfad);
  const bleibt = nachher.baum.body.filter((anweisung) => !istImport(anweisung) && !istWeiterreichung(nachher.pfad, anweisung, neuePfade));
  const ausgelagert = neue.map(({ baum }) => baum.body.filter((anweisung) => !istImport(anweisung)));
  return verteilt(vorher.baum.body.filter((anweisung) => !istImport(anweisung)), [bleibt, ...ausgelagert]) ? ausgelagert.flat() : null;
}

function gleicheExporte(vorher, nachher, neue) {
  const exporteDerNeuen = new Map(neue.map(({ pfad, baum }) => [pfad, exportNamen(pfad, baum)]));
  return isDeepStrictEqual(exportNamen(vorher.pfad, vorher.baum), exportNamen(nachher.pfad, nachher.baum, exporteDerNeuen));
}

function ausgelagerteAnweisungen([vorher, nachher, ...neue]) {
  const neuePfade = neue.map(({ pfad }) => pfad);
  const verschoben = verschobeneAnweisungen(vorher, nachher, neue);
  if (verschoben === null || !verschoben.every(istDeklarationOhneWirkung) || !neue.every(({ baum }) => ortsfest(baum))) return null;
  const gleicherGraph = neue.every((datei) => importeAusVorher(vorher, datei)) && importeDerHilfe(vorher, nachher, neuePfade) && nichtsFaelltWeg(vorher, nachher, neue);
  return gleicherGraph && gleicheExporte(vorher, nachher, neue) && ohneVerlorenenNamen(vorher, [nachher, ...neue]) ? verschoben.length : null;
}

export async function reineAuslagerung(basis, root) {
  const aenderung = nurTesthilfenUndTests(basis, root);
  if (aenderung === null || !auslagerbar(aenderung, root)) return null;
  const [hilfe] = aenderung.angepasst;
  const texte = [
    { pfad: hilfe, text: git(["show", `${basis}:${hilfe}`], { cwd: root }) },
    ...[hilfe, ...aenderung.hinzugefuegt].map((pfad) => ({ pfad, text: readFileSync(join(root, pfad), "utf8") })),
  ];
  const gelesen = await gelesenAlle(texte, { root, eslint: new ESLint({ cwd: root }) });
  const anweisungen = gelesen === null ? null : ausgelagerteAnweisungen(gelesen);
  return anweisungen === null ? null : { hilfe, neue: aenderung.hinzugefuegt, anweisungen };
}

export function auslagerungsZeile({ hilfe, neue, anweisungen }) {
  return `reine Auslagerung: keine Testumbau-Mutation (aus ${hilfe} nach ${neue.join(", ")}: ${anweisungen} Anweisungen; alle Tests laden dieselben Quelldateien). Grund: Die Anweisungen sind Wort für Wort verschoben, wirken beim Laden nicht und werden unter gleichem Namen weitergereicht; jeder Test führt denselben Code aus und lädt dieselben Dateien unter src/.`;
}
