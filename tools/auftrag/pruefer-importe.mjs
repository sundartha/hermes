import { posix } from "node:path";

import { gitAusgabe } from "./pruefer-auswahl.mjs";

export const DATEI_MODI = new Set(["100644", "100755"]);
const KB = 1024;
const MAX_DATEIEN = 40;
const MAX_BYTES = 409_600;
const MAX_DATEI_BYTES = 65_536;
const BAUM_EINTRAG = /^(\d{6}) blob ([0-9a-f]+) +(\d+)\t(.+)$/s;
const QUELLE = /\.(?:[cm]?js|ts)$/;
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])(\.{1,2}\/[^"'\n]*)\1/g;
const ENDUNGEN = ["", ".js", ".mjs", ".ts", "/index.js", "/index.mjs", "/index.ts"];
const PAKETE = "node_modules";

function baumEintrag(eintrag) {
  const treffer = BAUM_EINTRAG.exec(eintrag);
  if (treffer === null || !DATEI_MODI.has(treffer[1])) return [];
  const [, , objekt, groesse, pfad] = treffer;
  return [{ objekt, groesse: Number(groesse), pfad }];
}

export function dateienImBaum(sha, root) {
  return gitAusgabe(["ls-tree", "-r", "-l", "-z", sha], root).split("\0").flatMap(baumEintrag);
}

function baumDes(sha, root) {
  return new Map(dateienImBaum(sha, root).map(({ pfad, groesse }) => [pfad, groesse]));
}

function imRepo(von, ziel) {
  const pfad = posix.normalize(posix.join(posix.dirname(von), ziel));
  const segmente = pfad.split("/");
  if (segmente[0] === ".." || segmente.includes(PAKETE)) return null;
  return pfad;
}

function zieleDer(pfad, inhalt, baum) {
  return [...inhalt.toString("utf8").matchAll(IMPORT)].flatMap(([, , ziel]) => {
    const basis = imRepo(pfad, ziel);
    if (basis === null) return [];
    const treffer = ENDUNGEN.map((endung) => `${basis}${endung}`).find((kandidat) => baum.has(kandidat));
    return treffer === undefined ? [] : [treffer];
  });
}

function grundFuer(groesse, { anzahl, bytes }) {
  if (groesse > MAX_DATEI_BYTES) return `größer als ${MAX_DATEI_BYTES / KB} KB`;
  if (anzahl >= MAX_DATEIEN) return `mehr als ${MAX_DATEIEN} Dateien`;
  if (bytes + groesse > MAX_BYTES) return `zusammen mehr als ${MAX_BYTES / KB} KB`;
  return null;
}

function nachGrenze(pfade, baum) {
  const stand = { anzahl: 0, bytes: 0 };
  return pfade.map((pfad) => {
    const groesse = baum.get(pfad);
    const grund = grundFuer(groesse, stand);
    if (grund === null) {
      stand.anzahl += 1;
      stand.bytes += groesse;
    }
    return { pfad, grund };
  });
}

export function importeDes(commit, { root, lies }) {
  const baum = baumDes(commit.sha, root);
  const geaendert = new Set(commit.dateien);
  const ziele = commit.dateien.filter((pfad) => QUELLE.test(pfad)).flatMap((pfad) => {
    const inhalt = lies(pfad);
    return inhalt === null ? [] : zieleDer(pfad, inhalt, baum);
  });
  const pfade = [...new Set(ziele)].filter((pfad) => !geaendert.has(pfad)).sort();
  const geprueft = nachGrenze(pfade, baum);
  return {
    abzulegen: geprueft.filter(({ grund }) => grund === null).map(({ pfad }) => pfad),
    uebersprungen: geprueft.filter(({ grund }) => grund !== null),
  };
}
