import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { eslintBefehl, fuehreAus, paketBefehl, werkzeugBefehl } from "./werkzeuge.mjs";

export const KNIP = "knip";
export const JSCPD = "jscpd";
export const ALTFUNKTION = "altfunktion";
export const BASIS = "basis";
export const SORTEN = [KNIP, JSCPD, ALTFUNKTION];
export const UNTERDRUECKUNGEN = "eslint-suppressions.json";
export const UNTERDRUECKUNGS_BASIS = "unterdrueckungen";
const KUERZEN = "--basis-kuerzen";
const FUNKTIONSARTEN = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"];
const FEHLER = 2;
const ladeModul = createRequire(import.meta.url);
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

function ungefilterteMeldungen(root, dateien) {
  const ordner = mkdtempSync(join(tmpdir(), "ziele-altfunktion-"));
  try {
    const leer = join(ordner, UNTERDRUECKUNGEN);
    writeFileSync(leer, "{}");
    const lauf = fuehreAus(eslintBefehl(["--format", "json", "--suppressions-location", leer, ...dateien]), root);
    return JSON.parse(lauf.stdout || "[]");
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function funktionsname(knoten) {
  const { id, parent: eltern } = knoten;
  const benannt = id?.name ?? eltern?.id?.name ?? eltern?.key?.name;
  return benannt ?? `anonym ab Zeile ${knoten.loc.start.line}`;
}

function funktionenIn(datei, quelltext) {
  const gefunden = [];
  const sammle = (knoten) => gefunden.push({ name: funktionsname(knoten), von: knoten.loc.start.line, bis: knoten.loc.end.line, start: knoten.range[0] });
  const regel = { create: () => Object.fromEntries(FUNKTIONSARTEN.map((art) => [art, sammle])) };
  const konfiguration = {
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    plugins: { ziele: { rules: { funktionen: regel } } },
    rules: { "ziele/funktionen": "error" },
  };
  const { Linter } = ladeModul("eslint");
  new Linter().verify(quelltext, konfiguration, { filename: datei });
  return gefunden;
}

function innersteFunktion(funktionen, zeile) {
  const umschliessend = funktionen.filter(({ von, bis }) => von <= zeile && zeile <= bis);
  return umschliessend.toSorted((links, rechts) => rechts.start - links.start)[0];
}

function altfunktionEintraege(root, { filePath, messages, source }) {
  const datei = relative(root, filePath);
  const funktionen = funktionenIn(datei, source ?? readFileSync(filePath, "utf8"));
  const jeFunktion = new Map();
  for (const { line, ruleId } of messages.filter(({ severity }) => severity === FEHLER)) {
    const funktion = innersteFunktion(funktionen, line);
    if (funktion !== undefined) jeFunktion.set(funktion, [...(jeFunktion.get(funktion) ?? []), ruleId]);
  }
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

function unterdrueckungenVergleich(root, argumente) {
  const pfad = join(root, UNTERDRUECKUNGEN);
  const ergebnis = { gruen: true, behoben: [], datei: UNTERDRUECKUNGEN, ausgabe: "" };
  if (!existsSync(pfad)) return ergebnis;
  const vorher = readFileSync(pfad, "utf8");
  const lauf = fuehreAus(eslintBefehl([".", "--prune-suppressions"]), root);
  const behoben = gesenkteEintraege(JSON.parse(vorher), JSON.parse(readFileSync(pfad, "utf8")));
  if (!argumente.includes(KUERZEN)) writeFileSync(pfad, vorher);
  return { ...ergebnis, gruen: lauf.status === EXIT_GRUEN, behoben, ausgabe: `${lauf.stdout}${lauf.stderr}`.trim() };
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
