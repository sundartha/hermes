import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

import { TOOLS } from "../basis-vergleich.mjs";
import { INNER_GROUP, groupAlternatives, regexHits, splittable } from "../feste-pfade/muster.mjs";
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
const GRUPPE_AUF = "(";
const GRUPPE_ZU = ")";
const ODER = "|";
const TRENNER = ", ";
const EINZEILIGE_LISTE = /^(\s*"(?:[^"\\]|\\.)*": )(\[.*\])(,?)$/;
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

function ohneToteAlternativen(muster, dateistand) {
  if (!splittable(muster)) return muster;
  for (const gruppe of muster.matchAll(INNER_GROUP)) {
    const alternativen = groupAlternatives(muster, gruppe);
    const bleiben = alternativen.filter(({ source }) => !musterTot(source, dateistand)).map(({ choice }) => choice);
    if (bleiben.length > 0 && bleiben.length < alternativen.length) {
      const [ganz, art = ""] = gruppe;
      const neu = `${muster.slice(0, gruppe.index)}${GRUPPE_AUF}${art}${bleiben.join(ODER)}${GRUPPE_ZU}${muster.slice(gruppe.index + ganz.length)}`;
      return ohneToteAlternativen(neu, dateistand);
    }
  }
  return muster;
}

function gleicheTreffer(alt, neu, jetzt) {
  return jetzt.every((datei) => regexHits([datei], alt) === regexHits([datei], neu));
}

