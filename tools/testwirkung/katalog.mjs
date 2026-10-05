import { existsSync, readFileSync } from "node:fs";

import { TESTDATEI, testaufrufe } from "./aufrufe.mjs";
import { inBasis, treffer } from "./git.mjs";

const KATALOG = "docs/sicherheitsgrenzen.md";
const OHNE_TEST = "tools/basis/katalog-ohne-test.txt";
const TESTORDNER = "test/";
const TABELLENZEILE = /^\|(.*)\|\s*$/;
const KENNUNG = /^SG-\d{2,}$/;
const KENNUNG_AM_ANFANG = /^(SG-\d{2,})(?!\d)/;

const ARBEITSBAUM = {
  text: (pfad) => (existsSync(pfad) ? readFileSync(pfad, "utf8") : ""),
  grep: (muster) => treffer(["-l", "-z", "-F", ...muster, "--", TESTORDNER]).split("\0"),
};

function basisstand(basis) {
  const praefix = `${basis}:`;
  return {
    text: (pfad) => inBasis(basis, pfad) ?? "",
    grep: (muster) => {
      const dateien = treffer(["-l", "-z", "-F", ...muster, basis, "--", TESTORDNER]).split("\0");
      return dateien.map((eintrag) => eintrag.slice(praefix.length));
    },
  };
}

function zellenDer(zeile) {
  const tabellenzeile = TABELLENZEILE.exec(zeile.trim());
  return tabellenzeile === null ? [] : [tabellenzeile[1].split("|").map((zelle) => zelle.trim())];
}

function katalogzeilen(text) {
  const zellen = text.split("\n").flatMap(zellenDer);
  return zellen.filter(([kennung]) => KENNUNG.test(kennung)).map((zeile) => ({ kennung: zeile[0], negativtest: zeile.at(-1) }));
}

function kennungIm(name, kennungen) {
  const kennung = KENNUNG_AM_ANFANG.exec(name ?? "")?.[1];
  return kennungen.has(kennung) ? kennung : undefined;
}

function katalogtestsIm(stand) {
  const zeilen = katalogzeilen(stand.text(KATALOG));
  const kennungen = new Set(zeilen.map(({ kennung }) => kennung));
  if (kennungen.size === 0) return { zeilen, tests: [] };
  const dateien = stand.grep([...kennungen].flatMap((kennung) => ["-e", kennung])).filter((datei) => TESTDATEI.test(datei));
  const tests = dateien.flatMap((datei) =>
    testaufrufe(datei, stand.text(datei)).flatMap(({ name, vorfahren }) => {
      const kennung = kennungIm(name, kennungen);
      return kennung === undefined ? [] : [{ datei, name, vorfahren, kennung }];
    }),
  );
  return { zeilen, tests };
}

function anzahlJeKennung(tests) {
  const anzahl = new Map();
  for (const { kennung } of tests) anzahl.set(kennung, (anzahl.get(kennung) ?? 0) + 1);
  return anzahl;
}

function ohneNegativtest({ zeilen, tests }) {
  const namen = new Set(tests.map(({ name }) => name));
  const nochOhneTest = new Set(ARBEITSBAUM.text(OHNE_TEST).split("\n").map((zeile) => zeile.trim()));
  return zeilen
    .filter(({ kennung, negativtest }) => !namen.has(negativtest) && !nochOhneTest.has(kennung))
    .map(({ kennung, negativtest }) => `Katalogtest nicht gefunden: ${kennung} › ${negativtest}`);
}

function geloest(vorher, nachher) {
  const jetzt = anzahlJeKennung(nachher);
  return [...anzahlJeKennung(vorher)]
    .filter(([kennung, anzahl]) => (jetzt.get(kennung) ?? 0) < anzahl)
    .map(([kennung, anzahl]) => `Katalogtests gelöst: ${kennung} hat auf der Basis ${anzahl} Tests, jetzt ${jetzt.get(kennung) ?? 0}`);
}

export function katalogtests(basis) {
  const jetzt = katalogtestsIm(ARBEITSBAUM);
  const vorher = katalogtestsIm(basisstand(basis));
  return { tests: jetzt.tests, verstoesse: [...ohneNegativtest(jetzt), ...geloest(vorher.tests, jetzt.tests)] };
}
