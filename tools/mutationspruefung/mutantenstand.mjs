import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { cwd } from "node:process";

import { git } from "../auftrag/git.mjs";
import { PFADE_AUS_DEM_NEUEN_STAND, mitInhalt, verfolgteDateien, werkzeugStand } from "./vorher-speicher.mjs";

const CODEDATEI = /\.[cm]?[jt]s$/;
const DATENORDNER = ["src/", "test/"];
const EINSTELLUNGEN = [".github/workflows/ci.yml", ".github/actions"];
const DATEINAME = /[\w.-]+\.[A-Za-z\d]+/g;

export function hashVon(wert) {
  return createHash("sha256").update(JSON.stringify(wert)).digest("hex");
}

function grundlage({ seite, wurzel }, hier, alle) {
  const werkzeug = werkzeugStand(wurzel);
  const einstellungen = mitInhalt(wurzel, verfolgteDateien(wurzel, EINSTELLUNGEN));
  const daten = mitInhalt(hier, alle.filter((pfad) => !CODEDATEI.test(pfad) && DATENORDNER.some((ordner) => pfad.startsWith(ordner))));
  const teile = [...einstellungen, ...daten];
  if (werkzeug === null || teile.some(([, hash]) => hash === null)) return null;
  return hashVon({ seite, werkzeug, einstellungen, daten });
}

function baumEintraege(commit, pfade) {
  return git(["ls-tree", "-r", "-z", commit, "--", ...pfade]).split("\0").filter(Boolean);
}

export function grundlageImBaum(commit) {
  const werkzeug = baumEintraege(commit, [...PFADE_AUS_DEM_NEUEN_STAND, ...EINSTELLUNGEN]);
  const daten = baumEintraege(commit, DATENORDNER).filter((zeile) => !CODEDATEI.test(zeile.slice(zeile.indexOf("\t") + 1)));
  return [...new Set([...werkzeug, ...daten])].sort();
}

function nachName(pfade) {
  const karte = new Map();
  for (const pfad of pfade) karte.set(basename(pfad), [...(karte.get(basename(pfad)) ?? []), pfad]);
  return karte;
}

function huelle(wurzeln, vorwaerts, bekannt) {
  const erreicht = new Set(wurzeln);
  for (const pfad of erreicht) {
    for (const ziel of vorwaerts.get(pfad) ?? []) if (bekannt.has(ziel)) erreicht.add(ziel);
  }
  return [...erreicht];
}

function genannteDaten(pfad, namen) {
  const text = readFileSync(pfad, "utf8");
  return [...new Set(text.match(DATEINAME) ?? [])].flatMap((name) => namen.get(name) ?? []);
}

export function standRechner({ seite, wurzel, vorwaerts }) {
  const hier = cwd();
  const alle = verfolgteDateien(hier, ["."]);
  const grund = grundlage({ seite, wurzel }, hier, alle);
  if (grund === null) return () => null;
  const bekannt = new Set(alle);
  const namen = nachName(alle);
  const genannt = new Map();
  const daten = (pfad) => {
    if (!genannt.has(pfad)) genannt.set(pfad, bekannt.has(pfad) ? genannteDaten(pfad, namen) : []);
    return genannt.get(pfad);
  };
  const fertig = new Map();
  return (datei, toeter) => {
    const wurzeln = [...new Set([datei, ...toeter])].sort();
    const schluessel = JSON.stringify(wurzeln);
    if (!fertig.has(schluessel)) {
      const code = huelle(wurzeln, vorwaerts, bekannt);
      const dateien = mitInhalt(hier, [...new Set([...code, ...code.flatMap(daten)])].sort());
      fertig.set(schluessel, dateien.some(([, hash]) => hash === null) ? null : hashVon({ grund, dateien }));
    }
    return fertig.get(schluessel);
  };
}
