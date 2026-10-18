import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TESTUMBAU, gehoertZumBereich, istAusfuehrbarerTest, istGeschuetzt, istTestdatei } from "./format.mjs";

export const MAX_PRODUKTZEILEN = 400;
export const MAX_TESTAUSGABE_ZEILEN = 60;
const MAX_BELEGZEILEN = 20;
const MAX_SCHLUSSZEILEN = 5;
const BYTES_JE_MEBIBYTE = 1_048_576;
const MAX_AUSGABE_MEBIBYTE = 64;
const EXIT_OHNE_STATUS = 1;
const MAX_AUSGABEDATEI_MEBIBYTE = 4;
export const MAX_AUSGABEDATEI_BYTES = MAX_AUSGABEDATEI_MEBIBYTE * BYTES_JE_MEBIBYTE;
const AUSGABE_ENDUNG = ".log";
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
export const VERSTOSS = "Verstoß: ";
export const GESCHUETZT = "geschützte Datei geändert";
export const AUSSERHALB = "außerhalb des Bereichs";
export const ZU_VIELE_ZEILEN = "neue Zeilen Produktcode";
export const PHASE_PASST_NICHT = "die Phasendatei passt nicht mehr zu diesem Auftrag";
export const ROLLE = {
  PRODUKT_IM_TEST: "Der Test-Agent hat Produktcode geändert",
  FREMDER_TEST: "Der Test-Agent hat einen fremden Test geändert",
  TEST_IM_BAU: "Der Bau-Agent hat einen Test geändert",
  TESTHILFE_IM_VERHALTEN: "Der Test-Agent hat eine bestehende Testhilfe geändert",
};

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

export function vollerBeleg(ergebnis) {
  return { ...beleg(ergebnis), zeilen: nichtLeer(ergebnis.ausgabe).slice(0, MAX_BELEGZEILEN) };
}

function begrenzteAusgabe(ausgabe) {
  const bytes = Buffer.from(ausgabe);
  if (bytes.length <= MAX_AUSGABEDATEI_BYTES) return ausgabe;
  return `[${bytes.length - MAX_AUSGABEDATEI_BYTES} Bytes vom Anfang weggelassen]\n${bytes.subarray(-MAX_AUSGABEDATEI_BYTES).toString("utf8")}`;
}

export function legeAusgabeAb(eintrag, { exitCode, ausgabe }, { ordner, stamm }) {
  if (exitCode === 0) return eintrag;
  mkdirSync(ordner, { recursive: true });
  const datei = `${stamm}${AUSGABE_ENDUNG}`;
  writeFileSync(join(ordner, datei), `${begrenzteAusgabe(ausgabe)}\n`);
  return { ...eintrag, ausgabeDatei: datei };
}

export function gekuerzteTestausgabe(ausgabe) {
  return nichtLeer(ausgabe).slice(0, MAX_TESTAUSGABE_ZEILEN).join("\n");
}

export function rotUrteil({ exitCode, ausgabe, fehlermeldungen = [] }, erwarteterFehler) {
  if (exitCode === 0) return { rot: false, zeile: "rot: nein, der Abnahmetest ist grün." };
  const zeilen = ausgabe.split("\n").filter((zeile) => !TITELZEILE.test(zeile));
  const meldungen = [...zeilen, ...fehlermeldungen];
  if (meldungen.some((zeile) => zeile.includes(erwarteterFehler))) {
    return { rot: true, zeile: `rot: ja, mit dem erwarteten Fehler „${erwarteterFehler}“.` };
  }
  return {
    rot: false,
    zeile: `rot: ja, aber nicht mit dem erwarteten Fehler „${erwarteterFehler}“.`,
  };
}

function testVerstoss({ auftrag, bestand }, pfad) {
  if (!istTestdatei(pfad)) return `${ROLLE.PRODUKT_IM_TEST}: ${pfad}`;
  const eigene = auftrag.art === TESTUMBAU ? auftrag.erwarteteDateien : [auftrag.abnahme, ...auftrag.erwarteteDateien];
  if (!eigene.includes(pfad)) return `${ROLLE.FREMDER_TEST}: ${pfad}`;
  const hilfe = !istAusfuehrbarerTest(pfad) && bestand(pfad);
  return hilfe && auftrag.art !== TESTUMBAU ? `${ROLLE.TESTHILFE_IM_VERHALTEN}: ${pfad}; Testhilfen ändert nur ein ${TESTUMBAU}` : null;
}

function rollenVerstoss({ auftrag, rolle, bestand }, pfad) {
  if (rolle === "test") return testVerstoss({ auftrag, bestand }, pfad);
  return istTestdatei(pfad) ? `${ROLLE.TEST_IM_BAU}: ${pfad}` : null;
}

function dateiVerstoesse({ auftrag, rolle, muster, bestand = () => true }, pfad) {
  if (istGeschuetzt(muster, pfad)) return [`${VERSTOSS}${GESCHUETZT}: ${pfad}`];
  const verstoss = rollenVerstoss({ auftrag, rolle, bestand }, pfad);
  if (verstoss) return [`${VERSTOSS}${verstoss}`];
  if (rolle === "bau" && !gehoertZumBereich(auftrag.bereich, pfad)) {
    return [`${VERSTOSS}${AUSSERHALB} ${auftrag.bereich}: ${pfad}`];
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
      `${VERSTOSS}${produktzeilen} ${ZU_VIELE_ZEILEN}, erlaubt sind ${MAX_PRODUKTZEILEN}.`,
    );
  }
  const hinweise =
    kontext.rolle === "bau" ? abweichungen(kontext.auftrag, produkt.map(({ pfad }) => pfad)) : [];
  return { verstoesse, hinweise, produktzeilen };
}
