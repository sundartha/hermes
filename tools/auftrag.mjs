import { cwd } from "node:process";
import { parseArgs } from "node:util";

import { ROLLEN, grenzen, pruefe, rot } from "./auftrag/befehle.mjs";
import { lauf } from "./auftrag/lauf.mjs";
import { aufraeumen, phase } from "./auftrag/phase.mjs";
import { PRUEFER_OPTIONEN, pruefer } from "./auftrag/pruefer-befehle.mjs";
import { reparatur } from "./auftrag/reparatur.mjs";
import { system } from "./auftrag/system.mjs";

const EXIT_ABBRUCH = 1;
const EXIT_AUFRUF = 2;
const AUFRUF = [
  "Aufruf: node tools/auftrag.mjs pruefe <phasendatei>",
  "        node tools/auftrag.mjs lauf <phasendatei>",
  "        node tools/auftrag.mjs rot <phasendatei> <auftrag>",
  "        node tools/auftrag.mjs grenzen <phasendatei> <auftrag> --rolle <test|bau> --basis <commit>",
  "        node tools/auftrag.mjs phase <phasendatei>",
  "        node tools/auftrag.mjs aufraeumen",
  "        node tools/auftrag.mjs pruefer artefakt --head <sha>",
  "        node tools/auftrag.mjs pruefer pruefen --head <sha> --pr-branch <branch> [--pr-repo <owner/name>] --aus <ordner>",
  "        node tools/auftrag.mjs pruefer nachstellen --ergebnis <ordner> --pr <ordner> --basis <ordner> --aus <ordner>",
  "        node tools/auftrag.mjs pruefer entscheiden --ergebnis <ordner> [--nachstellung <ordner>] [--head <sha>]",
  "        node tools/auftrag.mjs reparatur --ergebnis <ordner> --nachstellung <ordner>",
  "        node tools/auftrag.mjs system",
].join("\n");
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
];

const BEFEHLE = {
  pruefe: { argumente: 1, fuehreAus: ([phasendatei], root) => pruefe(phasendatei, root) },
  lauf: { argumente: 1, fuehreAus: ([phasendatei], root) => lauf(phasendatei, root) },
  phase: { argumente: 1, fuehreAus: ([phasendatei], root) => phase(phasendatei, root) },
  aufraeumen: { argumente: 0, fuehreAus: (keine, root) => aufraeumen(root) },
  rot: { argumente: 2, fuehreAus: ([phasendatei, kennung], root) => rot(phasendatei, kennung, root) },
  grenzen: {
    argumente: 2,
    optionen: ["rolle", "basis"],
    fuehreAus: ([phasendatei, kennung], root, { rolle, basis }) =>
      grenzen(phasendatei, kennung, { rolle, basis, root }),
  },
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
};

function gelesen() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: Object.fromEntries(OPTIONEN.map((name) => [name, { type: "string" }])),
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

function aufruf() {
  const { positionals, values } = gelesen();
  const [name, ...argumente] = positionals;
  const befehl = BEFEHLE[name];
  if (!Object.hasOwn(BEFEHLE, name ?? "") || argumente.length !== befehl.argumente) return null;
  const pflicht = pflichtOptionen(befehl, argumente);
  const fehlend = pflicht === undefined || pflicht.some((option) => values[option] === undefined);
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
