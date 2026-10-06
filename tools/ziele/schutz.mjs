import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";

import { istKritisch } from "../auftrag/agenten.mjs";
import { geschuetzteMuster, istGeschuetzt, istTestdatei } from "../auftrag/format.mjs";
import { gitAusgabe } from "../auftrag/pruefer-auswahl.mjs";

export const WURZEL_DATEI = "tools/ziele/geschuetzt.json";
const UNTERDRUECKUNGEN = "eslint-suppressions.json";
const GATE_ANKER = "#";
const TEST_TEIL = ".test.";
const TESTDATEIEN = "test/*.test.js";
const ORDNER_ENDE = "/";
const GRAPH_OPTIONEN = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const PAKETDATEIEN = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

export const SCHUTZ = {
  test: "Testdatei",
  paket: "package.json oder Lockfile",
  erzeugt: "erzeugte Datei",
  codeowners: "durch CODEOWNERS geschützt",
  importgraph: "von Gates, Abrechnung, Anmeldung oder Gespräch über Importe erreichbar",
  kritisch: "kritischer Pfad",
  ohneTest: "kein Test erreicht die Datei",
};

function leseJsonDatei(root, pfad) {
  return JSON.parse(readFileSync(join(root, pfad), "utf8"));
}

function gateModule(root, liste) {
  const gates = Object.values(leseJsonDatei(root, liste));
  return gates.flatMap(({ module }) => module.map((pfad) => pfad.split(GATE_ANKER)[0]));
}

function schutzDatei(root) {
  const { gates, erzeugt = [], ...gruppen } = leseJsonDatei(root, WURZEL_DATEI);
  return { gates, erzeugt, gruppen };
}

export function wurzelPfade(root) {
  const { gates, gruppen } = schutzDatei(root);
  const alle = [...gateModule(root, gates), ...Object.values(gruppen).flat()];
  return [...new Set(alle)].filter((pfad) => existsSync(join(root, pfad))).sort();
}

async function importgraph(root, start) {
  if (start.length === 0) return new Map();
  const { cruise } = await import("dependency-cruiser");
  const { output } = await cruise(start, { ...GRAPH_OPTIONEN, baseDir: realpathSync(root) });
  return new Map(output.modules.map(({ source, dependencies }) => [source, dependencies.map(({ resolved }) => resolved)]));
}

function vonAusErreicht(graph, start) {
  const besucht = new Set();
  const offen = [start];
  while (offen.length > 0) {
    const modul = offen.pop();
    if (besucht.has(modul)) continue;
    besucht.add(modul);
    offen.push(...(graph.get(modul) ?? []));
  }
  return besucht;
}

export function testsFuer(datei, { testgraph, tests, erreicht }) {
  for (const test of tests.filter((eintrag) => !erreicht.has(eintrag))) erreicht.set(test, vonAusErreicht(testgraph, test));
  return tests.filter((test) => erreicht.get(test).has(datei));
}

function testdateien(root) {
  return gitAusgabe(["ls-files", "-z", "--", TESTDATEIEN], root).split("\0").filter(Boolean);
}

function unterdrueckteDateien(root) {
  const pfad = join(root, UNTERDRUECKUNGEN);
  return new Set(existsSync(pfad) ? Object.keys(JSON.parse(readFileSync(pfad, "utf8"))) : []);
}

export function istTestPfad(pfad) {
  return istTestdatei(pfad) || basename(pfad).includes(TEST_TEIL);
}

function unterWurzel(pfad, wurzeln) {
  return wurzeln.some((wurzel) => pfad === wurzel || (wurzel.endsWith(ORDNER_ENDE) && pfad.startsWith(wurzel)));
}

export function schutzGrund(pfad, lage) {
  if (istTestPfad(pfad)) return SCHUTZ.test;
  if (PAKETDATEIEN.has(basename(pfad))) return SCHUTZ.paket;
  if (lage.erzeugt.includes(pfad)) return SCHUTZ.erzeugt;
  if (istGeschuetzt(lage.muster, pfad)) return SCHUTZ.codeowners;
  if (lage.geschuetzt.has(pfad) || unterWurzel(pfad, lage.wurzeln)) return SCHUTZ.importgraph;
  if (istKritisch(pfad)) return SCHUTZ.kritisch;
  return null;
}

export function kandidatenGrund(pfad, lage) {
  return schutzGrund(pfad, lage) ?? (lage.getestet.has(pfad) ? null : SCHUTZ.ohneTest);
}

export function istUnterdrueckt(pfad, lage) {
  return lage.unterdrueckt.has(pfad);
}

export function gitSchutzLage(root) {
  const { erzeugt } = schutzDatei(root);
  return {
    muster: geschuetzteMuster(root),
    geschuetzt: new Set(),
    wurzeln: wurzelPfade(root),
    erzeugt,
    getestet: new Set(),
    unterdrueckt: new Set(),
    testgraph: new Map(),
    tests: [],
    erreicht: new Map(),
  };
}

export async function schutzLage(root) {
  const lage = gitSchutzLage(root);
  const tests = testdateien(root);
  const testgraph = await importgraph(root, tests);
  return {
    ...lage,
    geschuetzt: new Set((await importgraph(root, lage.wurzeln)).keys()),
    getestet: new Set(testgraph.keys()),
    unterdrueckt: unterdrueckteDateien(root),
    testgraph,
    tests,
  };
}