function bereicheGekuerzt(bereiche, dateistand) {
  if (!Array.isArray(bereiche)) return { nachher: bereiche, tot: [] };
  const faellt = (eintrag) => typeof eintrag === "string" && musterTot(eintrag, dateistand);
  const tot = new Set();
  const umgeschrieben = new Map();
  const anders = new Set();
  const umschreiben = (eintrag) => {
    const neu = dateistand.alternativen === true && typeof eintrag === "string" ? ohneToteAlternativen(eintrag, dateistand) : eintrag;
    if (neu === eintrag) return eintrag;
    if (!gleicheTreffer(eintrag, neu, dateistand.jetzt)) {
      anders.add(eintrag);
      return eintrag;
    }
    umgeschrieben.set(eintrag, neu);
    return neu;
  };
  const nachher = bereiche.map((bereich) =>
    Object.fromEntries(
      Object.entries(bereich).map(([schluessel, wert]) => {
        if (!Array.isArray(wert)) return [schluessel, wert];
        const { rest, tot: gestrichen } = ohne(wert, faellt);
        for (const eintrag of gestrichen) tot.add(eintrag);
        return [schluessel, rest.map(umschreiben)];
      }),
    ),
  );
  return { nachher, tot: [...tot], umgeschrieben: [...umgeschrieben].map(([alt, neu]) => ({ alt, neu })), anders: [...anders] };
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

function schreibweise(eintraege) {
  return `[${eintraege.map((eintrag) => JSON.stringify(eintrag)).join(TRENNER)}]`;
}

function einzeiligGekuerzt(zeile, tot) {
  const teile = EINZEILIGE_LISTE.exec(zeile);
  const liste = teile === null ? undefined : gelesen(teile[2]);
  const gewohnt = Array.isArray(liste) && liste.every((eintrag) => typeof eintrag === "string") && schreibweise(liste) === teile[2];
  return gewohnt ? `${teile[1]}${schreibweise(ohne(liste, (eintrag) => tot.includes(eintrag)).rest)}${teile[3]}` : zeile;
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
  return zeilen.flatMap((zeile, stelle) => (weg.has(stelle) ? [] : [einzeiligGekuerzt(kommaWeg.has(stelle) ? ohneKomma(zeile) : zeile, tot)])).join(ZEILE);
}

function genauEinmal(text, teil) {
  const stelle = text.indexOf(teil);
  return stelle !== -1 && stelle === text.lastIndexOf(teil);
}

function musterErsetzt(text, umgeschrieben) {
  const nichtEinmal = umgeschrieben.filter(({ alt }) => !genauEinmal(text, JSON.stringify(alt)));
  if (nichtEinmal.length > 0) return { nichtEinmal };
  return { nichtEinmal, ersetzt: umgeschrieben.reduce((stand, { alt, neu }) => stand.replace(JSON.stringify(alt), () => JSON.stringify(neu)), text) };
}

function geprueftGekuerzt(text, { nachher, tot, umgeschrieben }) {
  const { nichtEinmal, ersetzt } = musterErsetzt(zeilenGestrichen(text, tot), umgeschrieben);
  const stimmt = ersetzt !== undefined && isDeepStrictEqual(gelesen(ersetzt), nachher);
  return { nichtEinmal, neu: stimmt ? ersetzt : undefined };
}

export function textGekuerzt(pfad, text, dateistand) {
  const liste = LISTEN.find((eintrag) => eintrag.pfad === pfad);
  const vorher = liste === undefined || text === undefined ? undefined : gelesen(text);
  if (vorher === undefined) return undefined;
  const { nachher, tot, umgeschrieben = [], anders = [] } = liste.kuerzen(vorher, dateistand);
  if (tot.length === 0 && umgeschrieben.length === 0 && anders.length === 0) return undefined;
  return { tot, umgeschrieben, anders, ...geprueftGekuerzt(text, { nachher, tot, umgeschrieben }) };
}

export function geloeschtSeit(basis, { ziel, root = "." } = {}) {
  return dateien(["diff", "--no-renames", "--name-only", "--diff-filter=D", "-z", basis, ...(ziel === undefined ? [] : [ziel])], root);
}

export function versioniertIn(commit, root = ".") {
  return dateien(["ls-tree", "-r", "--name-only", "-z", commit], root);
}

function listenGekuerzt({ basis, root, alternativen }) {
  const geloescht = geloeschtSeit(basis, { root });
  if (geloescht.length === 0) return [];
  const dateistand = { geloescht, jetzt: vorhanden(root), alternativen };
  return KUERZLISTEN.map((pfad) => ({ pfad, ...textGekuerzt(pfad, lesbar(join(root, pfad)), dateistand) })).filter(({ tot }) => tot !== undefined);
}

function summe(listen, feld) {
  return listen.reduce((bisher, liste) => bisher + liste[feld].length, 0);
}

function listenKuerzen({ basis, root, alternativen }) {
  const alle = listenGekuerzt({ basis, root, alternativen });
  for (const { pfad, anders } of alle) {
    for (const alt of anders) console.log(`${pfad}: das Muster ${JSON.stringify(alt)} träfe ohne seine toten Alternativen andere vorhandene Dateien, es bleibt.`);
  }
  const listen = alle.filter(({ tot, umgeschrieben }) => tot.length + umgeschrieben.length > 0);
  const gekuerzt = listen.filter(({ neu }) => neu !== undefined);
  for (const { pfad, tot, umgeschrieben, nichtEinmal } of listen.filter(({ neu }) => neu === undefined)) {
    for (const { alt } of nichtEinmal) console.log(`${pfad}: das Muster ${JSON.stringify(alt)} steht nicht genau einmal im Text, die Liste bleibt.`);
    console.log(`${pfad}: ${tot.length} tote Einträge und ${umgeschrieben.length} Muster mit toten Alternativen ließen sich nicht zeilenweise streichen, die Liste bleibt.`);
  }
  for (const { pfad, neu, tot, umgeschrieben } of gekuerzt) {
    writeFileSync(join(root, pfad), neu);
    for (const eintrag of tot) console.log(`${pfad}: gestrichen ${JSON.stringify(eintrag)}`);
    for (const muster of umgeschrieben) console.log(`${pfad}: tote Alternative gestrichen ${JSON.stringify(muster.alt)} -> ${JSON.stringify(muster.neu)}`);
  }
  vormerken(gekuerzt.map(({ pfad }) => pfad), root);
  console.log(`${summe(gekuerzt, "tot")} Einträge gestrichen und ${summe(gekuerzt, "umgeschrieben")} Muster um tote Alternativen gekürzt in ${gekuerzt.length} Listen; beides traf an der Basis nur Dateien, die dieser Stand gelöscht hat.`);
  return EXIT_GRUEN;
}

async function aufruf() {
  const { values } = parseArgs({ options: { basis: { type: "string" }, alternativen: { type: "boolean", default: false } } });
  if (values.basis === undefined) {
    console.error("Aufruf: node tools/auftrag/listen-kuerzen.mjs --basis <commit> [--alternativen]");
    return EXIT_AUFRUF;
  }
  return listenKuerzen({ basis: values.basis, root: process.cwd(), alternativen: values.alternativen });
}

if (import.meta.url === pathToFileURL(realpathSync(argv[1] ?? ".")).href) process.exitCode = await aufruf();
