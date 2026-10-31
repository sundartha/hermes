import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ESLint } from "eslint";

import { aufDerBasis } from "./abhaengigkeiten/bestaende.mjs";
import { aenderungenSeit, dateiAm, gibtEsIn } from "./auftrag/git.mjs";
import { TOOLS } from "./basis-vergleich.mjs";
import { gezaehlt, kontingent } from "./eslint-rules/bestand.js";
import { reineQuellauslagerung } from "./mutationspruefung/quellauslagerung.mjs";

export const UNTERDRUECKUNGEN = "eslint-suppressions.json";
export const ALTVERSTOESSE = ".dependency-cruiser-known-violations.json";
export const KOPIEN = "tools/basis/jscpd.json";
const KOPIEN_KONFIGURATION = ".jscpd.json";
const LEERE_UNTERDRUECKUNGEN = "eslint-suppressions.empty.json";
const FEHLER = 2;
const EINRUECKUNG = 2;

async function gleicheRegeln(eslint, { root, hilfe }, neu) {
  const [vorher, nachher] = await Promise.all([hilfe, neu].map((pfad) => eslint.calculateConfigForFile(join(root, pfad))));
  return isDeepStrictEqual(vorher.rules, nachher.rules);
}

export async function auslagerungsHerkunft({ von, bis }, root) {
  const auslagerung = await reineQuellauslagerung({ von, bis }, root);
  if (auslagerung === null) return new Map();
  const eslint = new ESLint({ cwd: root });
  const gleich = await Promise.all(auslagerung.neue.map((neu) => gleicheRegeln(eslint, { root, hilfe: auslagerung.hilfe }, neu)));
  return new Map(auslagerung.neue.filter((_neu, stelle) => gleich[stelle]).map((neu) => [neu, auslagerung.hilfe]));
}

export function fehlerJeRegel(meldungen) {
  const anzahl = new Map();
  for (const { ruleId, severity, suppressions } of meldungen)
    if (severity === FEHLER && suppressions === undefined) anzahl.set(ruleId, (anzahl.get(ruleId) ?? 0) + 1);
  return anzahl;
}

async function befundeDer(root, pfad) {
  const eslint = new ESLint({ cwd: root, suppressionsLocation: join(root, LEERE_UNTERDRUECKUNGEN) });
  const [ergebnis] = await eslint.lintFiles([join(root, pfad)]);
  return fehlerJeRegel(ergebnis?.messages ?? []);
}

function geordnet(liste) {
  return Object.fromEntries(Object.keys(liste).sort().map((datei) => [datei, Object.fromEntries(Object.keys(liste[datei]).sort().map((regel) => [regel, liste[datei][regel]]))]));
}

function umgezogen(liste, { hilfe, neu, befunde }) {
  const rest = { ...liste[hilfe] };
  const eintrag = {};
  for (const [regel, { count }] of Object.entries(liste[hilfe] ?? {})) {
    const anzahl = Math.min(befunde.get(regel) ?? 0, count);
    if (anzahl === 0) continue;
    eintrag[regel] = { count: anzahl };
    if (count === anzahl) delete rest[regel];
    else rest[regel] = { count: count - anzahl };
  }
  const andere = Object.fromEntries(Object.entries(liste).filter(([datei]) => datei !== hilfe));
  return { ...andere, ...(Object.keys(rest).length > 0 ? { [hilfe]: rest } : {}), ...(Object.keys(eintrag).length > 0 ? { [neu]: eintrag } : {}) };
}

export async function listeNachAuslagerung(vorher, herkunft, root) {
  let liste = vorher;
  for (const [neu, hilfe] of herkunft) {
    if (liste[neu] !== undefined) return undefined;
    liste = umgezogen(liste, { hilfe, neu, befunde: await befundeDer(root, neu) });
  }
  return liste;
}

export async function unterdrueckungenAusgelagert({ basis, root }) {
  const pfad = join(root, UNTERDRUECKUNGEN);
  if (!existsSync(pfad)) return undefined;
  const herkunft = await auslagerungsHerkunft({ von: basis }, root);
  const text = readFileSync(pfad, "utf8");
  const vorher = JSON.parse(text);
  const liste = await listeNachAuslagerung(vorher, herkunft, root);
  if (liste === undefined || isDeepStrictEqual(liste, vorher)) return undefined;
  const anzahl = [...herkunft.keys()].flatMap((neu) => Object.values(liste[neu] ?? {})).reduce((summe, { count }) => summe + count, 0);
  return { neu: JSON.stringify(geordnet(liste), null, EINRUECKUNG), anzahl };
}

function kopieFuer(eintrag, neu, importe) {
  const treffer = importe.find(({ ziel }) => ziel === eintrag.to);
  if (treffer === undefined) return [];
  return [{ ...eintrag, from: neu, ...(eintrag.unresolvedTo === undefined ? {} : { unresolvedTo: treffer.quelle }) }];
}

export function altverstoesseDerNeuen(auslagerung, eintraege) {
  if (auslagerung === null) return [];
  const alte = eintraege.filter(({ type, from }) => type === "dependency" && from === auslagerung.hilfe);
  return alte.flatMap((eintrag) => auslagerung.neue.flatMap((neu) => kopieFuer(eintrag, neu, auslagerung.importe[neu] ?? [])));
}

const SCHLUESSELTRENNER = "\0";

export function altverstossSchluessel({ rule, from, to }) {
  return [rule.name, from, to].join(SCHLUESSELTRENNER);
}

