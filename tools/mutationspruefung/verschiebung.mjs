import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ESLint } from "eslint";
import { VisitorKeys } from "espree";

import { istAusfuehrbarerTest, istTestdatei } from "../auftrag/format.mjs";
import { git } from "../auftrag/git.mjs";
import { alleKnoten } from "../eslint-rules/knoten.js";
import { einstellungenFuer, gelesen } from "../syntaxbaum.mjs";
import { TEST_FILE } from "../testgraph.mjs";
import { GEAENDERT, GELOESCHT, HINZUGEFUEGT, QUELLKNOTEN, RELATIVE_QUELLE, aenderungen, liestEigenenPfad, umschreibbareQuelle } from "../umbenennung.mjs";

const ARTEN = new Set([GELOESCHT, HINZUGEFUEGT, GEAENDERT]);
const CODEDATEI = /\.[cm]?[jt]sx?$/;
const VERZEICHNIS = "__dirname";
const ERFORDERN = "require";

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
