import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { git } from "../auftrag/git.mjs";
import { GEAENDERT, HINZUGEFUEGT, aenderungen } from "../umbenennung.mjs";
import { auslagerungAus } from "./verschiebung.mjs";

const QUELLDATEI = /^src\/.+\.[cm]?js$/;
const GEPRUEFT = /^(src|test)\//;
const VERKNUEPFUNG = "120000 ";

function beteiligte({ von, bis }, root) {
  const nachArt = aenderungen(von, bis, root);
  const geprueft = (pfade) => [...pfade].filter((pfad) => GEPRUEFT.test(pfad)).sort();
  const alle = geprueft(Object.values(nachArt).flatMap((pfade) => [...pfade]));
  const [angepasst, neue] = [geprueft(nachArt[GEAENDERT] ?? []), geprueft(nachArt[HINZUGEFUEGT] ?? [])];
  const passend = angepasst.length === 1 && neue.length > 0 && alle.length === 1 + neue.length && alle.every((pfad) => QUELLDATEI.test(pfad));
  return passend ? { hilfe: angepasst[0], neue } : null;
}

function istVerknuepfung(pfad, { bis, root }) {
  if (bis === undefined) return lstatSync(join(root, pfad)).isSymbolicLink();
  return git(["ls-tree", bis, "--", pfad], { cwd: root }).startsWith(VERKNUEPFUNG);
}

function leser(bis, root) {
  if (bis === undefined) return (pfad) => readFileSync(join(root, pfad), "utf8");
  return (pfad) => git(["show", `${bis}:${pfad}`], { cwd: root });
}

export async function reineQuellauslagerung({ von, bis }, root) {
  const beteiligt = beteiligte({ von, bis }, root);
  if (beteiligt === null || [beteiligt.hilfe, ...beteiligt.neue].some((pfad) => istVerknuepfung(pfad, { bis, root }))) return null;
  const vorher = git(["show", `${von}:${beteiligt.hilfe}`], { cwd: root });
  return auslagerungAus({ ...beteiligt, vorher, lesen: leser(bis, root) }, { root, weiterreichen: true });
}

export function quellauslagerungsZeile({ hilfe, neue, anweisungen }) {
  return `reine Auslagerung: keine Mutanten nötig (aus ${hilfe} nach ${neue.join(", ")}: ${anweisungen} Anweisungen). Grund: Die Anweisungen sind Wort für Wort verschoben, wirken beim Laden nicht und werden unter gleichem Namen weitergereicht; jeder Test führt denselben Code aus.`;
}
