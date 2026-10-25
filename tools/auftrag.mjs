import { cwd } from "node:process";
import { parseArgs } from "node:util";

import { ROLLEN, genutzt, grenzen, pruefe, rot } from "./auftrag/befehle.mjs";
import { faelle } from "./auftrag/faelle.mjs";
import { importendungen } from "./auftrag/importendungen.mjs";
import { lauf } from "./auftrag/lauf.mjs";
import { testumbauFaelle } from "./auftrag/testumbau.mjs";
import { karte } from "./auftrag/planung/karte.mjs";
import { kette } from "./auftrag/planung/kette-befehl.mjs";
import { messung } from "./auftrag/planung/messung.mjs";
import { plane } from "./auftrag/planung/plane.mjs";
import { schnittBefehl } from "./auftrag/planung/schnitt.mjs";
import { dateien, suche } from "./auftrag/planung/suche.mjs";
import { umfangBefehl } from "./auftrag/planung/umfang.mjs";
import { aufraeumen, phase } from "./auftrag/phase.mjs";
import { PRUEFER_OPTIONEN, pruefer } from "./auftrag/pruefer-befehle.mjs";
import { reparatur } from "./auftrag/reparatur.mjs";
import { system } from "./auftrag/system.mjs";
import { zeigePrompt } from "./auftrag/zeige-prompt.mjs";

const EXIT_ABBRUCH = 1;
const EXIT_AUFRUF = 2;
const AUFRUF = [
  "Aufruf: node tools/auftrag.mjs pruefe <phasendatei>",
  "        node tools/auftrag.mjs lauf <phasendatei>",
  "        node tools/auftrag.mjs teillauf <phasendatei>",
  "        node tools/auftrag.mjs rot <phasendatei> <auftrag>",
  "        node tools/auftrag.mjs grenzen <phasendatei> <auftrag> --rolle <test|bau> --basis <commit>",
  "        node tools/auftrag.mjs genutzt <phasendatei> <auftrag> --basis <commit>",
  "        node tools/auftrag.mjs zeige-prompt <phasendatei> <auftrag> --rolle <test|bau> [--testausgabe <datei>]   (gibt den Prompt aus, den der Agent im Lauf bekommt, ohne Zusätze aus Bisektion und späteren Runden; startet nichts, schreibt nichts)",
  "        node tools/auftrag.mjs faelle --basis <commit>",
  "        node tools/auftrag.mjs testumbau --basis <commit>",
  "        node tools/auftrag.mjs importendungen --basis <commit>",
  "        node tools/auftrag.mjs phase <phasendatei>",
  "        node tools/auftrag.mjs aufraeumen",
  "        node tools/auftrag.mjs pruefer artefakt --head <sha>",
  "        node tools/auftrag.mjs pruefer pruefen --head <sha> --pr-branch <branch> [--pr-repo <owner/name>] --aus <ordner> [--ablage <ordner>]",
  "        node tools/auftrag.mjs pruefer nachstellen --ergebnis <ordner> --pr <ordner> --basis <ordner> --aus <ordner>",
  "        node tools/auftrag.mjs pruefer entscheiden --ergebnis <ordner> [--nachstellung <ordner>] [--head <sha>]",
  "        node tools/auftrag.mjs pruefer ablegen --ablage <ordner> --repo <owner/name>",
  "        node tools/auftrag.mjs reparatur --ergebnis <ordner> --nachstellung <ordner>",
  "        node tools/auftrag.mjs system",
  "        node tools/auftrag.mjs karte <datei> [--json]",
  "        node tools/auftrag.mjs messung <protokoll.jsonl> [--json]",
  "        node tools/auftrag.mjs schnitt plaene/P-<Nummer>-<kurzname>/",
  "        node tools/auftrag.mjs umfang plaene/P-<Nummer>-<kurzname>/   (misst Nummern, belegte Dateien, Funktionen und Tests des Pitches als JSON, mit „## Löschen“ im Pitch auch die Löschmenge; startet nichts, schreibt nichts)",
  "        node tools/auftrag.mjs plane plaene/P-<Nummer>-<kurzname>/ [--fortsetzen] [--deckel <Token>] [--issue <Nummer>]   (mit --fortsetzen ist --deckel das Gesamtbudget der Planung einschließlich früherer Läufe)",
  "        node tools/auftrag.mjs suche [--] <muster> [<pfad> …]",
  "        node tools/auftrag.mjs dateien [--] [<pfad> …]",
  "        node tools/auftrag.mjs kette <datei:funktion> <datei:funktion>   (gibt die belegte Aufrufkette zwischen zwei Funktionen unter src/ mit Datei und Zeilen aus, sonst „kein Pfad belegt“ mit Exit 1; schreibt nichts)",
].join("\n");
const SCHALTER = ["json", "fortsetzen"];
const OPTIONEN = [
  "rolle",
  "basis",
  "head",
  "pr-branch",
  "pr-repo",
  "aus",
  "ergebnis",
  "pr",
  "nachstellung",
  "ablage",
  "repo",
  "deckel",
  "issue",
  "testausgabe",
];

