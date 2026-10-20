import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BEREICHE_DATEI } from "../tests-ausmisten/pfade.mjs";

import { TESTUMBAU, bereichSchluessel, gehoertZumBereich, istAusfuehrbarerTest, istBereichsliste, istGeschuetzt, istTestdatei } from "./format.mjs";

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
const NUR_PAARE = "ein Umbenennungs-Auftrag ändert nur seine nur-Typen-Paare aus erwarteteDateien und nachgezogene Importendungen";
const TS_ZWILLING = /(?<!\.d)\.ts$/;
const JS_ENDUNG = ".js";
export const PHASE_PASST_NICHT = "die Phasendatei passt nicht mehr zu diesem Auftrag";
export const ROLLE = {
  PRODUKT_IM_TEST: "Der Test-Agent hat Produktcode geändert",
  FREMDER_TEST: "Der Test-Agent hat einen fremden Test geändert",
  TEST_IM_BAU: "Der Bau-Agent hat einen Test geändert",
  TESTHILFE_IM_VERHALTEN: "Der Test-Agent hat eine bestehende Testhilfe geändert",
};

export function fuehreAus(name, befehl, { cwd, env, zeitlimit, eingabe }) {
  const [programm, ...args] = befehl;
  const beginn = performance.now();
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
    dauer_ms: Math.round(performance.now() - beginn),
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

export function beleg({ name, befehl, exitCode, ausgabe, dauer_ms }) {
  return { name, befehl, exitCode, dauer_ms, zeilen: entscheidendeZeilen(ausgabe) };
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

function istUmbenennungsAuftrag({ auftrag, rolle, bestand = () => true }) {
  const produkt = auftrag.erwarteteDateien.filter((pfad) => !istTestdatei(pfad));
  const zwillinge = produkt.every((pfad) => TS_ZWILLING.test(pfad) && bestand(pfad.replace(TS_ZWILLING, JS_ENDUNG)));
  return rolle === "bau" && auftrag.art === "umbau" && produkt.length > 0 && zwillinge;
}

function umbenannteDateien({ auftrag, paare = [] }) {
  const eigene = paare.filter(({ neu }) => auftrag.erwarteteDateien.includes(neu));
  return new Set(eigene.flatMap(({ alt, neu }) => [alt, neu]));
}

function imUmbenennungsBereich({ auftrag, bereichDer }, pfad, bereich) {
  if (istBereichsliste(auftrag.bereich)) return gehoertZumBereich(auftrag.bereich, pfad);
  return bereich === bereichDer(auftrag.bereich) && (bereich !== undefined || gehoertZumBereich(auftrag.bereich, pfad));
}

function umbenennungsVerstoss(kontext, pfad) {
  const { auftrag, umbenannt, bereichDer } = kontext;
  const schluessel = bereichSchluessel(auftrag.bereich);
  if (!umbenannt.has(pfad)) return `${AUSSERHALB} ${schluessel}: ${pfad}; ${NUR_PAARE}`;
  const bereich = bereichDer(pfad);
  if (imUmbenennungsBereich(kontext, pfad, bereich)) return null;
  return bereich === undefined
    ? `${AUSSERHALB} ${schluessel}: ${pfad} steht in keinem Bereich laut ${BEREICHE_DATEI}`
    : `${AUSSERHALB} ${schluessel}: ${pfad} gehört laut ${BEREICHE_DATEI} zum Bereich ${bereich}`;
}

function bereichsVerstoss(kontext, pfad) {
  const { auftrag, rolle, umbenannt } = kontext;
  if (umbenannt !== undefined) return umbenennungsVerstoss(kontext, pfad);
  return rolle === "bau" && !gehoertZumBereich(auftrag.bereich, pfad) ? `${AUSSERHALB} ${bereichSchluessel(auftrag.bereich)}: ${pfad}` : null;
}

function dateiVerstoesse(kontext, pfad) {
  const { auftrag, rolle, muster, bestand = () => true, nachgezogen = new Set() } = kontext;
  if (istGeschuetzt(muster, pfad)) return [`${VERSTOSS}${GESCHUETZT}: ${pfad}`];
  if (nachgezogen.has(pfad)) return [];
  const verstoss = rollenVerstoss({ auftrag, rolle, bestand }, pfad) ?? bereichsVerstoss(kontext, pfad);
  return verstoss ? [`${VERSTOSS}${verstoss}`] : [];
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
  const umbenannt = istUmbenennungsAuftrag(kontext) ? umbenannteDateien(kontext) : undefined;
  const verstoesse = aenderungen.flatMap(({ pfad }) => dateiVerstoesse({ ...kontext, umbenannt }, pfad));
  const nachgezogen = kontext.nachgezogen ?? new Set();
  const produkt = aenderungen.filter(({ pfad }) => !istTestdatei(pfad) && !nachgezogen.has(pfad));
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
