import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { istObjekt, istText } from "./erkundung.mjs";
import { gitLauf } from "./git.mjs";
import { DOKUMENTE, SCHNITT } from "./schnitt.mjs";

export const FINGERABDRUCK = "fingerabdruck.json";
export const NACHFRAGEN = "nachfragen.json";
export const GEPRUEFT = "geprueft.json";
const GLIEDERUNG = "gliederung.json";
const TEAM = ["planer", "erkunder", "pruefer-planung", "entwurf"];
const ZUSTAND = ["gesehen", "ausgeschoepft", "wegOffen", "wegpruefungen", "wegZaehler", "wegAusstehend", "erkundungAusstehend"];
const KOPF_BAUM = "HEAD^{tree}";

export function erkundungsDatei(stelle) {
  return `erkundung-g${stelle + 1}.json`;
}

function erkundungsNamen(anzahl) {
  return Array.from({ length: anzahl }, (leer, stelle) => erkundungsDatei(stelle));
}

function ablageNamen(anzahl) {
  return [GLIEDERUNG, NACHFRAGEN, ...erkundungsNamen(anzahl)];
}

function pruefsumme(datei) {
  return existsSync(datei) ? createHash("sha256").update(readFileSync(datei)).digest("hex") : null;
}

function gelesenePfade(root, ordner, kontext) {
  const dokumente = DOKUMENTE.map((name) => relative(root, resolve(ordner, name)));
  const rollen = TEAM.flatMap((rolle) => [`.claude/agents/${rolle}.md`, `.claude/rollen/${rolle}.json`]);
  return [...new Set([...dokumente, ...kontext, ...rollen])].toSorted();
}

export function ausgangsstand(root, ordner, { arbeitsbaum, kontext }) {
  const kopfBaum = gitLauf(root, ["rev-parse", KOPF_BAUM]).stdout.trim();
  const dateien = Object.fromEntries(gelesenePfade(root, ordner, kontext).map((pfad) => [pfad, pruefsumme(join(root, pfad))]));
  return { kopfBaum, arbeitsbaum, dateien };
}

export function fingerabdruck(stand, { ablage, anzahl, zustand }) {
  const summen = Object.fromEntries(ablageNamen(anzahl).map((name) => [name, pruefsumme(join(ablage, name))]));
  return { stand, ablage: summen, zustand };
}

function jsonAus(datei) {
  try {
    return JSON.parse(readFileSync(datei, "utf8"));
  } catch {
    return undefined;
  }
}

function lesbar(abdruck) {
  if (!istObjekt(abdruck) || !istObjekt(abdruck.stand) || !istObjekt(abdruck.ablage) || !istObjekt(abdruck.zustand)) return false;
  const { kopfBaum, arbeitsbaum, dateien } = abdruck.stand;
  const { nachfrageWellen } = abdruck.zustand;
  const wellen = Number.isInteger(nachfrageWellen) && nachfrageWellen >= 0;
  return istText(kopfBaum) && istText(arbeitsbaum) && istObjekt(dateien) && wellen && ZUSTAND.every((name) => Array.isArray(abdruck.zustand[name]));
}

function standGruende(vorher, jetzt) {
  const gruende = [];
  if (vorher.kopfBaum !== jetzt.kopfBaum) gruende.push(`der Repo-Baum (${KOPF_BAUM}) ist ${jetzt.kopfBaum}, beim Ablegen der Erkundung war er ${vorher.kopfBaum}`);
  if (vorher.arbeitsbaum !== jetzt.arbeitsbaum) gruende.push("der Arbeitsbaum ohne planung/ ist ein anderer als beim Ablegen der Erkundung");
  const pfade = [...new Set([...Object.keys(vorher.dateien), ...Object.keys(jetzt.dateien)])].toSorted();
  const geaendert = pfade.filter((pfad) => vorher.dateien[pfad] !== jetzt.dateien[pfad]);
  return [...gruende, ...geaendert.map((pfad) => `${pfad} ist seit dem Ablegen der Erkundung geändert`)];
}

