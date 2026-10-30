import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ABSATZ_MUTATION, NEU_MUTANT, NOETIG, ROTER_TEST, SIEBEN_TEST, ZWEITER_MUTANT, ehrlicheNachrunde, funktion, MIT_SIEBEN, MIT_MUTATION } from "./auftrag-lauf-hilfen.js";
import { starte, starteNochmal } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

export const ACHT_ZUSATZ = 'test("acht", () => assert.equal(verdopple(8), 16));\n';
export const ACHT_TEST = `${SIEBEN_TEST}${ACHT_ZUSATZ}`;
export const RECHNEN = "test/rechnen.test.js";
const ABLAGE = ".git/auftrag-umbau/probe";
export const GRUND_VERWORFEN = /Gesicherter Stand verworfen \((.+?)\)/;
const BEENDET_IN_RUNDE_2 = { "test-nachrunde#2-beendet-lauf": true };
const SIGKILL = "SIGKILL";

const NACH_TESTS = `import { readFileSync } from "node:fs";
const test = readFileSync("test/rechnen.test.js", "utf8");
const offen = [[${JSON.stringify(NEU_MUTANT)}, "(7)"], [${JSON.stringify(ZWEITER_MUTANT)}, "(8)"]].filter(([, marke]) => !test.includes(marke));
for (const [mutant] of offen) console.log("Verstoß: Mutant überlebt: " + mutant);
console.log(offen.length > 0 ? "Verstoß" : "grün: keiner überlebt");
process.exitCode = offen.length > 0 ? 1 : 0;
`;
export const ZWEI_MUTANTEN = { ...MIT_MUTATION, "mutation.mjs": NACH_TESTS };

export const GRUNDLAGE = {
  test: { "test/rechnen.test.js": ROTER_TEST },
  bau: MIT_SIEBEN,
  ...ehrlicheNachrunde(NOETIG),
  "test-nachrunde-antwort": ABSATZ_MUTATION,
};

export function rollen(beleg) {
  return beleg.agenten.map(({ rolle }) => rolle);
}

export function ersteRunde(repo) {
  return JSON.parse(readFileSync(join(repo, ".fortschritt/probe/A1.runde-1.json"), "utf8"));
}

export function zeigt(repo, pfad) {
  return runIn(repo, "git", ["show", `HEAD:${pfad}`]).stdout;
}

export function gesichert(repo, endung) {
  return join(repo, ABLAGE, `A1.fortsetzung.${endung}`);
}

export function abgebrochen(context, { dateien = ZWEI_MUTANTEN, drehbuch = {} } = {}) {
  const erster = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { ...GRUNDLAGE, ...BEENDET_IN_RUNDE_2, ...drehbuch }, dateien });
  assert.equal(erster.lauf.signal, SIGKILL, erster.lauf.stdout + erster.lauf.stderr);
  assert.ok(existsSync(gesichert(erster.repo, "json")), "kein gesicherter Stand nach der roten Runde");
  return erster;
}

export function aufgeraeumt({ repo, basis }) {
  runIn(repo, "git", ["reset", "-q", "--hard", basis]);
  runIn(repo, "git", ["clean", "-q", "-fd"]);
}

export function zweiterLauf(erster, drehbuch = {}) {
  aufgeraeumt(erster);
  return starteNochmal(erster, { ...GRUNDLAGE, ...drehbuch });
}

function pruefsumme(datei) {
  return createHash("sha256").update(readFileSync(datei)).digest("hex");
}

export function mitPruefsumme(repo, teil) {
  const datei = gesichert(repo, "json");
  const stand = JSON.parse(readFileSync(datei, "utf8"));
  writeFileSync(datei, JSON.stringify({ ...stand, [teil]: { ...stand[teil], pruefsumme: pruefsumme(gesichert(repo, `${teil}.patch`)) } }));
}

