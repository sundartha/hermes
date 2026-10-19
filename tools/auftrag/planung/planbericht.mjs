import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pid } from "node:process";

import { BELEGE } from "../bericht.mjs";
import { reihenfolge } from "../format.mjs";
import { transkriptVerzeichnis, transkripteDerSitzung } from "../kosten.mjs";
import { istObjekt, liste } from "./erkundung.mjs";
import { fortsetzungen, messeDatei } from "./messung.mjs";

const PLANUNGSBERICHT = "planung.json";
const MS_JE_SEKUNDE = 1000;
const JSON_EINRUECKUNG = 2;
const NICHT_GEMESSEN = "nicht gemessen";
const KEINE_SCHNITTLISTE = "keine Schnittliste";
const PLANER = "planer";
const FUNKTIONEN = new Set(["funktion", "fehlerbehebung"]);

function sekunden(ms) {
  return Math.round(ms / MS_JE_SEKUNDE);
}

function protokoll(root, sitzung) {
  if (sitzung === undefined) return null;
  const [haupt] = transkripteDerSitzung(transkriptVerzeichnis(root), sitzung);
  return haupt !== undefined && existsSync(haupt) ? haupt : null;
}

function planerZusatz(datei, dauerS) {
  const jeFortsetzung = fortsetzungen(datei);
  const pausen = jeFortsetzung.reduce((summe, { pauseS }) => summe + pauseS, 0);
  return { fortsetzungen: jeFortsetzung, aktiveZeitS: dauerS - pausen };
}

function gemessen(root, wer) {
  const datei = protokoll(root, wer.sitzung);
  if (datei === null) return { dauerS: NICHT_GEMESSEN, schritte: NICHT_GEMESSEN, groessterKontext: NICHT_GEMESSEN, token: NICHT_GEMESSEN, werkzeugZeichen: NICHT_GEMESSEN };
  const { dauerMs, schritte, groessterKontext, token, werkzeugZeichen } = messeDatei(datei);
  const dauerS = sekunden(dauerMs);
  const zusatz = wer.rolle === PLANER ? planerZusatz(datei, dauerS) : {};
  return { dauerS, schritte, groessterKontext, token, werkzeugZeichen, ...zusatz };
}

function beteiligter(root, wer) {
  const eintrag = { rolle: wer.rolle, sitzung: wer.sitzung ?? null, aufrufe: wer.aufrufe, laufzeitS: sekunden(wer.laufzeitMs), ...gemessen(root, wer) };
  if (wer.rolle === PLANER && eintrag.fortsetzungen === undefined) return { ...eintrag, fortsetzungen: NICHT_GEMESSEN, aktiveZeitS: NICHT_GEMESSEN };
  return eintrag;
}

function summeDerToken(beteiligte) {
  const zahlen = beteiligte.map(({ token }) => token).filter(Number.isFinite);
  return zahlen.length === 0 ? NICHT_GEMESSEN : zahlen.reduce((summe, token) => summe + token, 0);
}

function istAltfunktionUmbau(auftrag) {
  return auftrag.art === "umbau" && liste(auftrag.altfunktionen).length > 0;
}

function arten(auftraege) {
  const altUmbauten = auftraege.filter(istAltfunktionUmbau);
  const jeDatei = {};
  for (const umbau of altUmbauten) {
    for (const datei of new Set(liste(umbau.altfunktionen).map((alt) => alt?.datei))) jeDatei[datei] = (jeDatei[datei] ?? 0) + 1;
  }
  return {
    funktionen: auftraege.filter(({ art }) => FUNKTIONEN.has(art)).length,
    umbauten: auftraege.filter(({ art }) => art === "umbau").length - altUmbauten.length,
    altfunktionUmbauten: altUmbauten.length,
    altfunktionUmbautenJeDatei: jeDatei,
  };
}

function auftraegeDes(schnitt) {
  const auftraege = liste(schnitt?.auftraege);
  if (auftraege.length === 0) return KEINE_SCHNITTLISTE;
  const mitIds = auftraege.filter(istObjekt).map((auftrag) => ({ ...auftrag, abhaengigVon: liste(auftrag.abhaengigVon).map((abhaengig) => abhaengig?.id) }));
  const { ordnung } = reihenfolge(mitIds);
  const gueltige = (ordnung.length > 0 ? ordnung : mitIds).map(({ id, art, ziel, bereich, prueft }) => ({ id, art, ziel, bereich, prueft }));
  return [...gueltige, ...auftraege.filter((auftrag) => !istObjekt(auftrag)).map((auftrag) => ({ ungueltig: JSON.stringify(auftrag) }))];
}

