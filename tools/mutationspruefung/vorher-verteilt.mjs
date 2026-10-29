import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { VisitorKeys } from "espree";

import { alleKnoten } from "../eslint-rules/knoten.js";
import { einstellungenFuer, gelesen } from "../syntaxbaum.mjs";
import { MATRIX_HOECHSTENS } from "./teile.mjs";
import { getoetetIn, imVorherStand } from "./testumbau.mjs";

export const SEKUNDEN_JE_KNOTEN_UND_TESTDATEI = 0.19;
export const STUECK_SEKUNDEN = 600;
export const PLANDATEI = "plan.json";
export const ERGEBNISDATEI = /\.json$/;
const QUELLDATEI = /^src\/[\w./-]+\.[cm]?[jt]s$/;
const TESTPFAD = /^test\/[\w./-]+$/;
const ELTERNORDNER = "..";
const PROGRAMM = "Program";
const MS_JE_SEKUNDE = 1000;
const BEREICH_LAENGE = 2;

function sicherePfad(pfad, muster) {
  return typeof pfad === "string" && muster.test(pfad) && !pfad.split("/").includes(ELTERNORDNER);
}

export function testsAus(text) {
  const pfade = text.split(",").map((pfad) => pfad.trim());
  const tests = [...new Set(pfade.filter(Boolean))].sort();
  const fremd = tests.filter((pfad) => !sicherePfad(pfad, TESTPFAD));
  if (tests.length === 0 || fremd.length > 0) throw new Error(`--tests verlangt Pfade unter test/, durch Komma getrennt: ${fremd.join(", ") || "leer"}`);
  return tests;
}

export function knotenIn(baum) {
  return alleKnoten({ ast: baum, visitorKeys: VisitorKeys }).filter(({ type }) => type !== PROGRAMM);
}

function knotenJeZeile(baum, zeilen) {
  const anzahl = Array.from({ length: zeilen + 1 }, () => 0);
  for (const { loc } of knotenIn(baum)) anzahl[loc.start.line] += 1;
  return anzahl;
}

function abschnitteZwischenOberstenAnweisungen(baum, zeilen) {
  const gesperrt = new Set();
  for (const { loc } of baum.body) for (let zeile = loc.start.line; zeile < loc.end.line; zeile++) gesperrt.add(zeile);
  const enden = [...Array.from({ length: zeilen - 1 }, (_leer, index) => index + 1).filter((zeile) => !gesperrt.has(zeile)), zeilen];
  return enden.map((bis, index) => [index === 0 ? 1 : enden[index - 1] + 1, bis]);
}

function packe(abschnittsliste, gewicht, grenze) {
  const stuecke = [];
  let offen = null;
  for (const [von, bis] of abschnittsliste) {
    const knoten = gewicht.slice(von, bis + 1).reduce((summe, wert) => summe + wert, 0);
    if (offen !== null && knoten > 0 && offen.knoten > 0 && offen.knoten + knoten > grenze) {
      stuecke.push(offen);
      offen = null;
    }
    offen = offen === null ? { von, bis, knoten } : { von: offen.von, bis, knoten: offen.knoten + knoten };
  }
  return [...stuecke, offen];
}

function zeilenzahl(text) {
  return text.split("\n").length;
}

export function schneide(text, baum, grenze) {
  const zeilen = zeilenzahl(text);
  if (baum === undefined) return [{ zeilen: [[1, zeilen]], knoten: null }];
  return packe(abschnitteZwischenOberstenAnweisungen(baum, zeilen), knotenJeZeile(baum, zeilen), grenze).map(({ von, bis, knoten }) => ({ zeilen: [[von, bis]], knoten }));
}

function schaetzung(knoten, testdateien) {
  return knoten === null ? null : Math.round(knoten * testdateien * SEKUNDEN_JE_KNOTEN_UND_TESTDATEI);
}

