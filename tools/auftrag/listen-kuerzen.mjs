import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

import { TOOLS } from "../basis-vergleich.mjs";
import { regexHits } from "../feste-pfade/muster.mjs";
import { gelesen, lesbar } from "./bestandslisten.mjs";
import { git, vormerken } from "./git.mjs";

export const LISTEN_KUERZEN = fileURLToPath(import.meta.url);
const EXIT_GRUEN = 0;
const EXIT_AUFRUF = 2;
const NUL = "\0";
const KOMMA = ",";
const ZEILE = "\n";
const OBJEKT_AUF = "{";
const OBJEKT_ZU = "}";
const ORDNER = "/";
const BASISLISTEN = ["knip", "anweisungen", "jscpd", "semgrep", "selbstpruefung", "fester-importpfad", "keine-speicher-attrappe", "quelltext-als-text"];

function dateien(args, root) {
  return git(args, { cwd: root }).split(NUL).filter(Boolean);
}

function vorhanden(root) {
  return dateien(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], root).filter((pfad) => existsSync(join(root, pfad)));
}

function musterTot(muster, { geloescht, jetzt }) {
  return regexHits(geloescht, muster) && !regexHits(jetzt, muster);
}

function pfadTot(pfad, { geloescht, jetzt }) {
  const aufOderUnter = (datei) => datei === pfad || datei.startsWith(`${pfad}${ORDNER}`);
  return geloescht.some(aufOderUnter) && !jetzt.some(aufOderUnter);
}

function ohne(eintraege, faellt) {
  const tot = eintraege.filter(faellt);
  return { rest: eintraege.filter((eintrag) => !tot.includes(eintrag)), tot };
}

function bereicheGekuerzt(bereiche, dateistand) {
  if (!Array.isArray(bereiche)) return { nachher: bereiche, tot: [] };
  const faellt = (eintrag) => typeof eintrag === "string" && musterTot(eintrag, dateistand);
  const tot = new Set();
  const nachher = bereiche.map((bereich) =>
    Object.fromEntries(
      Object.entries(bereich).map(([schluessel, wert]) => {
        if (!Array.isArray(wert)) return [schluessel, wert];
        const { rest, tot: gestrichen } = ohne(wert, faellt);
        for (const eintrag of gestrichen) tot.add(eintrag);
        return [schluessel, rest];
      }),
    ),
  );
  return { nachher, tot: [...tot] };
}

function basisGekuerzt({ path }) {
  return (basis, dateistand) => {
    if (!Array.isArray(basis?.befunde)) return { nachher: basis, tot: [] };
    const { rest, tot } = ohne(basis.befunde, (befund) => typeof befund === "string" && pfadTot(path(befund), dateistand));
    return { nachher: { ...basis, befunde: rest }, tot };
  };
}

function testImporteGekuerzt(importe, { geloescht }) {
  if (!Array.isArray(importe)) return { nachher: importe, tot: [] };
  const { rest, tot } = ohne(importe, (eintrag) => geloescht.includes(eintrag?.from) || geloescht.includes(eintrag?.to));
  return { nachher: rest, tot };
}

const LISTEN = [
  { pfad: "tools/bereiche.json", kuerzen: bereicheGekuerzt },
  ...BASISLISTEN.map((name) => ({ pfad: `tools/basis/${name}.json`, kuerzen: basisGekuerzt(TOOLS[name]) })),
  { pfad: "tools/basis/test-importe.json", kuerzen: testImporteGekuerzt },
];

export const KUERZLISTEN = LISTEN.map(({ pfad }) => pfad);

function ohneKomma(text) {
  return text.endsWith(KOMMA) ? text.slice(0, -KOMMA.length) : text;
}

function einrueckung(zeile) {
  return zeile.length - zeile.trimStart().length;
}

function blockEnde(zeilen, anfang) {
  const zeile = zeilen[anfang];
  if (zeile.trim() !== OBJEKT_AUF) return anfang;
  return zeilen.findIndex((kandidat, stelle) => stelle > anfang && einrueckung(kandidat) === einrueckung(zeile) && ohneKomma(kandidat.trim()) === OBJEKT_ZU);
}