export async function altverstoesseAusgelagert({ basis, root }) {
  const pfad = join(root, ALTVERSTOESSE);
  if (!existsSync(pfad)) return undefined;
  const auslagerung = await reineQuellauslagerung({ von: basis }, root);
  const kopien = altverstoesseDerNeuen(auslagerung, aufDerBasis(basis, ALTVERSTOESSE) ?? []);
  const liste = JSON.parse(readFileSync(pfad, "utf8"));
  const vorhanden = new Set(liste.map(altverstossSchluessel));
  const neue = kopien.filter((kopie) => !vorhanden.has(altverstossSchluessel(kopie)));
  if (neue.length === 0) return undefined;
  const stelle = liste.findLastIndex(({ from }) => from === auslagerung.hilfe) + 1;
  return { neu: `${JSON.stringify([...liste.slice(0, stelle), ...neue, ...liste.slice(stelle)], null, EINRUECKUNG)}\n`, anzahl: neue.length };
}

function umzugVon(alt, fund, { unveraendert, neueDatei, stammtAus }) {
  const gemeinsam = alt.dateien.filter((datei) => fund.dateien.includes(datei));
  if (gemeinsam.length !== 1 || new Set(fund.dateien).size === 1) return undefined;
  const [partner] = gemeinsam;
  const [von] = alt.dateien.filter((datei) => datei !== partner);
  const [nach] = fund.dateien.filter((datei) => datei !== partner);
  return unveraendert(partner) && neueDatei(nach) && stammtAus(fund.ort, { von, nach }) ? fund.key : undefined;
}

export function listeMitErsatz(liste, ersatz) {
  if (ersatz.size === 0) return undefined;
  return { neu: liste.map((eintrag, stelle) => ersatz.get(stelle) ?? eintrag).toSorted(), anzahl: ersatz.size };
}

export function kopienNachUmzug({ liste, aktuell, pruefen }) {
  const { covered, keys } = TOOLS.jscpd.shrunk(aktuell, liste, () => false);
  const gedeckt = kontingent(gezaehlt(keys));
  const offen = liste.flatMap((eintrag, stelle) => (gedeckt(eintrag) ? [] : [{ stelle, dateien: TOOLS.jscpd.pair(eintrag), tokens: TOOLS.jscpd.tokens(eintrag) }]));
  const funde = aktuell.filter((fund) => !covered.includes(fund)).map(({ key, ort }) => ({ key, ort, dateien: TOOLS.jscpd.pair(key), tokens: TOOLS.jscpd.tokens(key) }));
  const ersatz = new Map();
  for (const fund of funde) {
    const passend = offen.flatMap((alt) => {
      const schluessel = ersatz.has(alt.stelle) || alt.tokens < fund.tokens ? undefined : umzugVon(alt, fund, pruefen);
      return schluessel === undefined ? [] : [{ alt, schluessel }];
    });
    const [kleinster] = passend.toSorted((links, rechts) => links.alt.tokens - rechts.alt.tokens);
    if (kleinster !== undefined) ersatz.set(kleinster.alt.stelle, kleinster.schluessel);
  }
  return listeMitErsatz(liste, ersatz);
}

const KOPIEN_ORT = /^(?<ersteDatei>[^:]+):(?<ersteVon>\d+)-(?<ersteBis>\d+) gleicht (?<zweiteDatei>[^:]+):(?<zweiteVon>\d+)-(?<zweiteBis>\d+) \(/;
const LEERRAUM = /\s+/g;
const VORSPANN = /^\s*export\b\s*/;

export function kopienOrt(location) {
  const gruppen = KOPIEN_ORT.exec(location)?.groups;
  if (gruppen === undefined) return new Map();
  const stelle = (von, bis) => ({ von: Number(gruppen[von]), bis: Number(gruppen[bis]) });
  return new Map([
    [gruppen.ersteDatei, stelle("ersteVon", "ersteBis")],
    [gruppen.zweiteDatei, stelle("zweiteVon", "zweiteBis")],
  ]);
}

function ohneLeerraum(text) {
  return text.replace(LEERRAUM, "");
}

export function stammtAusAltemText(neuerText, alterText) {
  const gesucht = ohneLeerraum(neuerText.replace(VORSPANN, ""));
  return alterText !== null && gesucht !== "" && ohneLeerraum(alterText).includes(gesucht);
}

export function geklonterText(text, ort, datei) {
  const stelle = ort.get(datei);
  return stelle === undefined ? "" : text.split("\n").slice(stelle.von - 1, stelle.bis).join("\n");
}

export async function kopienAusgelagert({ basis, root }) {
  const pfad = join(root, KOPIEN);
  if (!existsSync(pfad)) return undefined;
  const vorher = JSON.parse(readFileSync(pfad, "utf8"));
  if (vorher.version !== TOOLS.jscpd.version()) return undefined;
  const geaendert = new Set(aenderungenSeit(basis, root).map((aenderung) => aenderung.pfad));
  if (geaendert.has(KOPIEN_KONFIGURATION)) return undefined;
  const aktuell = TOOLS.jscpd.findings(root).map(({ key, location }) => ({ key, ort: kopienOrt(location) }));
  const pruefen = {
    unveraendert: (datei) => !geaendert.has(datei),
    neueDatei: (datei) => !gibtEsIn(basis, datei, root),
    stammtAus: (ort, { von, nach }) => stammtAusAltemText(geklonterText(readFileSync(join(root, nach), "utf8"), ort, nach), dateiAm(basis, von, root)),
  };
  const ersetzt = kopienNachUmzug({ liste: vorher.befunde, aktuell, pruefen });
  if (ersetzt === undefined) return undefined;
  const liste = { ...vorher, befunde: ersetzt.neu };
  return { neu: `${JSON.stringify(liste, null, EINRUECKUNG)}\n`, anzahl: ersetzt.anzahl };
}
