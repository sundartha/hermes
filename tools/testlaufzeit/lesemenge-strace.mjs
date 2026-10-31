import { createReadStream } from "node:fs";
import { isAbsolute, normalize, posix } from "node:path";
import { createInterface } from "node:readline";

const PRODUKT_ORDNER = ["src", "test"];
const WERKZEUG_ORDNER = "test/werkzeuge";
const GIT_ORDNER = ".git";
const PROZESS_VORNE = /^(\d+)\s+/;
const SYSTEMAUFRUF_ZEILE = /^(?:\d+\s+)?([a-z_][a-z0-9_]*)\((.*)$/;
const FORTGESETZT_ZEILE = /^(\d+)\s+<\.\.\. (?:clone3?|fork|vfork) resumed>.*= (\d+)\s*$/;
const ERGEBNIS_PROZESS = /= (\d+)\s*$/;
const ERGEBNIS_ERFOLG = /= 0\s*$/;
const PFAD_ARGUMENT = /(?:(AT_FDCWD|\d+)<((?:[^>\\]|\\.)*)>, )?"((?:[^"\\]|\\.)*)"/g;
const MASKIERT = /\\(["\\])/g;
const AUSFUEHREN = "execve";
const WECHSELN = "chdir";
const VERZEICHNIS_FLAGGE = "O_DIRECTORY";
const ABZWEIGEN = new Set(["clone", "clone3", "fork", "vfork"]);
const ART_PFAD = "pfad";
const ART_VERZEICHNIS = "verzeichnis";
const ART_GIT = "git";
const AUFRUFE_MIT_FLAGGEN = new Set(["open", "openat", "openat2"]);
const ARBEITSORDNER = "AT_FDCWD";
const KEIN_PROZESS = 0;

function entmaskiert(text) {
  return text.replace(MASKIERT, "$1");
}

function prozessVon(zeile) {
  const treffer = PROZESS_VORNE.exec(zeile);
  return treffer === null ? KEIN_PROZESS : Number(treffer[1]);
}

function pfadArgumente(aufruf, rest) {
  const treffer = [...rest.matchAll(PFAD_ARGUMENT)].map(([, art, ordner, pfad]) => ({
    art,
    ordner: ordner === undefined ? undefined : entmaskiert(ordner),
    pfad: entmaskiert(pfad),
  }));
  return aufruf === AUSFUEHREN ? treffer.slice(0, 1) : treffer;
}

function arbeitsordnerAus(argumente) {
  return argumente.find(({ art }) => art === ARBEITSORDNER)?.ordner;
}

function ausgangsordner(argument, bekannt) {
  if (argument.ordner !== undefined) return { ordner: argument.ordner, sicher: true };
  return bekannt === undefined ? { ordner: undefined, sicher: false } : { ordner: bekannt, sicher: true };
}

function aufgeloest(argument, bekannt, wurzel) {
  if (isAbsolute(argument.pfad)) return { pfad: normalize(argument.pfad), sicher: true };
  const { ordner, sicher } = ausgangsordner(argument, bekannt);
  return { pfad: normalize(`${ordner ?? wurzel}/${argument.pfad}`), sicher };
}

function relativ(pfad, wurzel) {
  const vorne = `${wurzel}/`;
  if (!pfad.startsWith(vorne)) return null;
  return posix.normalize(pfad.slice(vorne.length));
}

function istProduktPfad(teile) {
  const pfad = teile.join("/");
  const unterWerkzeugen = pfad === WERKZEUG_ORDNER || pfad.startsWith(`${WERKZEUG_ORDNER}/`);
  return PRODUKT_ORDNER.includes(teile[0]) && !unterWerkzeugen;
}

function listetVerzeichnis(aufruf, rest) {
  return AUFRUFE_MIT_FLAGGEN.has(aufruf) && rest.includes(VERZEICHNIS_FLAGGE);
}

function fundZu(relativerPfad, listet, sicher) {
  const teile = relativerPfad.split("/");
  if (teile[0] === GIT_ORDNER) return { art: ART_GIT, sicher };
  if (!istProduktPfad(teile)) return null;
  if (listet) return { art: ART_VERZEICHNIS, pfad: relativerPfad, sicher };
  return teile.length > 1 ? { art: ART_PFAD, pfad: relativerPfad, sicher } : null;
}

function fundZuArgument(argument, kontext) {
  if (argument.pfad === "") return [];
  const { pfad, sicher } = aufgeloest(argument, kontext.bekannt, kontext.wurzel);
  const innen = relativ(pfad, kontext.wurzel);
  const fund = innen === null ? null : fundZu(innen, kontext.listet, sicher);
  return fund === null ? [] : [fund];
}

function abgezweigt(zeile, ordner) {
  const fortgesetzt = FORTGESETZT_ZEILE.exec(zeile);
  if (fortgesetzt === null) return false;
  const bekannt = ordner.get(prozessVon(zeile));
  if (bekannt !== undefined) ordner.set(Number(fortgesetzt[2]), bekannt);
  return true;
}

function nachAbzweigung({ aufruf, zeile, prozess }, ordner) {
  if (!ABZWEIGEN.has(aufruf)) return;
  const kind = ERGEBNIS_PROZESS.exec(zeile);
  const bekannt = ordner.get(prozess);
  if (kind !== null && bekannt !== undefined) ordner.set(Number(kind[1]), bekannt);
}

function nachWechsel({ aufruf, zeile, prozess, ziel }, ordner) {
  if (aufruf !== WECHSELN || !ERGEBNIS_ERFOLG.test(zeile)) return;
  if (ziel !== undefined) ordner.set(prozess, ziel);
}

export function zeileFunde(zeile, wurzel, ordner = new Map()) {
  if (abgezweigt(zeile, ordner)) return [];
  const treffer = SYSTEMAUFRUF_ZEILE.exec(zeile);
  if (treffer === null) return [];
  const [, aufruf, rest] = treffer;
  const prozess = prozessVon(zeile);
  const argumente = pfadArgumente(aufruf, rest);
  const sichtbar = arbeitsordnerAus(argumente);
  if (sichtbar !== undefined) ordner.set(prozess, sichtbar);
  nachAbzweigung({ aufruf, zeile, prozess }, ordner);
  const kontext = { wurzel, bekannt: ordner.get(prozess), listet: listetVerzeichnis(aufruf, rest) };
  const funde = argumente.flatMap((argument) => fundZuArgument(argument, kontext));
  const ziel = argumente[0] === undefined ? undefined : aufgeloest(argumente[0], kontext.bekannt, wurzel).pfad;
  nachWechsel({ aufruf, zeile, prozess, ziel }, ordner);
  return funde;
}

function menge(funde, art, sicher) {
  const treffer = funde.filter((fund) => fund.art === art && fund.sicher === sicher);
  return new Set(treffer.map(({ pfad }) => pfad));
}

function lesemengeAus(funde) {
  const von = (sicher) => ({
    pfade: menge(funde, ART_PFAD, sicher),
    verzeichnisse: menge(funde, ART_VERZEICHNIS, sicher),
    git: funde.some((fund) => fund.art === ART_GIT && fund.sicher === sicher),
  });
  return { ...von(true), unsicher: von(false) };
}

export function lesemengeAusZeilen(zeilen, wurzel) {
  const ordner = new Map();
  return lesemengeAus([...zeilen].flatMap((zeile) => zeileFunde(zeile, wurzel, ordner)));
}

export async function lesemengeAusDatei(datei, wurzel) {
  const zeilen = createInterface({ input: createReadStream(datei, "utf8"), crlfDelay: Infinity });
  const ordner = new Map();
  const funde = new Map();
  for await (const zeile of zeilen) {
    for (const fund of zeileFunde(zeile, wurzel, ordner)) funde.set(`${fund.art} ${fund.sicher} ${fund.pfad ?? ""}`, fund);
  }
  return lesemengeAus([...funde.values()]);
}

function sortiert(werte) {
  return [...werte].sort();
}

export function alsEintrag(lesemenge) {
  const { unsicher } = lesemenge;
  return {
    pfade: sortiert(lesemenge.pfade),
    verzeichnisse: sortiert(lesemenge.verzeichnisse),
    git: lesemenge.git,
    unsicher: {
      pfade: sortiert(unsicher.pfade),
      verzeichnisse: sortiert(unsicher.verzeichnisse),
      git: unsicher.git,
    },
  };
}