function toteBloecke(zeilen, tot) {
  const bloecke = [];
  let anfang = 0;
  while (anfang < zeilen.length) {
    const ende = blockEnde(zeilen, anfang);
    const wert = ende < anfang ? undefined : gelesen(ohneKomma(zeilen.slice(anfang, ende + 1).join(ZEILE).trim()));
    const trifft = wert !== undefined && tot.some((eintrag) => isDeepStrictEqual(eintrag, wert));
    if (trifft) bloecke.push({ anfang, ende });
    anfang = trifft ? ende + 1 : anfang + 1;
  }
  return bloecke;
}

function zeilenGestrichen(text, tot) {
  const zeilen = text.split(ZEILE);
  const bloecke = toteBloecke(zeilen, tot);
  const weg = new Set(zeilen.keys().filter((stelle) => bloecke.some(({ anfang, ende }) => stelle >= anfang && stelle <= ende)));
  const kommaWeg = new Set();
  for (const { anfang } of bloecke.filter(({ ende }) => !zeilen[ende].endsWith(KOMMA))) {
    const davor = zeilen.findLastIndex((zeile, stelle) => stelle < anfang && !weg.has(stelle));
    if (davor >= 0 && zeilen[davor].endsWith(KOMMA)) kommaWeg.add(davor);
  }
  return zeilen.flatMap((zeile, stelle) => (weg.has(stelle) ? [] : [kommaWeg.has(stelle) ? ohneKomma(zeile) : zeile])).join(ZEILE);
}

export function textGekuerzt(pfad, text, dateistand) {
  const liste = LISTEN.find((eintrag) => eintrag.pfad === pfad);
  const vorher = liste === undefined || text === undefined ? undefined : gelesen(text);
  if (vorher === undefined) return undefined;
  const { nachher, tot } = liste.kuerzen(vorher, dateistand);
  if (tot.length === 0) return undefined;
  const neu = zeilenGestrichen(text, tot);
  return { tot, neu: isDeepStrictEqual(gelesen(neu), nachher) ? neu : undefined };
}

export function geloeschtSeit(basis, { ziel, root = "." } = {}) {
  return dateien(["diff", "--no-renames", "--name-only", "--diff-filter=D", "-z", basis, ...(ziel === undefined ? [] : [ziel])], root);
}

export function versioniertIn(commit, root = ".") {
  return dateien(["ls-tree", "-r", "--name-only", "-z", commit], root);
}

function listenGekuerzt({ basis, root }) {
  const geloescht = geloeschtSeit(basis, { root });
  if (geloescht.length === 0) return [];
  const dateistand = { geloescht, jetzt: vorhanden(root) };
  return KUERZLISTEN.map((pfad) => ({ pfad, ...textGekuerzt(pfad, lesbar(join(root, pfad)), dateistand) })).filter(({ tot }) => tot !== undefined);
}

function listenKuerzen({ basis, root }) {
  const listen = listenGekuerzt({ basis, root });
  const gekuerzt = listen.filter(({ neu }) => neu !== undefined);
  for (const { pfad, tot } of listen.filter(({ neu }) => neu === undefined)) {
    console.log(`${pfad}: ${tot.length} tote Einträge ließen sich nicht zeilenweise streichen, die Liste bleibt.`);
  }
  for (const { pfad, neu, tot } of gekuerzt) {
    writeFileSync(join(root, pfad), neu);
    for (const eintrag of tot) console.log(`${pfad}: gestrichen ${JSON.stringify(eintrag)}`);
  }
  vormerken(gekuerzt.map(({ pfad }) => pfad), root);
  const gestrichen = gekuerzt.reduce((summe, { tot }) => summe + tot.length, 0);
  console.log(`${gestrichen} Einträge in ${gekuerzt.length} Listen gestrichen, die nur Dateien trafen, die dieser Stand gelöscht hat.`);
  return EXIT_GRUEN;
}

async function aufruf() {
  const { values } = parseArgs({ options: { basis: { type: "string" } } });
  if (values.basis === undefined) {
    console.error("Aufruf: node tools/auftrag/listen-kuerzen.mjs --basis <commit>");
    return EXIT_AUFRUF;
  }
  return listenKuerzen({ basis: values.basis, root: process.cwd() });
}

if (import.meta.url === pathToFileURL(realpathSync(argv[1] ?? ".")).href) process.exitCode = await aufruf();