const BEFEHLE = {
  pruefe: { argumente: 1, fuehreAus: ([phasendatei], root) => pruefe(phasendatei, root) },
  lauf: { argumente: 1, fuehreAus: ([phasendatei], root) => lauf(phasendatei, root) },
  teillauf: { argumente: 1, fuehreAus: ([phasendatei], root) => lauf(phasendatei, root, { amPhasenende: false }) },
  phase: { argumente: 1, fuehreAus: ([phasendatei], root) => phase(phasendatei, root) },
  aufraeumen: { argumente: 0, fuehreAus: (keine, root) => aufraeumen(root) },
  rot: { argumente: 2, fuehreAus: ([phasendatei, kennung], root) => rot(phasendatei, kennung, root) },
  grenzen: {
    argumente: 2,
    optionen: ["rolle", "basis"],
    fuehreAus: ([phasendatei, kennung], root, { rolle, basis }) =>
      grenzen(phasendatei, kennung, { rolle, basis, root }),
  },
  genutzt: { argumente: 2, optionen: ["basis"], fuehreAus: ([phasendatei, kennung], root, { basis }) => genutzt(phasendatei, kennung, { basis, root }) },
  "zeige-prompt": {
    argumente: 2,
    optionen: ["rolle"],
    fuehreAus: ([phasendatei, kennung], root, { rolle, testausgabe }) => zeigePrompt(phasendatei, kennung, { rolle, testausgabe, root }),
  },
  faelle: { argumente: 0, optionen: ["basis"], fuehreAus: (keine, root, { basis }) => faelle({ basis, root }) },
  testumbau: { argumente: 0, optionen: ["basis"], fuehreAus: (keine, root, { basis }) => testumbauFaelle({ basis, root }) },
  importendungen: { argumente: 0, optionen: ["basis"], fuehreAus: (keine, root, { basis }) => importendungen({ basis, root }) },
  pruefer: {
    argumente: 1,
    optionen: ([art]) => PRUEFER_OPTIONEN.get(art),
    fuehreAus: ([art], root, optionen) => pruefer(art, optionen, root),
  },
  reparatur: {
    argumente: 0,
    optionen: ["ergebnis", "nachstellung"],
    fuehreAus: (keine, root, optionen) => reparatur(optionen, root),
  },
  system: { argumente: 0, fuehreAus: () => system() },
  karte: { argumente: 1, schalter: ["json"], fuehreAus: ([datei], root, { json }) => karte(datei, root, { json }) },
  messung: { argumente: 1, schalter: ["json"], fuehreAus: ([datei], root, { json }) => messung(datei, { json }) },
  schnitt: { argumente: 1, fuehreAus: ([ordner], root) => schnittBefehl(ordner, root) },
  umfang: { argumente: 1, fuehreAus: ([ordner], root) => umfangBefehl(ordner, root) },
  plane: { argumente: 1, schalter: ["fortsetzen"], fuehreAus: ([ordner], root, { fortsetzen, deckel, issue }) => plane(ordner, root, { fortsetzen, deckel, issue }) },
  suche: { mindestens: 1, fuehreAus: (argumente, root) => suche(argumente, root) },
  dateien: { mindestens: 0, fuehreAus: (pfade, root) => dateien(pfade, root) },
  kette: { argumente: 2, fuehreAus: (stellen, root) => kette(stellen, root) },
};

function gelesen() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: { ...Object.fromEntries(OPTIONEN.map((name) => [name, { type: "string" }])), ...Object.fromEntries(SCHALTER.map((name) => [name, { type: "boolean" }])) },
    });
  } catch {
    return { positionals: [], values: {} };
  }
}

function pflichtOptionen(befehl, argumente) {
  return typeof befehl.optionen === "function"
    ? befehl.optionen(argumente)
    : (befehl.optionen ?? []);
}

function passendeZahl(befehl, argumente) {
  return befehl.mindestens === undefined ? argumente.length === befehl.argumente : argumente.length >= befehl.mindestens;
}

function aufruf() {
  const { positionals, values } = gelesen();
  const [name, ...argumente] = positionals;
  const befehl = BEFEHLE[name];
  if (!Object.hasOwn(BEFEHLE, name ?? "") || !passendeZahl(befehl, argumente)) return null;
  const pflicht = pflichtOptionen(befehl, argumente);
  const fehlend = pflicht === undefined || pflicht.some((option) => values[option] === undefined);
  if (SCHALTER.some((name) => values[name] !== undefined && !(befehl.schalter ?? []).includes(name))) return null;
  if (fehlend || (values.rolle !== undefined && !ROLLEN.includes(values.rolle))) return null;
  return { befehl, argumente, optionen: values };
}

const gewaehlt = aufruf();
if (gewaehlt === null) {
  console.error(AUFRUF);
  process.exitCode = EXIT_AUFRUF;
} else {
  try {
    process.exitCode = await gewaehlt.befehl.fuehreAus(gewaehlt.argumente, cwd(), gewaehlt.optionen);
  } catch (fehler) {
    console.error(`Abbruch: ${fehler.message}`);
    process.exitCode = EXIT_ABBRUCH;
  }
}
