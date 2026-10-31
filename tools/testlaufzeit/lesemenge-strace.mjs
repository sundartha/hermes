import { createReadStream } from "node:fs";
import { isAbsolute, normalize, posix } from "node:path";
import { createInterface } from "node:readline";

const PRODUKT_ORDNER = ["src", "test"];
const WERKZEUG_ORDNER = "test/werkzeuge";
const GIT_ORDNER = ".git";
const SYSTEMAUFRUF_ZEILE = /^(?:\d+\s+)?([a-z_][a-z0-9_]*)\((.*)$/;
const PFAD_ARGUMENT = /(?:(?:AT_FDCWD|\d+)<((?:[^>\\]|\\.)*)>, )?"((?:[^"\\]|\\.)*)"/g;
const MASKIERT = /\\(["\\])/g;
const AUSFUEHREN = "execve";
const VERZEICHNIS_FLAGGE = "O_DIRECTORY";
const ART_PFAD = "pfad";
const ART_VERZEICHNIS = "verzeichnis";
const ART_GIT = "git";
const AUFRUFE_MIT_FLAGGEN = new Set(["open", "openat", "openat2"]);

function entmaskiert(text) {
  return text.replace(MASKIERT, "$1");
}

function pfadArgumente(aufruf, rest) {
  const treffer = [...rest.matchAll(PFAD_ARGUMENT)].map(([, ordner, pfad]) => ({
    ordner: ordner === undefined ? undefined : entmaskiert(ordner),
    pfad: entmaskiert(pfad),
  }));
  return aufruf === AUSFUEHREN ? treffer.slice(0, 1) : treffer;
}

function absolut({ ordner, pfad }, wurzel) {
  return normalize(isAbsolute(pfad) ? pfad : `${ordner ?? wurzel}/${pfad}`);
}

function relativ(pfad, wurzel) {
  const vorne = `${wurzel}/`;
  if (!pfad.startsWith(vorne)) return null;
  return posix.normalize(pfad.slice(vorne.length));
}

function istProduktPfad(teile) {
  const unterWerkzeugen = teile.join("/") === WERKZEUG_ORDNER || teile.join("/").startsWith(`${WERKZEUG_ORDNER}/`);
  return PRODUKT_ORDNER.includes(teile[0]) && !unterWerkzeugen;
}

function listetVerzeichnis(aufruf, rest) {
  return AUFRUFE_MIT_FLAGGEN.has(aufruf) && rest.includes(VERZEICHNIS_FLAGGE);
}

function fundZu(relativerPfad, listet) {
  const teile = relativerPfad.split("/");
  if (teile[0] === GIT_ORDNER) return { art: ART_GIT };
  if (!istProduktPfad(teile)) return null;
  if (listet) return { art: ART_VERZEICHNIS, pfad: relativerPfad };
  return teile.length > 1 ? { art: ART_PFAD, pfad: relativerPfad } : null;
}

function fundZuArgument(argument, listet, wurzel) {
  if (argument.pfad === "") return [];
  const innen = relativ(absolut(argument, wurzel), wurzel);
  const fund = innen === null ? null : fundZu(innen, listet);
  return fund === null ? [] : [fund];
}

export function zeileFunde(zeile, wurzel) {
  const treffer = SYSTEMAUFRUF_ZEILE.exec(zeile);
  if (treffer === null) return [];
  const [, aufruf, rest] = treffer;
  const listet = listetVerzeichnis(aufruf, rest);
  return pfadArgumente(aufruf, rest).flatMap((argument) => fundZuArgument(argument, listet, wurzel));
}

function lesemengeAus(funde) {
  const von = (art) => new Set(funde.filter((fund) => fund.art === art).map(({ pfad }) => pfad));
  return {
    pfade: von(ART_PFAD),
    verzeichnisse: von(ART_VERZEICHNIS),
    git: funde.some((fund) => fund.art === ART_GIT),
  };
}

export function lesemengeAusZeilen(zeilen, wurzel) {
  return lesemengeAus([...zeilen].flatMap((zeile) => zeileFunde(zeile, wurzel)));
}

export async function lesemengeAusDatei(datei, wurzel) {
  const zeilen = createInterface({ input: createReadStream(datei, "utf8"), crlfDelay: Infinity });
  const funde = new Map();
  for await (const zeile of zeilen) {
    for (const fund of zeileFunde(zeile, wurzel)) funde.set(`${fund.art} ${fund.pfad ?? ""}`, fund);
  }
  return lesemengeAus([...funde.values()]);
}

export function alsEintrag(lesemenge) {
  return {
    pfade: [...lesemenge.pfade].sort(),
    verzeichnisse: [...lesemenge.verzeichnisse].sort(),
    git: lesemenge.git,
  };
}
