import { aufBranchGetoetet, rang } from "./entscheiden.mjs";

export const ABGEBILDET = "abgebildet";
export const GEMISCHT = "gemischt";
export const ENTFAELLT = "entfällt";
const HUNK = /^@@/;
const HUNK_KOPF = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const SCHLUESSEL = /^(.+?):(\d+):(\d+)-(\d+):(\d+) (\S+) → (.*)$/;
const LEERRAUM = /\s+/g;
const NICHT_GEMESSEN = "nicht gemessen";

function anzahl(text) {
  return text === undefined ? 1 : Number(text);
}

function hunk(zeile) {
  const treffer = HUNK_KOPF.exec(zeile);
  if (treffer === null) throw new Error(`Hunk-Kopf nicht lesbar: ${zeile}`);
  const [, altStart, altAnzahl, neuStart, neuAnzahl] = treffer;
  const [von, anfang] = [Number(altStart), Number(neuStart)];
  const [alt, neu] = [anzahl(altAnzahl), anzahl(neuAnzahl)];
  return {
    von,
    bis: von + alt - 1,
    ende: Math.max(von, von + alt - 1),
    versatz: neu - alt,
    neu: neu === 0 ? undefined : [anfang, anfang + neu - 1],
  };
}

function hunks(diff) {
  return diff
    .split("\n")
    .filter((zeile) => HUNK.test(zeile))
    .map(hunk);
}

function zeilenart(liste, zeile) {
  const getroffen = liste.find(({ von, bis }) => zeile >= von && zeile <= bis);
  if (getroffen !== undefined) return { neu: getroffen.neu };
  return {
    zeile: liste
      .filter(({ ende }) => zeile > ende)
      .reduce((summe, { versatz }) => summe + versatz, zeile),
  };
}

export function zeilenabbildung(diff) {
  const liste = hunks(diff);
  return (zeile) => zeilenart(liste, zeile).zeile;
}

export function zerlegeSchluessel(schluessel) {
  const treffer = SCHLUESSEL.exec(schluessel);
  if (treffer === null) return undefined;
  const [, datei, vonZeile, vonSpalte, bisZeile, bisSpalte, mutator, ersatz] = treffer;
  if (Number(bisZeile) < Number(vonZeile)) return undefined;
  return {
    datei,
    von: { zeile: Number(vonZeile), spalte: vonSpalte },
    bis: { zeile: Number(bisZeile), spalte: bisSpalte },
    mutator,
    ersatz,
  };
}

function normalisiert(ersatz) {
  return ersatz.replace(LEERRAUM, " ").trim();
}

function abbilden(teile, { kopf, hunks: liste }) {
  const { von, bis, mutator, ersatz } = teile;
  const arten = Array.from({ length: bis.zeile - von.zeile + 1 }, (_leer, index) =>
    zeilenart(liste, von.zeile + index),
  );
  const zeilen = arten.map(({ zeile }) => zeile).filter((nummer) => nummer !== undefined);
  const geaendert = [...new Set(arten.map(({ neu }) => neu).filter(Boolean))];
  const [anfang, ende] = [zeilen[0], zeilen.at(-1)];
  if (zeilen.length === arten.length && ende - anfang === bis.zeile - von.zeile) {
    const ort = `${anfang}:${von.spalte}-${ende}:${bis.spalte}`;
    return { art: ABGEBILDET, schluessel: `${kopf}:${ort} ${mutator} → ${ersatz}` };
  }
  if (zeilen.length === 0 && geaendert.length === 0) return { art: ENTFAELLT };
  const grenzen = [...zeilen, ...geaendert.flat()];
  const bereich = [Math.min(...grenzen), Math.max(...grenzen)];
  return { art: GEMISCHT, datei: kopf, mutator, ersatz, zeilen, geaendert, bereich };
}

export function bildeMutant(schluessel, { kopf, diff }) {
  const teile = zerlegeSchluessel(schluessel);
  if (teile === undefined) throw new Error(`Schlüssel nicht lesbar: ${schluessel}`);
  return abbilden(teile, { kopf, hunks: hunks(diff) });
}

export function dateiAbbildung({ datei, geloescht, umbenannt, diff }) {
  const paar = umbenannt.find(({ alt }) => alt === datei);
  if (paar?.nurTypen) return { kopf: paar.neu, diff };
  if (paar !== undefined) return { umbenannt: paar.neu };
  if (geloescht.has(datei)) return { geloescht: true };
  return { kopf: datei, diff };
}

function vorbereitet(abbildung) {
  return new Map(
    Object.entries(abbildung).map(([datei, eintrag]) => [
      datei,
      typeof eintrag.diff === "string" ? { ...eintrag, hunks: hunks(eintrag.diff) } : eintrag,
    ]),
  );
}

