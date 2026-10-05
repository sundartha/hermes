import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { testaufrufe } from "./aufrufe.mjs";
import { git, inBasis } from "./git.mjs";
import { UNTER_ATTRAPPE, testlauf } from "./testlauf.mjs";

const ABSCHNITT = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const STANDARDLAENGE = 1;
const BASISORDNER = "testwirkung-basis-";
const MODULE = "node_modules";

function zeilenbereich(start, laenge) {
  const anzahl = laenge === undefined ? STANDARDLAENGE : Number(laenge);
  return Array.from({ length: anzahl }, (_leer, index) => Number(start) + index);
}

function geaenderteZeilen(basis, datei) {
  const diff = git(["diff", "--no-renames", "--no-color", "--no-ext-diff", "-U0", basis, "--", datei]);
  const abschnitte = diff.split("\n").flatMap((zeile) => {
    const treffer = ABSCHNITT.exec(zeile);
    return treffer === null ? [] : [treffer];
  });
  return {
    alt: abschnitte.flatMap(([, start, laenge]) => zeilenbereich(start, laenge)),
    neu: abschnitte.flatMap(([, , , start, laenge]) => zeilenbereich(start, laenge)),
  };
}

function innersterTest(aufrufe, zeile) {
  const umfassend = aufrufe.filter(({ von, bis }) => von <= zeile && zeile <= bis);
  const spanne = ({ von, bis }) => bis - von;
  return umfassend.reduce((enger, aufruf) => (enger === undefined || spanne(aufruf) <= spanne(enger) ? aufruf : enger), undefined);
}

function betroffeneTests({ alt, neu }, zeilen) {
  const treffer = [
    ...zeilen.alt.map((zeile) => innersterTest(alt, zeile)),
    ...zeilen.neu.map((zeile) => innersterTest(neu, zeile)),
  ];
  const vorher = new Set(alt.map(({ bezeichnung }) => bezeichnung));
  const inBeiden = [...new Set(neu.map(({ bezeichnung }) => bezeichnung))].filter((bezeichnung) => vorher.has(bezeichnung));
  if (treffer.includes(undefined)) return inBeiden;
  const getroffen = new Set(treffer.map(({ bezeichnung }) => bezeichnung));
  return inBeiden.filter((bezeichnung) => getroffen.has(bezeichnung));
}

export function geaenderteBestehendeTests(basis, dateien) {
  return dateien.flatMap((datei) => {
    const vorher = inBasis(basis, datei);
    if (vorher === undefined) return [];
    const aufrufe = { alt: testaufrufe(datei, vorher), neu: testaufrufe(datei, readFileSync(datei, "utf8")) };
    return betroffeneTests(aufrufe, geaenderteZeilen(basis, datei)).map((bezeichnung) => ({
      datei,
      kennung: `${datei} › ${bezeichnung}`,
      alt: aufrufe.alt.filter((aufruf) => aufruf.bezeichnung === bezeichnung),
      neu: aufrufe.neu.filter((aufruf) => aufruf.bezeichnung === bezeichnung),
    }));
  });
}

function stelle({ datei, zeile, spalte }) {
  return `${datei}:${zeile}:${spalte}`;
}

function unterAttrappe(tests, seite, verzeichnis) {
  const dateien = [...new Set(tests.map(({ datei }) => datei))];
  const muster = [...new Set(tests.flatMap((test) => test[seite].flatMap((aufruf) => aufruf.muster)))];
  const nachStelle = new Map(
    tests.flatMap((test) => test[seite].map((aufruf) => [stelle({ datei: test.datei, ...aufruf }), test.kennung])),
  );
  const jeTest = new Map(tests.map(({ kennung }) => [kennung, []]));
  for (const ergebnis of testlauf({ dateien, muster, vorspann: UNTER_ATTRAPPE, verzeichnis })) {
    jeTest.get(nachStelle.get(stelle(ergebnis)))?.push(ergebnis.bestanden);
  }
  return jeTest;
}

function basisArbeitsbaum(basis) {
  const verzeichnis = realpathSync(mkdtempSync(join(tmpdir(), BASISORDNER)));
  git(["worktree", "add", "--detach", "-q", verzeichnis, basis]);
  if (existsSync(MODULE)) symlinkSync(resolve(MODULE), join(verzeichnis, MODULE));
  return verzeichnis;
}

function imBasisstand(basis, tests) {
  const verzeichnis = basisArbeitsbaum(basis);
  try {
    return unterAttrappe(tests, "alt", verzeichnis);
  } finally {
    git(["worktree", "remove", "--force", verzeichnis]);
    rmSync(verzeichnis, { recursive: true, force: true });
  }
}

function ohneWirkung(ergebnisse) {
  return ergebnisse.length === 0 || ergebnisse.includes(true);
}

function befund(kennung, { vorher, nachher }) {
  const warWirksam = !ohneWirkung(vorher.get(kennung));
  const laeuftNoch = nachher.get(kennung).length > 0;
  if (!warWirksam) return vorher.get(kennung).length > 0 ? { hinweis: `Test prüfte schon auf der Basis nichts: ${kennung}` } : {};
  return { verstoss: laeuftNoch ? `Test prüft nach der Änderung nichts mehr: ${kennung}` : `Test läuft nach der Änderung nicht mehr: ${kennung}` };
}

export function pruefeGeaenderte(basis, tests) {
  const ergebnis = { geprueft: tests.length, verstoesse: [], hinweise: [] };
  if (tests.length === 0) return ergebnis;
  const nachher = unterAttrappe(tests, "neu");
  const verdaechtig = tests.filter(({ kennung }) => ohneWirkung(nachher.get(kennung)));
  if (verdaechtig.length === 0) return ergebnis;
  const vorher = imBasisstand(basis, verdaechtig);
  const befunde = verdaechtig.map(({ kennung }) => befund(kennung, { vorher, nachher }));
  return {
    ...ergebnis,
    verstoesse: befunde.flatMap(({ verstoss }) => verstoss ?? []),
    hinweise: befunde.flatMap(({ hinweis }) => hinweis ?? []),
  };
}
