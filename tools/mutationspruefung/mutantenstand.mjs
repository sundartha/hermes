import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { cwd } from "node:process";

import { werkzeugStand } from "./vorher-speicher.mjs";

const MAX_GIT_AUSGABE = 268_435_456;
const NUL = "\0";
const CODEDATEI = /\.[cm]?[jt]s$/;
const DATENORDNER = ["src/", "test/"];
const EINSTELLUNGEN = [".github/workflows/ci.yml", ".github/actions"];
const DATEINAME = /[\w.-]+\.[A-Za-z\d]+/g;
const FEHLT = "fehlt";

function hashVon(wert) {
  return createHash("sha256").update(JSON.stringify(wert)).digest("hex");
}

function verfolgte(wurzel, pfade) {
  const liste = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...pfade], { cwd: wurzel, encoding: "utf8", maxBuffer: MAX_GIT_AUSGABE });
  return [...new Set(liste.split(NUL).filter(Boolean))].sort();
}

function inhaltsHash(datei) {
  const art = lstatSync(datei, { throwIfNoEntry: false });
  if (art === undefined) return FEHLT;
  return art.isFile() ? createHash("sha256").update(readFileSync(datei)).digest("hex") : null;
}

function mitInhalt(wurzel, pfade) {
  return pfade.map((pfad) => [pfad, inhaltsHash(join(wurzel, pfad))]);
}

function grundlage({ seite, wurzel }, hier, alle) {
  const werkzeug = werkzeugStand(wurzel);
  const einstellungen = mitInhalt(wurzel, verfolgte(wurzel, EINSTELLUNGEN));
  const daten = mitInhalt(hier, alle.filter((pfad) => !CODEDATEI.test(pfad) && DATENORDNER.some((ordner) => pfad.startsWith(ordner))));
  const teile = [...einstellungen, ...daten];
  if (werkzeug === null || teile.some(([, hash]) => hash === null)) return null;
  return hashVon({ seite, werkzeug, einstellungen, daten });
}

function nachName(pfade) {
  const karte = new Map();
  for (const pfad of pfade.filter((eintrag) => !CODEDATEI.test(eintrag))) karte.set(basename(pfad), [...(karte.get(basename(pfad)) ?? []), pfad]);
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
  const alle = verfolgte(hier, ["."]);
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
