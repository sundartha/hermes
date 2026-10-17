import { existsSync } from "node:fs";

import { runde, zeilenAus } from "./ausklingen.mjs";

const MS_JE_SEKUNDE = 1000;
const NACHKOMMASTELLEN = 2;

export const TABELLENKOPF = [
  "| Datei | Gesamt (s) | Prozessstart und Laden (s) | Tests (s) | Datenbank (Anzahl / s) | Server (Anzahl / s) | Ausklingen (s) | echtWarten |",
  "|---|---|---|---|---|---|---|---|",
];

export function sekunden(ms) {
  return ms === null || ms === undefined ? "–" : (ms / MS_JE_SEKUNDE).toFixed(NACHKOMMASTELLEN);
}

export function kostenJeDatei(kostenDatei) {
  const kosten = new Map();
  if (!kostenDatei || !existsSync(kostenDatei)) return kosten;
  for (const { datei, art, anzahl, summe } of zeilenAus(kostenDatei)) {
    const eintrag = kosten.get(datei) ?? {};
    const bisher = eintrag[art] ?? { anzahl: 0, summe: 0 };
    kosten.set(datei, {
      ...eintrag,
      [art]: { anzahl: bisher.anzahl + anzahl, summe: bisher.summe + summe },
    });
  }
  return kosten;
}

function starts(eintrag) {
  return { anzahl: eintrag?.anzahl ?? 0, ms: runde(eintrag?.summe ?? 0) };
}

function prozessstart(dauer, kind) {
  if (dauer === null || dauer === undefined || kind === null || kind === undefined) return null;
  return runde(Math.max(0, dauer - kind));
}

export function aufteilung(zeile, kosten) {
  return {
    gesamt_ms: zeile.dauer_ms ?? null,
    prozessstart_ms: prozessstart(zeile.dauer_ms, zeile.kind_ms),
    tests_ms: zeile.tests_ms ?? null,
    datenbank: starts(kosten?.datenbankStarts),
    server: starts(kosten?.serverStarts),
    ausklingen_ms: zeile.ausklingen_ms ?? null,
  };
}

function startText({ anzahl, ms }) {
  return `${anzahl} / ${sekunden(ms)}`;
}

export function tabellenZeile(zeile, kosten) {
  const teile = aufteilung(zeile, kosten);
  const warten = kosten?.echtWarten;
  const echt = warten ? `${warten.anzahl}× / ${warten.summe} ms` : "–";
  return `| ${zeile.datei} | ${sekunden(teile.gesamt_ms)} | ${sekunden(teile.prozessstart_ms)} | ${sekunden(teile.tests_ms)} | ${startText(teile.datenbank)} | ${startText(teile.server)} | ${sekunden(teile.ausklingen_ms)} | ${echt} |`;
}
