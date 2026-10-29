import { istTestdatei } from "./format.mjs";
import { git } from "./git.mjs";

const DIFF_ANFANG = "diff --git ";
const DIFF_KOPF = /^diff --git a\/.+ b\/(.+)$/;
const UNLESBAR = "<Dateiname nicht lesbar>";
const GANZE_DATEI = [[1, Number.MAX_SAFE_INTEGER]];
const ABSCHNITT = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;
const EINFUEGUNG = 0;
const EINE_ZEILE = 1;
const DIFF_OPTIONEN = ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--no-renames", "-U0"];

function bereichVon(beginn, anzahl) {
  return anzahl === EINFUEGUNG ? [beginn, beginn + EINE_ZEILE] : [beginn, beginn + anzahl - EINE_ZEILE];
}

function abschnittVon(zeile) {
  const abschnitt = ABSCHNITT.exec(zeile);
  if (abschnitt === null) return null;
  const anzahl = abschnitt[2] === undefined ? EINE_ZEILE : Number(abschnitt[2]);
  return { anzahl, bereich: bereichVon(Number(abschnitt[1]), anzahl) };
}

function dateiVon(kopfzeile) {
  const kopf = DIFF_KOPF.exec(kopfzeile);
  return kopf === null ? UNLESBAR : kopf[1];
}

function traegeEin({ nachDatei, datei }, zeile, einfuegungen) {
  const abschnitt = abschnittVon(zeile);
  if (abschnitt === null || datei === null || datei === UNLESBAR) return;
  if (abschnitt.anzahl !== EINFUEGUNG || einfuegungen) nachDatei.get(datei).push(abschnitt.bereich);
}

export function geaenderteBereiche(diff, { einfuegungen = true } = {}) {
  const nachDatei = new Map();
  let datei = null;
  for (const zeile of diff.split("\n")) {
    if (zeile.startsWith(DIFF_ANFANG)) {
      datei = dateiVon(zeile);
      if (!nachDatei.has(datei)) nachDatei.set(datei, datei === UNLESBAR ? GANZE_DATEI : []);
    } else {
      traegeEin({ nachDatei, datei }, zeile, einfuegungen);
    }
  }
  return nachDatei;
}

export function ueberschneiden(links, rechts) {
  return links.some(([von, bis]) => rechts.some(([andereVon, andereBis]) => von <= andereBis && andereVon <= bis));
}

export function kollisionen(eigene, fremde) {
  const befunde = [];
  for (const [datei, bereiche] of eigene) {
    const andere = fremde.get(datei);
    if (andere === undefined) continue;
    if (istTestdatei(datei)) befunde.push(`${datei}: beide ändern diese Testdatei`);
    else if (ueberschneiden(bereiche, andere)) befunde.push(`${datei}: geänderte Zeilen überschneiden sich`);
  }
  return befunde;
}

export function bereicheZwischen({ cwd, von, bis, einfuegungen }) {
  const stand = bis === undefined ? [von] : [von, bis];
  return geaenderteBereiche(git([...DIFF_OPTIONEN, ...stand], { cwd }), { einfuegungen });
}

export function kollisionenSeit({ cwd, basis, stand, commit }) {
  return kollisionen(bereicheZwischen({ cwd, von: basis, bis: commit }), bereicheZwischen({ cwd, von: basis, bis: stand }));
}
