import { spawnSync } from "node:child_process";

import { gehoertZumBereich, istGeschuetzt, istTestdatei } from "./format.mjs";

export const MAX_PRODUKTZEILEN = 400;
export const MAX_TESTAUSGABE_ZEILEN = 60;
const MAX_BELEGZEILEN = 20;
const MAX_SCHLUSSZEILEN = 5;
const BYTES_JE_MEBIBYTE = 1_048_576;
const MAX_AUSGABE_MEBIBYTE = 64;
const EXIT_OHNE_STATUS = 1;
const ENTSCHEIDEND = [
  /^# (tests|pass|fail|cancelled|skipped|todo) /,
  /^\s*not ok /,
  /^\s*error: /,
  /^✗ /,
  /\d+ bestanden, \d+ rot/,
  /\d+:\d+\s+error\s/,
  /✖ \d+ problems?/,
  /^(grün|rot|Verstoß|Hinweis|Abweichung)[: ]/,
];
const TITELZEILE = /^\s*(✗ |not ok\b|ok\b|# Subtest:)/;

export function fuehreAus(name, befehl, { cwd, env, zeitlimit, eingabe }) {
  const [programm, ...args] = befehl;
  const lauf = spawnSync(programm, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: zeitlimit,
    input: eingabe,
    maxBuffer: MAX_AUSGABE_MEBIBYTE * BYTES_JE_MEBIBYTE,
  });
  const fehler = lauf.error ? `${programm} ließ sich nicht ausführen: ${lauf.error.message}` : "";
  return {
    name,
    befehl: befehl.join(" "),
    exitCode: lauf.status ?? EXIT_OHNE_STATUS,
    ausgabe: [lauf.stdout, lauf.stderr, fehler].filter(Boolean).join("\n"),
  };
}

function nichtLeer(text) {
  return text.split("\n").filter((zeile) => zeile.trim() !== "");
}

export function entscheidendeZeilen(ausgabe) {
  const zeilen = nichtLeer(ausgabe);
  const treffer = zeilen.filter((zeile) => ENTSCHEIDEND.some((muster) => muster.test(zeile)));
  const auswahl = treffer.length > 0 ? treffer : zeilen.slice(-MAX_SCHLUSSZEILEN);
  return auswahl.slice(0, MAX_BELEGZEILEN);
}

export function beleg({ name, befehl, exitCode, ausgabe }) {
  return { name, befehl, exitCode, zeilen: entscheidendeZeilen(ausgabe) };
}

export function gekuerzteTestausgabe(ausgabe) {
  return nichtLeer(ausgabe).slice(0, MAX_TESTAUSGABE_ZEILEN).join("\n");
}

export function rotUrteil({ exitCode, ausgabe }, erwarteterFehler) {
  if (exitCode === 0) return { rot: false, zeile: "rot: nein, der Abnahmetest ist grün." };
  const meldungen = ausgabe.split("\n").filter((zeile) => !TITELZEILE.test(zeile));
  if (meldungen.some((zeile) => zeile.includes(erwarteterFehler))) {
    return { rot: true, zeile: `rot: ja, mit dem erwarteten Fehler „${erwarteterFehler}“.` };
  }
  return {
    rot: false,
    zeile: `rot: ja, aber nicht mit dem erwarteten Fehler „${erwarteterFehler}“.`,
  };
}

function testVerstoss(auftrag, pfad) {
  if (!istTestdatei(pfad)) return `Der Test-Agent hat Produktcode geändert: ${pfad}`;
  const eigene = [auftrag.abnahme, ...auftrag.erwarteteDateien];
  return eigene.includes(pfad) ? null : `Der Test-Agent hat einen fremden Test geändert: ${pfad}`;
}

function rollenVerstoss(auftrag, rolle, pfad) {
  if (rolle === "test") return testVerstoss(auftrag, pfad);
  return istTestdatei(pfad) ? `Der Bau-Agent hat einen Test geändert: ${pfad}` : null;
}

function dateiVerstoesse({ auftrag, rolle, muster }, pfad) {
  if (istGeschuetzt(muster, pfad)) return [`Verstoß: geschützte Datei geändert: ${pfad}`];
  const verstoss = rollenVerstoss(auftrag, rolle, pfad);
  if (verstoss) return [`Verstoß: ${verstoss}`];
  if (rolle === "bau" && !gehoertZumBereich(auftrag.bereich, pfad)) {
    return [`Verstoß: außerhalb des Bereichs ${auftrag.bereich}: ${pfad}`];
  }
  return [];
}

function abweichungen(auftrag, geaendert) {
  const erwartet = auftrag.erwarteteDateien.filter((pfad) => !istTestdatei(pfad));
  const unerwartet = geaendert.filter((pfad) => !erwartet.includes(pfad));
  const unveraendert = erwartet.filter((pfad) => !geaendert.includes(pfad));
  return [
    ...unerwartet.map((pfad) => `Abweichung: geändert, aber nicht erwartet: ${pfad}`),
    ...unveraendert.map((pfad) => `Abweichung: erwartet, aber unverändert: ${pfad}`),
  ];
}

export function grenzBefunde(kontext, aenderungen) {
  const verstoesse = aenderungen.flatMap(({ pfad }) => dateiVerstoesse(kontext, pfad));
  const produkt = aenderungen.filter(({ pfad }) => !istTestdatei(pfad));
  const produktzeilen = produkt.reduce((summe, { zeilen }) => summe + zeilen, 0);
  if (produktzeilen > MAX_PRODUKTZEILEN) {
    verstoesse.push(
      `Verstoß: ${produktzeilen} Zeilen Produktcode geändert, erlaubt sind ${MAX_PRODUKTZEILEN}.`,
    );
  }
  const hinweise =
    kontext.rolle === "bau" ? abweichungen(kontext.auftrag, produkt.map(({ pfad }) => pfad)) : [];
  return { verstoesse, hinweise, produktzeilen };
}
