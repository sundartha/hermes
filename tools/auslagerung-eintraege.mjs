import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ESLint } from "eslint";

import { aufDerBasis } from "./abhaengigkeiten/bestaende.mjs";
import { reineQuellauslagerung } from "./mutationspruefung/quellauslagerung.mjs";

export const UNTERDRUECKUNGEN = "eslint-suppressions.json";
export const ALTVERSTOESSE = ".dependency-cruiser-known-violations.json";
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