async function stueckeDerDatei(datei, { tests, grenze }) {
  const text = readFileSync(datei, "utf8");
  const baum = gelesen(text, { ...(await einstellungenFuer(datei)), loc: true });
  const stuecke = schneide(text, baum, grenze).map((stueck) => ({ datei, ...stueck, geschaetzt: schaetzung(stueck.knoten, tests.length) }));
  return { quelle: { datei, zeilen: zeilenzahl(text) }, stuecke };
}

export function vorherPlan(stand, werkzeug, stueckSekunden = STUECK_SEKUNDEN) {
  return imVorherStand(stand, werkzeug, async ({ tests, quellen }) => {
    const grenze = stueckSekunden / (SEKUNDEN_JE_KNOTEN_UND_TESTDATEI * Math.max(1, tests.length));
    const dateien = [];
    const stuecke = [];
    for (const datei of quellen) {
      const { quelle, stuecke: teile } = await stueckeDerDatei(datei, { tests, grenze });
      dateien.push(quelle);
      stuecke.push(...teile);
    }
    if (stuecke.length > MATRIX_HOECHSTENS) {
      throw new Error(`${stuecke.length} Stücke, höchstens ${MATRIX_HOECHSTENS} gehen in eine Matrix; --stueck-sekunden erhöhen`);
    }
    return { basis: stand.basis, tests: stand.tests, betroffen: tests, quellen: dateien, stuecke: stuecke.map((stueck, index) => ({ nummer: index + 1, ...stueck })) };
  });
}

function kern({ nummer, datei, zeilen }) {
  return { nummer, datei, zeilen };
}

function gueltigerBereich(bereich) {
  return Array.isArray(bereich) && bereich.length === BEREICH_LAENGE && bereich.every(Number.isInteger) && bereich[0] >= 1 && bereich[0] <= bereich[1];
}

export function stueckAus(text) {
  const stueck = JSON.parse(text);
  const zeilen = Array.isArray(stueck?.zeilen) && stueck.zeilen.length > 0 && stueck.zeilen.every(gueltigerBereich);
  if (!Number.isInteger(stueck?.nummer) || stueck.nummer < 1 || !sicherePfad(stueck.datei, QUELLDATEI) || !zeilen) {
    throw new Error("--vorher-stueck verlangt {nummer, datei unter src/, zeilen: [[von, bis]]} aus dem Plan");
  }
  return kern(stueck);
}

export function vorherStueck(stand, stueck, werkzeug) {
  return imVorherStand(stand, werkzeug, async ({ tests, quellen }) => {
    if (!quellen.includes(stueck.datei)) throw new Error(`${stueck.datei} ist im Stand ${stand.basis} keine Quelldatei der betroffenen Tests`);
    const beginn = Date.now();
    const { anzahl, getoetet } = await getoetetIn(stueck, tests, werkzeug);
    const sekunden = Math.round((Date.now() - beginn) / MS_JE_SEKUNDE);
    return { basis: stand.basis, tests: stand.tests, betroffen: tests, stueck: kern(stueck), anzahl, getoetet, sekunden };
  });
}

function nachNummer(berichte) {
  const berichtJe = new Map();
  for (const bericht of berichte) {
    const nummer = bericht.stueck?.nummer;
    if (berichtJe.has(nummer)) throw new Error(`Stück ${nummer} liegt doppelt vor`);
    berichtJe.set(nummer, bericht);
  }
  return berichtJe;
}

function lueckenlos({ quellen, stuecke }) {
  stuecke.forEach(({ datei, zeilen }, index) => {
    const vorher = stuecke[index - 1];
    const erwartet = vorher?.datei === datei ? vorher.zeilen[0][1] + 1 : 1;
    if (zeilen.length !== 1 || zeilen[0][0] !== erwartet) throw new Error(`der Plan deckt ${datei} nicht lückenlos ab (Stück ${index + 1})`);
  });
  const ende = new Map(stuecke.map(({ datei, zeilen }) => [datei, zeilen[0][1]]));
  const anfaenge = stuecke.filter(({ zeilen }) => zeilen[0][0] === 1).length;
  const offen = quellen.filter(({ datei, zeilen }) => ende.get(datei) !== zeilen).map(({ datei }) => datei);
  if (offen.length > 0 || anfaenge !== quellen.length) throw new Error(`der Plan deckt ${offen.join(", ") || "seine Quelldateien"} nicht lückenlos ab`);
}

