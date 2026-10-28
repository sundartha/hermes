import { test } from "node:test";

import { auslagerung, datei, istKeineReineAuslagerung, istReineAuslagerung, weitergereicht } from "./auslagerung-hilfen.js";

const KOPF = 'import { einordnen } from "./zahl.js";';
const PRUEFEN = 'export function pruefen(wert) {\n  return einordnen(wert) === "negativ" ? "aus" : "an";\n}';

function mitZustand(context, { namen, deklaration, funktion }) {
  return auslagerung(context, {
    vorher: datei(KOPF, deklaration, funktion, PRUEFEN),
    nachher: datei(KOPF, weitergereicht(namen), PRUEFEN),
    neu: datei(deklaration, funktion),
  });
}

test("Auslagerung und veränderlicher Zustand: eine nicht eingefrorene leere Liste samt der Funktion, die sie füllt, ist keine reine Auslagerung, in der Planung der Mutationsprüfung und in der Vorbereitung", (context) => {
  const repo = mitZustand(context, {
    namen: "fehler, melden",
    deklaration: "export const fehler = [];",
    funktion: "export function melden(text) {\n  fehler.push(text);\n}",
  });
  istKeineReineAuslagerung(context, repo);
});

test("Auslagerung und veränderlicher Zustand: ein nicht eingefrorenes Objekt samt der Funktion, die es zählt, ist keine reine Auslagerung", (context) => {
  const repo = mitZustand(context, {
    namen: "zaehler, zaehle",
    deklaration: "export const zaehler = { stand: 0 };",
    funktion: "export function zaehle() {\n  zaehler.stand += 1;\n}",
  });
  istKeineReineAuslagerung(context, repo);
});

test("Auslagerung und veränderlicher Zustand: eine nicht eingefrorene Liste mit festen Werten ist keine reine Auslagerung, auch wenn niemand sie ändert", (context) => {
  const repo = mitZustand(context, {
    namen: "ERLAUBT, erlaubt",
    deklaration: 'export const ERLAUBT = ["an", "aus"];',
    funktion: "export function erlaubt(wert) {\n  return ERLAUBT.includes(wert);\n}",
  });
  istKeineReineAuslagerung(context, repo);
});

test("Auslagerung und veränderlicher Zustand: eine eingefrorene Liste samt der Funktion, die sie liest, bleibt eine reine Auslagerung", (context) => {
  const repo = mitZustand(context, {
    namen: "ERLAUBT, erlaubt",
    deklaration: 'export const ERLAUBT = Object.freeze(["an", "aus"]);',
    funktion: "export function erlaubt(wert) {\n  return ERLAUBT.includes(wert);\n}",
  });
  istReineAuslagerung(context, repo);
});

test("Auslagerung und veränderlicher Zustand: eine nicht eingefrorene Liste in einem eingefrorenen Objekt ist keine reine Auslagerung, denn Object.freeze friert nur die erste Ebene ein", (context) => {
  const repo = mitZustand(context, {
    namen: "GRENZEN, oben",
    deklaration: "export const GRENZEN = Object.freeze({ unten: 0, stufen: [0, 1] });",
    funktion: "export function oben() {\n  return GRENZEN.stufen.at(-1);\n}",
  });
  istKeineReineAuslagerung(context, repo);
});

test("Auslagerung und veränderlicher Zustand: ein nicht eingefrorenes Objekt in einer eingefrorenen Liste ist keine reine Auslagerung", (context) => {
  const repo = mitZustand(context, {
    namen: "REGELN, erste",
    deklaration: "export const REGELN = Object.freeze([{ name: 1 }]);",
    funktion: "export function erste() {\n  return REGELN[0];\n}",
  });
  istKeineReineAuslagerung(context, repo);
});

test("Auslagerung und veränderlicher Zustand: eine eingefrorene Liste in einem eingefrorenen Objekt bleibt eine reine Auslagerung", (context) => {
  const repo = mitZustand(context, {
    namen: "GRENZEN, oben",
    deklaration: "export const GRENZEN = Object.freeze({ unten: 0, stufen: Object.freeze([0, 1]) });",
    funktion: "export function oben() {\n  return GRENZEN.stufen.at(-1);\n}",
  });
  istReineAuslagerung(context, repo);
});