function ohneAbbildung(schluessel, teile, eintrag) {
  if (teile === undefined) return `Schlüssel nicht lesbar: ${schluessel}`;
  if (eintrag === undefined) return `Keine Zeilenabbildung für ${teile.datei}: ${schluessel}`;
  if (eintrag.umbenannt !== undefined)
    return `Quelldatei umbenannt ohne Abbildung (${teile.datei} → ${eintrag.umbenannt}): ${schluessel}`;
  if (eintrag.geloescht) return undefined;
  if (eintrag.hunks === undefined) return `Keine Zeilenabbildung für ${teile.datei}: ${schluessel}`;
  return undefined;
}

export function bildeAlle({ basis, abbildung }) {
  const dateien = vorbereitet(abbildung);
  const ergebnis = { abgebildet: [], gemischt: [], entfallen: [], gruende: [] };
  for (const schluessel of Object.keys(basis).filter((name) => rang(basis[name]) > 0)) {
    const teile = zerlegeSchluessel(schluessel);
    const eintrag = teile === undefined ? undefined : dateien.get(teile.datei);
    const grund = ohneAbbildung(schluessel, teile, eintrag);
    if (grund !== undefined) ergebnis.gruende.push(grund);
    else if (eintrag.geloescht) ergebnis.entfallen.push(schluessel);
    else einordnen(ergebnis, schluessel, abbilden(teile, eintrag));
  }
  return ergebnis;
}

function einordnen(ergebnis, schluessel, abgebildet) {
  if (abgebildet.art === ENTFAELLT) ergebnis.entfallen.push(schluessel);
  else if (abgebildet.art === GEMISCHT)
    ergebnis.gemischt.push({ ...abgebildet, basis: schluessel });
  else ergebnis.abgebildet.push({ basis: schluessel, kopf: abgebildet.schluessel });
}

function passt(teile, { datei, mutator, ersatz, zeilen, geaendert, bereich }) {
  if (teile === undefined || teile.datei !== datei || teile.mutator !== mutator) return false;
  if (normalisiert(teile.ersatz) !== normalisiert(ersatz)) return false;
  const [von, bis] = [teile.von.zeile, teile.bis.zeile];
  return (
    von >= bereich[0] &&
    bis <= bereich[1] &&
    zeilen.every((zeile) => zeile >= von && zeile <= bis) &&
    geaendert.every(([anfang, ende]) => anfang <= bis && ende >= von)
  );
}

function ungedeckt(gemischt, gegenstuecke) {
  const belegt = new Map();
  const zuordnen = (index, besucht) =>
    gegenstuecke[index].some((schluessel) => {
      if (besucht.has(schluessel)) return false;
      besucht.add(schluessel);
      const frueher = belegt.get(schluessel);
      if (frueher !== undefined && !zuordnen(frueher, besucht)) return false;
      belegt.set(schluessel, index);
      return true;
    });
  return gemischt.filter((_mutant, index) => !zuordnen(index, new Set()));
}

function gemischteGruende(gemischt, { basis, kopf, belegt }) {
  const kandidaten = Object.keys(kopf)
    .filter((schluessel) => !belegt.has(schluessel))
    .map((schluessel) => ({ schluessel, teile: zerlegeSchluessel(schluessel) }));
  const gegenstuecke = gemischt.map((mutant) =>
    kandidaten
      .filter(
        ({ schluessel, teile }) =>
          passt(teile, mutant) && aufBranchGetoetet(kopf[schluessel], basis[mutant.basis]),
      )
      .map(({ schluessel }) => schluessel),
  );
  return ungedeckt(gemischt, gegenstuecke).map(
    ({ basis: schluessel, mutator, bereich }) =>
      `Gemischter Mutant ohne eigenes getötetes Gegenstück im Kopf (${mutator}, Zeilen ${bereich.join("-")}): ${schluessel}`,
  );
}

export function entscheideTotcode({ basis, kopf, abbildung }) {
  const { abgebildet, gemischt, entfallen, gruende } = bildeAlle({ basis, abbildung });
  const verloren = abgebildet
    .filter(({ basis: alt, kopf: neu }) => !aufBranchGetoetet(kopf[neu], basis[alt]))
    .map(
      ({ basis: alt, kopf: neu }) =>
        `Mutant im Kopf nicht getötet (${kopf[neu] ?? NICHT_GEMESSEN}): ${alt} → ${neu}`,
    );
  const belegt = new Set(abgebildet.map(({ kopf: neu }) => neu));
  const alle = [...gruende, ...verloren, ...gemischteGruende(gemischt, { basis, kopf, belegt })];
  return {
    gruen: alle.length === 0,
    gruende: alle,
    abgebildet: abgebildet.length,
    gemischt: gemischt.length,
    entfallen: entfallen.length,
  };
}
