import { lstatSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join, posix } from "node:path";

import { ESLint } from "eslint";
import { VisitorKeys } from "espree";

import { alleKnoten } from "../eslint-rules/knoten.js";
import { einstellungenFuer, gelesen } from "../syntaxbaum.mjs";
import { INDEX, javascriptPfad, laufzeitBaum, nurQuellenNachgezogen, quellenAngeglichen, umbenennungen, umschreibbareQuelle } from "../umbenennung.mjs";

import { NUL, aenderungenSeit, git, vormerken } from "./git.mjs";

const QUELLDATEI = /\.[cm]?[jt]s$/;
const DOKUMENT = /\.md$/i;
const BINAER = 0;
const PFADZEICHEN = /^[\w.-]$/;
const EXIT_GRUEN = 0;
const GRUND = {
  symlink: "der .ts-Zwilling ist ein Symlink",
  verweis: "nennt die alte Datei noch außerhalb eines umschreibbaren Imports",
  unlesbar: "lässt sich nicht lesen, ein Verweis auf die alte Datei ist nicht auszuschließen",
};

function nurTypenPaare(paare) {
  return paare.filter(({ nurTypen }) => nurTypen);
}

function nenntPfad(text, pfad) {
  for (let stelle = text.indexOf(pfad); stelle !== -1; stelle = text.indexOf(pfad, stelle + 1)) {
    const [davor, danach] = [text[stelle - 1] ?? "", text[stelle + pfad.length] ?? ""];
    if (!PFADZEICHEN.test(davor) && !PFADZEICHEN.test(danach)) return true;
  }
  return false;
}

function zeichenkette(knoten) {
  if (knoten.type === "Literal" && typeof knoten.value === "string") return knoten.value;
  return knoten.type === "TemplateElement" ? (knoten.value.cooked ?? undefined) : undefined;
}

function zeigtAuf(wert, datei, alt) {
  return nenntPfad(wert, alt) || posix.join(posix.dirname(datei), wert) === alt;
}

function jsonTexte(text) {
  const texte = [];
  try {
    JSON.parse(text, (schluessel, wert) => {
      texte.push(schluessel, ...(typeof wert === "string" ? [wert] : []));
      return wert;
    });
  } catch {
    return [];
  }
  return texte;
}

function textNennt({ datei, text, alte }) {
  const werte = jsonTexte(text);
  return alte.filter((alt) => nenntPfad(text, alt) || werte.some((wert) => zeigtAuf(wert, datei, alt)));
}

function transformiert(text) {
  try {
    return stripTypeScriptTypes(text, { mode: "transform" });
  } catch {
    return undefined;
  }
}

async function verweisBaum({ datei, text }, eslint) {
  const baum = await laufzeitBaum({ pfad: datei, text }, eslint);
  const javascript = javascriptPfad(datei);
  if (baum !== undefined || javascript === datei) return { baum, umschreibbar: true };
  const laufzeit = transformiert(text);
  return { baum: laufzeit === undefined ? undefined : gelesen(laufzeit, await einstellungenFuer(javascript, eslint)), umschreibbar: false };
}

async function genannteAlte({ datei, text, alte }, { eslint, ohneUmschreibbare }) {
  if (!QUELLDATEI.test(datei)) return { genannt: textNennt({ datei, text, alte }), grund: GRUND.verweis };
  const { baum, umschreibbar } = await verweisBaum({ datei, text }, eslint);
  if (baum === undefined) return { genannt: alte, grund: GRUND.unlesbar };
  const knoten = alleKnoten({ ast: baum, visitorKeys: VisitorKeys });
  const ausgenommen = new Set(ohneUmschreibbare && umschreibbar ? knoten.map(umschreibbareQuelle).filter(Boolean) : []);
  const werte = knoten.filter((eintrag) => !ausgenommen.has(eintrag)).map(zeichenkette).filter((wert) => wert !== undefined);
  return { genannt: alte.filter((alt) => werte.some((wert) => zeigtAuf(wert, datei, alt))), grund: GRUND.verweis };
}

function istSymlinkOderFehlt(root, pfad) {
  const art = lstatSync(join(root, pfad), { throwIfNoEntry: false });
  return art === undefined || art.isSymbolicLink();
}

