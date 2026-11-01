import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { cwd, env } from "node:process";

import { cruise } from "dependency-cruiser";

import { FOLDER } from "../migrationen-orte.mjs";

export const VORLAGE_UNABHAENGIG = "HERMES_VORLAGE_UNABHAENGIG";
export const KETTENANFANG = "src/db/migrate.js";
export const SCHEMA = `${FOLDER}0001_ausgang.sql`;
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

function schemadateien(wurzel) {
  const ordner = join(wurzel, FOLDER);
  const migrationen = existsSync(ordner)
    ? readdirSync(ordner, { recursive: true, withFileTypes: true })
        .filter((eintrag) => eintrag.isFile())
        .map((eintrag) => relative(wurzel, join(eintrag.parentPath, eintrag.name)))
        .sort()
    : [];
  return [SCHEMA, ...migrationen.filter((datei) => datei !== SCHEMA)].filter((datei) =>
    existsSync(join(wurzel, datei)),
  );
}

export function kettensumme(kette, wurzel) {
  const hash = createHash("sha256");
  for (const datei of [...kette, ...schemadateien(wurzel)]) {
    const inhalt = readFileSync(join(wurzel, datei), "utf8");
    hash.update(`${datei.length}:${datei}${inhalt.length}:${inhalt}`);
  }
  return hash.digest("hex");
}

async function kettenstand(wurzel) {
  if (!existsSync(join(wurzel, KETTENANFANG))) return null;
  const kette = await vorlagenkette(wurzel);
  return { kette, summe: kettensumme(kette, wurzel) };
}

export async function vorlageEinstellen(datei, wurzel = cwd()) {
  if (!jeWurzel.has(wurzel)) jeWurzel.set(wurzel, kettenstand(wurzel));
  const stand = await jeWurzel.get(wurzel);
  if (stand === null) {
    delete env[VORLAGE_UNABHAENGIG];
    return `Vorlage: ohne ${KETTENANFANG}, ohne Cache`;
  }
  const { kette, summe } = stand;
  if (kette.includes(datei)) {
    delete env[VORLAGE_UNABHAENGIG];
    return `Vorlage: abhängig von ${datei}, ohne Cache`;
  }
  env[VORLAGE_UNABHAENGIG] = summe;
  return `Vorlage: unabhängig von ${datei}, mit Cache`;
}
