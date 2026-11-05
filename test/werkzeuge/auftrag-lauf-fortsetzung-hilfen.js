import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ROTER_TEST, VERDOPPELT, funktion } from "./auftrag-lauf-hilfen.js";
import { starte, starteNochmal } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const ABLAGE = ".git/auftrag-umbau/probe";
export const GRUND_VERWORFEN = /Gesicherter Stand verworfen \((.+?)\)/;
const BEENDET_IM_ERSTEN_BAU = { "bau#0-beendet-lauf": true };
const SIGKILL = "SIGKILL";

export const GRUNDLAGE = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };

export function rollen(beleg) {
  return beleg.agenten.map(({ rolle }) => rolle);
}

export function zeigt(repo, pfad) {
  return runIn(repo, "git", ["show", `HEAD:${pfad}`]).stdout;
}

export function gesichert(repo, endung) {
  return join(repo, ABLAGE, `A1.fortsetzung.${endung}`);
}

export function abgebrochen(context) {
  const erster = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { ...GRUNDLAGE, ...BEENDET_IM_ERSTEN_BAU } });
  assert.equal(erster.lauf.signal, SIGKILL, erster.lauf.stdout + erster.lauf.stderr);
  assert.ok(existsSync(gesichert(erster.repo, "json")), "kein gesicherter Stand nach dem Abbruch");
  return erster;
}

export function aufgeraeumt({ repo, basis }) {
  runIn(repo, "git", ["reset", "-q", "--hard", basis]);
  runIn(repo, "git", ["clean", "-q", "-fd"]);
}

export function zweiterLauf(erster) {
  aufgeraeumt(erster);
  return starteNochmal(erster, GRUNDLAGE);
}

function pruefsumme(datei) {
  return createHash("sha256").update(readFileSync(datei)).digest("hex");
}

export function mitPruefsumme(repo, teil) {
  const datei = gesichert(repo, "json");
  const stand = JSON.parse(readFileSync(datei, "utf8"));
  writeFileSync(datei, JSON.stringify({ ...stand, [teil]: { ...stand[teil], pruefsumme: pruefsumme(gesichert(repo, `${teil}.patch`)) } }));
}