function repoDateien(root) {
  return git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root }).split(NUL);
}

function quelldateien(root) {
  return repoDateien(root).filter((pfad) => QUELLDATEI.test(pfad));
}

function lesbarerText(root, datei) {
  if (statSync(join(root, datei), { throwIfNoEntry: false })?.isFile() !== true) return undefined;
  const inhalt = readFileSync(join(root, datei));
  return inhalt.includes(BINAER) ? undefined : inhalt.toString("utf8");
}

async function verweisePruefen(paare, { root, eslint, ohneUmschreibbare }) {
  const offen = new Map(nurTypenPaare(paare).map((paar) => [paar.alt, paar]));
  for (const datei of repoDateien(root).filter((pfad) => pfad !== "" && !DOKUMENT.test(pfad))) {
    const text = offen.size === 0 ? undefined : lesbarerText(root, datei);
    if (text === undefined) continue;
    const { genannt, grund } = await genannteAlte({ datei, text, alte: [...offen.keys()] }, { eslint, ohneUmschreibbare });
    for (const alt of genannt) {
      Object.assign(offen.get(alt), { nurTypen: false, grund: `${datei} ${grund}` });
      offen.delete(alt);
    }
  }
}

async function gepruefteUmbenennungen({ von, bis, root, ohneUmschreibbare }, eslint) {
  const paare = (await umbenennungen({ von, bis }, eslint)).paare.map((paar) => ({ ...paar }));
  for (const paar of nurTypenPaare(paare)) {
    if (istSymlinkOderFehlt(root, paar.neu)) Object.assign(paar, { nurTypen: false, grund: GRUND.symlink });
  }
  await verweisePruefen(paare, { root, eslint, ohneUmschreibbare });
  return paare;
}

function hinweise(paare) {
  return paare.filter(({ nurTypen }) => !nurTypen).map(({ alt, neu, grund }) => `Hinweis: ${alt} → ${neu} zählt nicht als nur Typen: ${grund}`);
}

async function zieheNach(datei, { root, neuFuer, namen, eslint }) {
  const text = readFileSync(join(root, datei), "utf8");
  if (!namen.some((name) => text.includes(name))) return false;
  const neu = await quellenAngeglichen({ pfad: datei, text }, neuFuer, eslint);
  if (neu === undefined) return false;
  writeFileSync(join(root, datei), neu);
  return true;
}

export async function importendungenNachziehen({ basis, root }, eslint = new ESLint()) {
  vormerken(aenderungenSeit(basis, root).map(({ pfad }) => pfad), root);
  const alle = await gepruefteUmbenennungen({ von: basis, bis: INDEX, root, ohneUmschreibbare: true }, eslint);
  const paare = nurTypenPaare(alle);
  const kontext = { root, neuFuer: new Map(paare.map(({ alt, neu }) => [alt, neu])), namen: paare.map(({ alt }) => posix.basename(alt)), eslint };
  const nachgezogen = [];
  for (const datei of paare.length > 0 ? quelldateien(root) : []) {
    if (await zieheNach(datei, kontext)) nachgezogen.push(datei);
  }
  vormerken(nachgezogen, root);
  return { nachgezogen, hinweise: hinweise(alle) };
}

export async function nurTypenNachgezogen({ basis, root }, pfade, eslint = new ESLint()) {
  const alle = await gepruefteUmbenennungen({ von: basis, root, ohneUmschreibbare: false }, eslint);
  const paare = nurTypenPaare(alle);
  const nachgezogen = new Set();
  for (const pfad of paare.length > 0 ? pfade : []) {
    if (await nurQuellenNachgezogen(pfad, { von: basis, paare, eslint })) nachgezogen.add(pfad);
  }
  return { paare, nachgezogen, hinweise: hinweise(alle) };
}

export async function importendungen({ basis, root }) {
  const { nachgezogen, hinweise: zeilen } = await importendungenNachziehen({ basis, root });
  for (const zeile of [...nachgezogen, ...zeilen]) console.log(zeile);
  console.log(`grün: ${nachgezogen.length} Dateien auf die neue Endung nachgezogen.`);
  return EXIT_GRUEN;
}
