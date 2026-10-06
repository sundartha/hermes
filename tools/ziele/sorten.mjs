import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { fuehreAus, paketBefehl, werkzeugBefehl } from "./werkzeuge.mjs";

export const KNIP = "knip";
export const JSCPD = "jscpd";
export const BASIS = "basis";
export const SORTEN = [KNIP, JSCPD];
export const BASIS_WERKZEUGE = [KNIP, JSCPD];
const KNIP_ARTEN = new Set(["exports", "types", "duplicates"]);
const DUPLIKATE = "duplicates";
const GIT_TREFFER = 0;
const KNIP_BASIS = "tools/basis/knip.json";
const KNIP_EXIT_BEFUNDE = 1;
const JSCPD_BERICHT = "jscpd-report.json";
const BEHOBEN = /^(\d+) Befunde aus (\S+) sind behoben:$/m;
const BEHOBENER_EINTRAG = /^ {2}(\S.*)$/gm;
const EXIT_GRUEN = 0;

function knipZeilen(root) {
  const lauf = fuehreAus(paketBefehl("knip", ["--reporter", "json", "--no-progress"]), root);
  if (lauf.status !== EXIT_GRUEN && lauf.status !== KNIP_EXIT_BEFUNDE) {
    throw new Error(`knip ist mit Exit ${lauf.status} gescheitert: ${lauf.stderr.trim()}`);
  }
  return JSON.parse(lauf.stdout).issues;
}

function knipEintrag(art, eintrag) {
  const namen = [eintrag].flat().map(({ name }) => String(name ?? ""));
  return { art, namen, text: `${art} ${namen.join("+")}`.trim() };
}

function knipEintraege(zeile) {
  const arten = Object.entries(zeile).filter(([art, liste]) => KNIP_ARTEN.has(art) && Array.isArray(liste));
  return arten.flatMap(([art, liste]) => liste.map((eintrag) => knipEintrag(art, eintrag)));
}

function anderswoGenannt(root, datei, name) {
  const suche = ["git", "grep", "-n", "-w", "-F", "-e", name, "--", ".", `:(exclude)${datei}`, `:(exclude)${KNIP_BASIS}`];
  return name === "" || fuehreAus(suche, root).status === GIT_TREFFER;
}

export function entfernbareNamen(root, datei, { namen }) {
  return namen.filter((name) => !anderswoGenannt(root, datei, name));
}

export function istDuplikat({ art }) {
  return art === DUPLIKATE;
}

export function nurHierGenannt(root, datei, eintrag) {
  const frei = entfernbareNamen(root, datei, eintrag);
  return istDuplikat(eintrag) ? frei.length > 0 : frei.length === eintrag.namen.length;
}

function nachDatei(paare) {
  const karte = new Map();
  for (const [datei, eintrag] of paare) karte.set(datei, [...(karte.get(datei) ?? []), eintrag]);
  return karte;
}

export function knipBefunde(root) {
  return nachDatei(
    knipZeilen(root).flatMap((zeile) =>
      knipEintraege(zeile).map((eintrag) => [relative(root, resolve(root, zeile.file)), eintrag]),
    ),
  );
}

function jscpdKopien(root) {
  const ordner = mkdtempSync(join(tmpdir(), "ziele-jscpd-"));
  try {
    const argumente = [".", "--reporters", "json", "--output", ordner, "--silent"];
    const lauf = fuehreAus(paketBefehl("jscpd", argumente), root);
    if (lauf.status !== EXIT_GRUEN) throw new Error(`jscpd ist mit Exit ${lauf.status} gescheitert`);
    return JSON.parse(readFileSync(join(ordner, JSCPD_BERICHT), "utf8")).duplicates;
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function kopieInDerselbenDatei(root, { firstFile: erstes, secondFile: zweites }) {
  const [links, rechts] = [erstes, zweites].map(({ name }) => relative(root, resolve(root, name)));
  if (links !== rechts) return null;
  const text = `Zeilen ${erstes.start}-${erstes.end} gleichen ${zweites.start}-${zweites.end}`;
  return [links, { art: JSCPD, text }];
}

export function jscpdBefunde(root) {
  const paare = jscpdKopien(root).map((kopie) => kopieInDerselbenDatei(root, kopie));
  return nachDatei(paare.filter(Boolean));
}

export function befundeDer(sorte, root) {
  return sorte === KNIP ? knipBefunde(root) : jscpdBefunde(root);
}

export function basisVergleich(werkzeug, root, argumente = []) {
  const lauf = fuehreAus(werkzeugBefehl("tools/basis-vergleich.mjs", [werkzeug, ...argumente]), root);
  const behoben = BEHOBEN.exec(lauf.stdout);
  const eintraege = behoben ? [...lauf.stdout.matchAll(BEHOBENER_EINTRAG)].map(([, text]) => text) : [];
  return {
    gruen: lauf.status === EXIT_GRUEN,
    behoben: eintraege,
    datei: `tools/basis/${werkzeug}.json`,
    ausgabe: `${lauf.stdout}${lauf.stderr}`.trim(),
  };
}