export function annahmeText({ auftrag, nummer, text }) {
  return `Annahme ${auftrag ?? nummer ?? "der Planung"}: ${text}`;
}

export function planBericht(lauf, { root, team }) {
  const beteiligte = team.beteiligte.map((wer) => beteiligter(root, wer));
  return {
    phase: team.phase,
    exit: lauf.exit,
    grund: lauf.grund,
    auftraege: auftraegeDes(lauf.schnitt),
    annahmen: lauf.annahmen.map(annahmeText),
    fehlendeSzenarien: liste(lauf.schnitt?.fehlendeSzenarien),
    ownerAufgaben: liste(lauf.schnitt?.ownerAufgaben),
    befunde: lauf.befunde,
    ruecksendungen: team.ruecksendungen,
    netzabbrueche: team.netzabbrueche,
    schleifen: liste(lauf.schleifen),
    nachpruefungen: liste(lauf.nachpruefungen),
    wegpruefungen: liste(lauf.wegpruefungen),
    beteiligte,
    laufzeitS: sekunden(Date.now() - lauf.beginn),
    token: summeDerToken(beteiligte),
    arten: arten(liste(lauf.schnitt?.auftraege).filter(istObjekt)),
  };
}

export function schreibePlanBericht(root, bericht) {
  const verzeichnis = join(root, BELEGE, bericht.phase);
  mkdirSync(verzeichnis, { recursive: true });
  const ziel = join(verzeichnis, PLANUNGSBERICHT);
  const zwischen = `${ziel}.${pid}.tmp`;
  writeFileSync(zwischen, `${JSON.stringify(bericht, null, JSON_EINRUECKUNG)}\n`);
  renameSync(zwischen, ziel);
  return ziel;
}

function auftragsZeile({ id, ziel, bereich, prueft, ungueltig }) {
  if (ungueltig !== undefined) return `ungültig\t${ungueltig}`;
  return [id, ziel, bereich, Array.isArray(prueft) ? prueft.join(", ") : prueft].join("\t");
}

function auftragsZeilen(auftraege) {
  if (!Array.isArray(auftraege)) return [`Aufträge: ${auftraege}`];
  return ["Aufträge:", ...auftraege.map(auftragsZeile)];
}

function befundZeilen({ offen, korrigiert, zurueckgewiesen }) {
  return [
    ...offen.map((befund) => `offen: ${befund}`),
    ...korrigiert.map(({ schluessel, befund, antwort }) => `korrigiert ${schluessel}: ${befund} | ${antwort}`),
    ...zurueckgewiesen.map(({ schluessel, befund, antwort }) => `zurückgewiesen ${schluessel}: ${befund} | ${antwort}`),
  ];
}

function beteiligtenZeile({ rolle, sitzung, laufzeitS, dauerS, aktiveZeitS, schritte, groessterKontext, token, werkzeugZeichen }) {
  const aktiv = aktiveZeitS === undefined ? [] : [`aktiv ${aktiveZeitS} s`];
  return [rolle, sitzung, `Laufzeit ${laufzeitS} s`, `Dauer ${dauerS} s`, ...aktiv, `${schritte} Schritte`, `Kontext ${groessterKontext}`, `${token} Token`, `${werkzeugZeichen} Werkzeugzeichen`].join("\t");
}

export function druckePlanBericht(bericht, pfad) {
  const zeilen = [
    "",
    `Planung ${bericht.phase}: Exit ${bericht.exit}, ${bericht.grund}`,
    ...auftragsZeilen(bericht.auftraege),
    ...bericht.annahmen,
    ...befundZeilen(bericht.befunde),
    `Rücksendungen: ${JSON.stringify(bericht.ruecksendungen)}`,
    `Schleifen: ${JSON.stringify(bericht.schleifen)}`,
    `Nachprüfungen: ${JSON.stringify(bericht.nachpruefungen)}`,
    `Wegprüfungen: ${JSON.stringify(bericht.wegpruefungen)}`,
    ...bericht.beteiligte.map(beteiligtenZeile),
    `Laufzeit ${bericht.laufzeitS} s, ${bericht.token} Token, Arten ${JSON.stringify(bericht.arten)}`,
    `Bericht: ${pfad}`,
  ];
  console.log(zeilen.join("\n"));
}
