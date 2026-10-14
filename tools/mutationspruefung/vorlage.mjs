import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env } from "node:process";

import { cruise } from "dependency-cruiser";

export const VORLAGE_UNABHAENGIG = "HERMES_VORLAGE_UNABHAENGIG";
const KETTENANFANG = "src/db/migrate.js";
const SCHEMA = "src/db/schema.sql";
const LOKAL = "local";
const CRUISE_OPTIONEN = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const jeWurzel = new Map();

export async function vorlagenkette(wurzel) {
  const { output } = await cruise([KETTENANFANG], { ...CRUISE_OPTIONEN, baseDir: wurzel });
  const nachQuelle = new Map(output.modules.map(({ source, dependencies }) => [source, dependencies]));
  const kette = new Set([KETTENANFANG]);
  for (const datei of kette) {
    for (const { resolved, dependencyTypes } of nachQuelle.get(datei) ?? []) {
      if (dependencyTypes.includes(LOKAL)) kette.add(resolved);
    }
  }
  return [...kette].sort();
}

export function kettensumme(kette, wurzel) {
  const hash = createHash("sha256");
  for (const datei of [...kette, SCHEMA]) {
    const inhalt = readFileSync(join(wurzel, datei), "utf8");
    hash.update(`${datei.length}:${datei}${inhalt.length}:${inhalt}`);
  }
  return hash.digest("hex");
}

async function kettenstand(wurzel) {
  const kette = await vorlagenkette(wurzel);
  return { kette, summe: kettensumme(kette, wurzel) };
}

export async function vorlageEinstellen(datei, wurzel = cwd()) {
  if (!jeWurzel.has(wurzel)) jeWurzel.set(wurzel, kettenstand(wurzel));
  const { kette, summe } = await jeWurzel.get(wurzel);
  if (kette.includes(datei)) {
    delete env[VORLAGE_UNABHAENGIG];
    return `Vorlage: abhängig von ${datei}, ohne Cache`;
  }
  env[VORLAGE_UNABHAENGIG] = summe;
  return `Vorlage: unabhängig von ${datei}, mit Cache`;
}