function passtZumPlan(bericht, plan, stueck) {
  const gleich = (feld) => isDeepStrictEqual(bericht[feld], plan[feld]);
  return isDeepStrictEqual(bericht.stueck, kern(stueck)) && gleich("basis") && gleich("tests") && gleich("betroffen") && gleich("umgebung");
}

export function vereineStuecke(plan, berichte) {
  lueckenlos(plan);
  const berichtJe = nachNummer(berichte);
  const fremd = [...berichtJe.keys()].filter((nummer) => !plan.stuecke.some((stueck) => stueck.nummer === nummer));
  if (fremd.length > 0) throw new Error(`Stück ${fremd.join(", ")} steht nicht im Plan`);
  const fehlend = plan.stuecke.filter(({ nummer }) => !berichtJe.has(nummer)).map(({ nummer }) => nummer);
  if (fehlend.length > 0) throw new Error(`es fehlen die Stücke ${fehlend.join(", ")} von ${plan.stuecke.length}; die Vorher-Seite ist unvollständig`);
  const falsch = plan.stuecke.filter((stueck) => !passtZumPlan(berichtJe.get(stueck.nummer), plan, stueck)).map(({ nummer }) => nummer);
  if (falsch.length > 0) throw new Error(`Stück ${falsch.join(", ")} gehört zu einem anderen Plan`);
  const geordnet = plan.stuecke.map(({ nummer }) => berichtJe.get(nummer));
  return {
    tests: plan.betroffen,
    quellen: plan.quellen.map(({ datei }) => datei),
    getoetet: geordnet.flatMap(({ getoetet }) => getoetet),
    stuecke: geordnet.map(({ stueck, anzahl, getoetet, sekunden }) => ({ ...stueck, anzahl, getoetet: getoetet.length, sekunden })),
  };
}

export function vorherZusammen(ordner) {
  const namen = readdirSync(ordner).filter((name) => ERGEBNISDATEI.test(name));
  if (!namen.includes(PLANDATEI)) throw new Error(`${PLANDATEI} fehlt in ${ordner}`);
  const lies = (name) => JSON.parse(readFileSync(join(ordner, name), "utf8"));
  return vereineStuecke(lies(PLANDATEI), namen.filter((name) => name !== PLANDATEI).map(lies));
}

export function stueckName({ nummer, datei, zeilen }) {
  return `Stück ${nummer} (${datei}:${zeilen.map((bereich) => bereich.join("-")).join(",")})`;
}

export function planZeilen({ stuecke, betroffen }) {
  if (stuecke.length === 0) return [`Plan: die betroffenen Tests (${betroffen.length}) importieren keine Quelldatei unter src/.`];
  const geschaetzt = (stueck) => (stueck.geschaetzt === null ? "nicht lesbar, ganze Datei" : `${stueck.knoten} Knoten, geschätzt ${stueck.geschaetzt} s`);
  return [`Plan: ${stuecke.length} Stücke gegen ${betroffen.length} Testdateien`, ...stuecke.map((stueck) => `${stueckName(stueck)}: ${geschaetzt(stueck)}`)];
}

export function zusammenZeilen({ stuecke, getoetet }) {
  const gesamt = stuecke.reduce((summe, { sekunden }) => summe + sekunden, 0);
  const laengstes = stuecke.reduce((bisher, stueck) => (bisher === undefined || stueck.sekunden > bisher.sekunden ? stueck : bisher), undefined);
  const mutanten = stuecke.reduce((summe, { anzahl }) => summe + anzahl, 0);
  return [
    `- Stücke: ${stuecke.length}`,
    `- Rechenzeit aller Stücke zusammen: ${gesamt} s`,
    `- Längstes Stück: ${laengstes === undefined ? "keines" : `${stueckName(laengstes)} mit ${laengstes.sekunden} s`}`,
    `- Mutanten: ${mutanten}, davon getötet: ${getoetet.length}`,
  ];
}