function ablageGruende(ablage, summen) {
  return Object.entries(summen).flatMap(([name, summe]) => {
    const jetzt = pruefsumme(join(ablage, name));
    if (jetzt === null) return [`${name} fehlt in ${ablage}`];
    return jetzt === summe ? [] : [`${name} ist seit dem Ablegen der Erkundung geändert`];
  });
}

function beantworteteWelle(welle) {
  const antworten = Array.isArray(welle?.antworten) && welle.antworten.every((antwort) => istText(antwort?.frage) && Array.isArray(antwort.nummern) && istObjekt(antwort.bericht) && Array.isArray(antwort.befunde));
  return antworten && Array.isArray(welle.enden);
}

function nachfragenAus(ablage, { nachfrageWellen }) {
  const nachfragen = jsonAus(join(ablage, NACHFRAGEN));
  return Array.isArray(nachfragen) && nachfragen.length >= nachfrageWellen && nachfragen.every(beantworteteWelle) ? nachfragen : undefined;
}

function erkundungAus(ablage, abdruck) {
  const gliederung = jsonAus(join(ablage, GLIEDERUNG));
  const anzahl = Array.isArray(gliederung?.gruppen) ? gliederung.gruppen.length : 0;
  if (anzahl === 0 || ablageNamen(anzahl).join("\n") !== Object.keys(abdruck.ablage).join("\n")) return { gruende: [`${FINGERABDRUCK} nennt andere Dateien als ${GLIEDERUNG} verlangt`] };
  const nachfragen = nachfragenAus(ablage, abdruck.zustand);
  if (nachfragen === undefined) return { gruende: [`${NACHFRAGEN} hat nicht die Form der beantworteten Nachfrage-Wellen dieses Fingerabdrucks`] };
  const berichte = erkundungsNamen(anzahl).map((name) => jsonAus(join(ablage, name)));
  return { gruende: [], erkundung: { gliederung, berichte, nachfragen, zustand: abdruck.zustand } };
}

export function liesFortsetzung(ablage, jetzt) {
  const datei = join(ablage, FINGERABDRUCK);
  if (!existsSync(datei)) return { gruende: [`${datei} fehlt; ohne Fingerabdruck der Erkundung setzt plane nicht fort`] };
  const abdruck = jsonAus(datei);
  if (!lesbar(abdruck)) return { gruende: [`${datei} hat nicht die Form eines Fingerabdrucks`] };
  const gruende = [...standGruende(abdruck.stand, jetzt), ...ablageGruende(ablage, abdruck.ablage)];
  return gruende.length > 0 ? { gruende } : erkundungAus(ablage, abdruck);
}

function pruefungsEingaben(ablage) {
  return { erkundung: pruefsumme(join(ablage, FINGERABDRUCK)), schnitt: pruefsumme(join(ablage, SCHNITT)) };
}

export function geprueft(ablage, ergebnis) {
  return { ...pruefungsEingaben(ablage), ...ergebnis };
}

function befundListen(befunde) {
  return istObjekt(befunde) && Array.isArray(befunde.korrigiert) && Array.isArray(befunde.zurueckgewiesen);
}

export function liesGeprueft(ablage) {
  const abdruck = jsonAus(join(ablage, GEPRUEFT));
  const jetzt = pruefungsEingaben(ablage);
  if (!istObjekt(abdruck) || jetzt.erkundung === null || jetzt.schnitt === null) return undefined;
  if (abdruck.erkundung !== jetzt.erkundung || abdruck.schnitt !== jetzt.schnitt) return undefined;
  const schnitt = jsonAus(join(ablage, SCHNITT));
  if (!istObjekt(schnitt) || !befundListen(abdruck.befunde) || !Array.isArray(abdruck.nachpruefungen)) return undefined;
  return { schnitt, befunde: abdruck.befunde, nachpruefungen: abdruck.nachpruefungen };
}
