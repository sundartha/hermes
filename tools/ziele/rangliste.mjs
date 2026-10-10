import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { gitAusgabe } from "../auftrag/pruefer-auswahl.mjs";
import { LABEL as PRUEFER_LABEL } from "../auftrag/pruefer-issues.mjs";
import { istVomBot } from "./befunde.mjs";
import { issuesMitLabel } from "./github.mjs";
import { UNTERDRUECKUNGEN } from "./sorten.mjs";

export const DURCHGANG_DATEI = "durchgang.json";
export const ESLINT = "eslint";
export const PRUEFER = "pruefer";
const BASIS_ORDNER = "tools/basis";
const JSON_ENDUNG = ".json";
const AUFRAEUMEN_COMMIT = "^Art: aufraeumen$";
const COMMIT_FORMAT = "%x1e";
const COMMIT_TRENNER = "\u001e";
const FELD = "|";
const PRUEFSUMME = /^[0-9a-f]{16}$/;
const ZAHL = /^\d+$/;
const CODE = /\.(?:[cm]?js|jsx|tsx?)$/;
const PRUEFER_TITEL = /^Prüfer: (\S+) in `([^`]+)`$/;
const KATALOG_ID = /^(?:[A-Z]\d{1,2}|SG-\d{2,3})$/;
const EINRUECKUNG = /^[ \t]*/;
const TAB = "\t";
const LEERZEICHEN_JE_STUFE = 2;
const WIEDERKEHREND = 2;

function gitZeilen(argumente, root) {
  return gitAusgabe(["-c", "core.quotePath=false", ...argumente], root).split("\n").filter(Boolean);
}

export function aenderungenJeDatei(root) {
  const log = gitAusgabe(["-c", "core.quotePath=false", "log", "--no-merges", "--invert-grep", `--grep=${AUFRAEUMEN_COMMIT}`, `--format=${COMMIT_FORMAT}`, "--name-only", "HEAD"], root);
  const zaehlung = new Map();
  for (const commit of log.split(COMMIT_TRENNER)) {
    for (const datei of new Set(commit.split("\n").filter(Boolean))) zaehlung.set(datei, (zaehlung.get(datei) ?? 0) + 1);
  }
  return zaehlung;
}

function tiefe(zeile) {
  const vorne = EINRUECKUNG.exec(zeile)[0];
  const tabs = vorne.split(TAB).length - 1;
  return tabs + Math.floor((vorne.length - tabs) / LEERZEICHEN_JE_STUFE);
}

export function umfang(text) {
  return text.split("\n").filter((zeile) => zeile.trim() !== "").reduce((summe, zeile) => summe + 1 + tiefe(zeile), 0);
}

function leseJsonOderNichts(pfad) {
  try {
    return JSON.parse(readFileSync(pfad, "utf8"));
  } catch {
    return null;
  }
}

function zeilenBefunde(pruefung, eintrag, dateien) {
  const felder = String(eintrag).split(FELD);
  const regel = felder.find((feld) => !dateien.has(feld) && !PRUEFSUMME.test(feld) && !ZAHL.test(feld)) ?? "";
  return [...new Set(felder.filter((feld) => dateien.has(feld)))].map((datei) => ({ datei, pruefung, regel, anzahl: 1 }));
}

function befundeDerBasis(pruefung, inhalt, dateien) {
  if (Array.isArray(inhalt?.befunde)) return inhalt.befunde.flatMap((eintrag) => zeilenBefunde(pruefung, eintrag, dateien));
  if (!Array.isArray(inhalt)) return [];
  const mitDatei = inhalt.filter((eintrag) => dateien.has(eintrag?.from));
  return mitDatei.map((eintrag) => ({ datei: eintrag.from, pruefung, regel: String(eintrag.rule?.name ?? ""), anzahl: 1 }));
}

function basisBefunde(root, dateien) {
  const ordner = join(root, BASIS_ORDNER);
  if (!existsSync(ordner)) return [];
  const namen = readdirSync(ordner).filter((name) => name.endsWith(JSON_ENDUNG)).sort();
  return namen.flatMap((name) => befundeDerBasis(name.slice(0, -JSON_ENDUNG.length), leseJsonOderNichts(join(ordner, name)), dateien));
}

function eslintBefunde(root, dateien) {
  const liste = leseJsonOderNichts(join(root, UNTERDRUECKUNGEN)) ?? {};
  return Object.entries(liste)
    .filter(([datei]) => dateien.has(datei))
    .flatMap(([datei, regeln]) => Object.entries(regeln ?? {}).map(([regel, wert]) => ({ datei, pruefung: ESLINT, regel, anzahl: Number(wert?.count) || 1 })));
}

async function prueferBefunde(github, dateien) {
  const issues = (await issuesMitLabel(github, PRUEFER_LABEL, "open")).filter(istVomBot);
  const treffer = issues.map(({ title }) => PRUEFER_TITEL.exec(title ?? "")).filter((eintrag) => eintrag && dateien.has(eintrag[2]));
  return treffer.map(([, regel, datei]) => ({ datei, pruefung: PRUEFER, regel, anzahl: 1 }));
}

function eintrag(datei, liste, { root, aenderungen }) {
  const zahl = aenderungen.get(datei) ?? 0;
  const pfad = join(root, datei);
  const groesse = CODE.test(datei) && lstatSync(pfad).isFile() ? umfang(readFileSync(pfad, "utf8")) : 0;
  const pruefungen = [...new Set(liste.map(({ pruefung }) => pruefung))].sort();
  const befunde = liste.reduce((summe, { anzahl }) => summe + anzahl, 0);
  return { datei, befunde, pruefungen, aenderungen: zahl, umfang: groesse, brennpunkt: zahl * groesse };
}

function vorrang(links, rechts) {
  return rechts.brennpunkt - links.brennpunkt || rechts.befunde - links.befunde || links.datei.localeCompare(rechts.datei);
}

export function rangliste({ befunde, dateien, root, aenderungen }) {
  const jeDatei = new Map([...dateien].filter((datei) => CODE.test(datei)).map((datei) => [datei, []]));
  for (const befund of befunde) jeDatei.set(befund.datei, [...(jeDatei.get(befund.datei) ?? []), befund]);
  return [...jeDatei].map(([datei, liste]) => eintrag(datei, liste, { root, aenderungen })).sort(vorrang);
}

export function lintVorschlaege(befunde) {
  const jeRegel = new Map();
  for (const { pruefung, regel, datei } of befunde) {
    if (pruefung === PRUEFER && KATALOG_ID.test(regel)) jeRegel.set(regel, new Set([...(jeRegel.get(regel) ?? []), datei]));
  }
  const wiederkehrend = [...jeRegel].filter(([, liste]) => liste.size >= WIEDERKEHREND);
  return wiederkehrend.map(([regel, liste]) => ({ regel, dateien: liste.size })).sort((links, rechts) => rechts.dateien - links.dateien || links.regel.localeCompare(rechts.regel));
}

export async function durchgang({ github, root }) {
  const dateien = new Set(gitZeilen(["ls-files"], root).filter((datei) => existsSync(join(root, datei))));
  const befunde = [...basisBefunde(root, dateien), ...eslintBefunde(root, dateien), ...(await prueferBefunde(github, dateien))];
  return { befunde, rangliste: rangliste({ befunde, dateien, root, aenderungen: aenderungenJeDatei(root) }), vorschlaege: lintVorschlaege(befunde) };
}
