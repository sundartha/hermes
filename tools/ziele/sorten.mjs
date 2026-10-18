import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { UNTERDRUECKUNGEN, funktionenIn, regelnJeFunktion, ungefilterteMeldungen } from "./funktionen.mjs";
import { eslintBefehl, fuehreAus, paketBefehl, werkzeugBefehl } from "./werkzeuge.mjs";

export { UNTERDRUECKUNGEN } from "./funktionen.mjs";

export const KNIP = "knip";
export const JSCPD = "jscpd";
export const ALTFUNKTION = "altfunktion";
export const BASIS = "basis";
export const SORTEN = [KNIP, JSCPD, ALTFUNKTION];
export const UNTERDRUECKUNGS_BASIS = "unterdrueckungen";
const KUERZEN = "--basis-kuerzen";
export const BASIS_WERKZEUGE = [KNIP, JSCPD, UNTERDRUECKUNGS_BASIS];
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

function unterdrueckteDateien(root) {
  const pfad = join(root, UNTERDRUECKUNGEN);
  if (!existsSync(pfad)) return [];
  const liste = JSON.parse(readFileSync(pfad, "utf8"));
  return Object.keys(liste).filter((datei) => Object.keys(liste[datei]).length > 0 && existsSync(join(root, datei)));
}

function altfunktionEintraege(root, { filePath, messages, source }) {
  const datei = relative(root, filePath);
  const funktionen = funktionenIn(datei, source ?? readFileSync(filePath, "utf8"));
  const jeFunktion = regelnJeFunktion(funktionen, messages);
  const eintraege = [...jeFunktion].map(([{ name, von }, regeln]) => ({
    art: ALTFUNKTION,
    funktion: name,
    anzahl: regeln.length,
    text: `${name} ab Zeile ${von}: ${regeln.length} Befunde (${[...new Set(regeln)].sort().join(", ")})`,
  }));
  return [datei, eintraege.sort((links, rechts) => rechts.anzahl - links.anzahl)];
}

export function altfunktionBefunde(root) {
  const dateien = unterdrueckteDateien(root);
  if (dateien.length === 0) return new Map();
  const wurzel = realpathSync(root);
  const paare = ungefilterteMeldungen(root, dateien).map((ergebnis) => altfunktionEintraege(wurzel, ergebnis));
  return new Map(paare.filter(([, eintraege]) => eintraege.length > 0));
}

export function befundeDer(sorte, root) {
  if (sorte === ALTFUNKTION) return altfunktionBefunde(root);
  return sorte === KNIP ? knipBefunde(root) : jscpdBefunde(root);
}

export function restBefunde(ziel, root) {
  const liste = befundeDer(ziel.sorte, root).get(ziel.datei) ?? [];
  return ziel.funktion === undefined ? liste : liste.filter(({ funktion }) => funktion === ziel.funktion);
}

function gesenkteEintraege(vorher, nachher) {
  return Object.entries(vorher).flatMap(([datei, regeln]) =>
    Object.entries(regeln).flatMap(([regel, { count }]) => {
      const jetzt = nachher[datei]?.[regel]?.count ?? 0;
      return jetzt < count ? [`${datei} ${regel} ${count} → ${jetzt}`] : [];
    }),
  );
}

export function kuerzeUnterdrueckungen(root, ziele, { behalten = false } = {}) {
  const pfad = join(root, UNTERDRUECKUNGEN);
  const vorher = readFileSync(pfad, "utf8");
  const lauf = fuehreAus(eslintBefehl([...ziele, "--prune-suppressions"]), root);
  const nachher = readFileSync(pfad, "utf8");
  if (!behalten) writeFileSync(pfad, vorher);
  return { lauf, vorher: JSON.parse(vorher), nachher: JSON.parse(nachher) };
}

function unterdrueckungenVergleich(root, argumente) {
  const ergebnis = { gruen: true, behoben: [], datei: UNTERDRUECKUNGEN, ausgabe: "" };
  if (!existsSync(join(root, UNTERDRUECKUNGEN))) return ergebnis;
  const { lauf, vorher, nachher } = kuerzeUnterdrueckungen(root, ["."], { behalten: argumente.includes(KUERZEN) });
  return { ...ergebnis, gruen: lauf.status === EXIT_GRUEN, behoben: gesenkteEintraege(vorher, nachher), ausgabe: `${lauf.stdout}${lauf.stderr}`.trim() };
}

export function basisVergleich(werkzeug, root, argumente = []) {
  if (werkzeug === UNTERDRUECKUNGS_BASIS) return unterdrueckungenVergleich(root, argumente);
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
