import { readFileSync } from "node:fs";

import { anteil, dauer, komma, PHASEN } from "./zeitlog.mjs";

const OHNE_DATEI = "-";
const KOPF = ["Phase", "Datei", "Dauer", "Anteil"];
const ABSTAND = 2;
const MS_JE_MINUTE = 60_000;
const STRYKERPHASEN = [
  ["sandbox", "ms_sandbox"],
  ["erstlauf", "ms_erstlauf"],
  ["mutanten", "ms_mutanten"],
];

function eintraege(datei) {
  return readFileSync(datei, "utf8")
    .split("\n")
    .filter((zeile) => zeile.trim() !== "")
    .map((zeile) => JSON.parse(zeile));
}

function summe(liste, feld) {
  return liste.reduce((gesamt, eintrag) => gesamt + (eintrag[feld] ?? 0), 0);
}

function nachArt(alle, art) {
  return alle.filter((eintrag) => eintrag.art === art);
}

function dateiZeilen(alle, datei) {
  const laeufe = nachArt(alle, "stryker").filter((eintrag) => eintrag.datei === datei);
  const loeschprobe = nachArt(alle, "loeschprobe").filter((eintrag) => eintrag.datei === datei);
  return [...STRYKERPHASEN.map(([phase, feld]) => [PHASEN[phase], datei, summe(laeufe, feld)]), [PHASEN.loeschprobe, datei, summe(loeschprobe, "ms")]];
}

function phasenzeilen(alle) {
  const dateien = [...new Set(alle.filter(({ art }) => art === "stryker" || art === "loeschprobe").map(({ datei }) => datei))];
  return [
    [PHASEN.sperre, OHNE_DATEI, summe(nachArt(alle, "sperre"), "ms")],
    [PHASEN.testauswahl, OHNE_DATEI, summe(nachArt(alle, "testauswahl"), "ms")],
    ...dateien.flatMap((datei) => dateiZeilen(alle, datei)),
  ];
}

function tabelle(reihen) {
  const breiten = KOPF.map((_kopf, spalte) => Math.max(...reihen.map((reihe) => reihe[spalte].length)));
  return reihen.map((reihe) => reihe.map((zelle, spalte) => zelle.padEnd(breiten[spalte] + ABSTAND)).join("").trimEnd());
}

function rate(alle) {
  const laeufe = nachArt(alle, "stryker");
  const mutanten = summe(laeufe, "mutanten");
  const ms = summe(laeufe, "ms_mutanten");
  const jeMinute = ms > 0 ? (mutanten * MS_JE_MINUTE) / ms : 0;
  return `Rate: ${komma(jeMinute)} Mutanten je Minute in ${laeufe.length} Stryker-Läufen (${mutanten} Mutanten in ${dauer(ms)} Mutantenzeit)`;
}

function kopfzeilen(alle, ende) {
  const [start] = nachArt(alle, "start");
  const lauf = start ? [`Lauf: Betriebsart ${start.betriebsart}, Basis ${start.basis ?? OHNE_DATEI}, Commit ${start.commit ?? OHNE_DATEI}`] : [];
  const offen = ende === undefined ? ["ohne Ende-Eintrag: abgebrochen oder noch laufend, gerechnet bis zum letzten Eintrag"] : [`Exit ${ende.exit}`];
  return [...lauf, ...offen];
}

export function logAuswertung(datei) {
  const alle = eintraege(datei);
  const [ende] = nachArt(alle, "ende");
  const gesamt = ende?.ms ?? Math.max(0, ...alle.map(({ ms_seit_start: ms }) => ms ?? 0));
  const phasen = phasenzeilen(alle);
  const gemessen = summe(phasen.map(([, , ms]) => ({ ms })), "ms");
  const reihen = [...phasen, ["übrig (Git, Bewertung, Wechsel)", OHNE_DATEI, Math.max(0, gesamt - gemessen)], ["Gesamt", OHNE_DATEI, gesamt]];
  return [
    ...kopfzeilen(alle, ende),
    ...tabelle([KOPF, ...reihen.map(([phase, ort, ms]) => [phase, ort, dauer(ms), anteil(ms, gesamt)])]),
    rate(alle),
    ...(gemessen > gesamt ? ["Hinweis: die Phasen summieren sich über die Gesamtdauer, weil Stryker-Läufe einer Welle gleichzeitig laufen."] : []),
  ];
}
