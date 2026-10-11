import { readFileSync } from "node:fs";

import { PRUEFARTEN } from "./bewertung.mjs";

const NAME = /^[\da-z-]+$/;
const MIN_ZUEGE = 1;
const MAX_ZUEGE = 50;
const LEER = /^\s*$/;

function datei(pfad) {
  try {
    return JSON.parse(readFileSync(pfad, "utf8"));
  } catch {
    throw new Error(`die Falldatei ${pfad} fehlt oder kein gültiges JSON enthält`);
  }
}

function text(wert) {
  return typeof wert === "string" && !LEER.test(wert);
}

function pruefungFehler(pruefung) {
  if (!PRUEFARTEN.includes(pruefung?.art)) return `unbekannte Prüfart „${pruefung?.art}“`;
  if (pruefung.art !== "nie-sagen") return null;
  const werte = pruefung.werte;
  return Array.isArray(werte) && werte.length > 0 && werte.every(text)
    ? null
    : "„nie-sagen“ ohne Werte";
}

function zuegeFehler(zuege) {
  return Number.isInteger(zuege) && zuege >= MIN_ZUEGE && zuege <= MAX_ZUEGE
    ? null
    : `max_zuege muss eine ganze Zahl von ${MIN_ZUEGE} bis ${MAX_ZUEGE} sein`;
}

function fallFehler(fall) {
  const pruefungen = fall.pruefungen ?? [];
  const bewerter = fall.bewerter ?? [];
  const fehler = [
    NAME.test(fall.name ?? "") ? null : "Name fehlt oder enthält andere Zeichen als a-z, 0-9, -",
    text(fall.szenario) ? null : "Szenario fehlt",
    zuegeFehler(fall.max_zuege),
    pruefungen.length + bewerter.length > 0 ? null : "weder Prüfung noch Bewerter",
    bewerter.every(text) ? null : "leerer Bewerter-Satz",
    ...pruefungen.map(pruefungFehler),
  ];
  return fehler.filter(Boolean).map((grund) => `Fall ${fall.name ?? "?"}: ${grund}`);
}

export function ladeFaelle(festePfad, weitere) {
  const fest = datei(festePfad);
  const quellen = [fest, ...weitere.map(datei)];
  const faelle = quellen.flatMap((quelle) =>
    (quelle.faelle ?? []).map((fall) => ({
      ...fall,
      variablen: { ...fest.variablen, ...quelle.variablen },
    })),
  );
  const namen = faelle.map((fall) => fall.name);
  const doppelt = namen.filter((name, stelle) => namen.indexOf(name) !== stelle);
  const fehler = [
    ...faelle.flatMap(fallFehler),
    ...doppelt.map((name) => `Fall ${name} steht mehrfach`),
  ];
  if (faelle.length === 0) fehler.push("keine Fälle");
  if (fehler.length > 0) throw new Error(`die Fälle ungültig sind: ${fehler.join("; ")}`);
  return faelle;
}

export function variablenVon(fall) {
  const { background = "", ...rest } = fall.variablen;
  const zusatz = fall.hintergrund_zusatz;
  return zusatz ? { ...rest, background: `${background}\n${zusatz}` } : fall.variablen;
}
