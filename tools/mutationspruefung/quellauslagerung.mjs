import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { git } from "../auftrag/git.mjs";
import { GEAENDERT, HINZUGEFUEGT, aenderungen } from "../umbenennung.mjs";
import { auslagerungAus } from "./verschiebung.mjs";

const QUELLDATEI = /^src\/.+\.[cm]?js$/;
const GEPRUEFT = /^(src|test)\//;
const VERKNUEPFUNG = "120000 ";
const PAAR = 2;

function betroffene({ von, bis }, root) {
  const nachArt = aenderungen(von, bis, root);
  const geprueft = (pfade) => [...pfade].filter((pfad) => GEPRUEFT.test(pfad)).sort();
  const alle = geprueft(Object.values(nachArt).flatMap((pfade) => [...pfade]));
  return { alle, angepasst: geprueft(nachArt[GEAENDERT] ?? []), neue: geprueft(nachArt[HINZUGEFUEGT] ?? []) };
}

function beteiligte(pruefung, root) {
  const { alle, angepasst, neue } = betroffene(pruefung, root);
  if (!alle.every((pfad) => QUELLDATEI.test(pfad))) return [];
  if (angepasst.length === 1 && neue.length > 0 && alle.length === 1 + neue.length) return [{ hilfe: angepasst[0], neue, bestehend: null }];
  const anhaengen = angepasst.length === PAAR && alle.length === PAAR;
  return anhaengen ? angepasst.map((hilfe) => ({ hilfe, neue: [], bestehend: angepasst.find((pfad) => pfad !== hilfe) })) : [];
}

function istVerknuepfung(pfad, { bis, root }) {
  if (bis === undefined) return lstatSync(join(root, pfad)).isSymbolicLink();
  return git(["ls-tree", bis, "--", pfad], { cwd: root }).startsWith(VERKNUEPFUNG);
}

function leser(bis, root) {
  if (bis === undefined) return (pfad) => readFileSync(join(root, pfad), "utf8");
  return (pfad) => git(["show", `${bis}:${pfad}`], { cwd: root });
}

export function zieldateien({ neue, bestehend }) {
  return bestehend === null ? neue : [...neue, bestehend];
}

async function auslagerungVon(beteiligt, { von, bis, root }) {
  if ([beteiligt.hilfe, ...zieldateien(beteiligt)].some((pfad) => istVerknuepfung(pfad, { bis, root }))) return null;
  const vorher = (pfad) => git(["show", `${von}:${pfad}`], { cwd: root });
  const bestehend = beteiligt.bestehend === null ? null : { pfad: beteiligt.bestehend, vorher: vorher(beteiligt.bestehend) };
  return auslagerungAus({ ...beteiligt, bestehend, vorher: vorher(beteiligt.hilfe), lesen: leser(bis, root) }, { root, weiterreichen: true });
}

export async function reineQuellauslagerung({ von, bis }, root) {
  for (const beteiligt of beteiligte({ von, bis }, root)) {
    const auslagerung = await auslagerungVon(beteiligt, { von, bis, root });
    if (auslagerung !== null) return auslagerung;
  }
  return null;
}

export function auslagerungsZiele({ neue, bestehend }) {
  return [...neue, ...(bestehend === null ? [] : [`${bestehend} (bestehende Datei, angehängt)`])].join(", ");
}

export function quellauslagerungsZeile({ hilfe, anweisungen, ...ziele }) {
  return `reine Auslagerung: keine Mutanten nötig (aus ${hilfe} nach ${auslagerungsZiele(ziele)}: ${anweisungen} Anweisungen). Grund: Die Anweisungen sind Wort für Wort verschoben, wirken beim Laden nicht und werden unter gleichem Namen weitergereicht; jeder Test führt denselben Code aus.`;
}
