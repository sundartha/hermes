import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cwd, env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { patternFlagsFor } from "../../test/testbaenke-run.mjs";
import { auslassungen as skipFlags, muster } from "../tests-ausmisten/ausnehmen.mjs";
import { DATEIGRENZE_MS } from "./gegenprobe-grenze.mjs";

const BERICHT = fileURLToPath(new URL("./erstlauf-bericht.mjs", import.meta.url));
const ZEILENENDE = "\n";
const VERSCHACHTELT = " > ";
const VERSCHACHTELT_ALLE = / > /g;
const ABSTAND = " ";
const AUSGELASSEN = new Map();
const BANK = "regression";
const BERICHT_NAME = "faelle.jsonl";
const MS_JE_SEKUNDE = 1000;

export const SANDBOX_GRUND = "im Erstlauf nur in der Sandbox rot, ohne Sandbox grün";

function lies(datei) {
  return existsSync(datei) ? readFileSync(datei, "utf8").split(ZEILENENDE).filter(Boolean).map((zeile) => JSON.parse(zeile)) : [];
}

function bereitsAusgelassen(datei, rot) {
  return (AUSGELASSEN.get(datei) ?? []).some((aus) => aus.datei === rot.datei && aus.test === rot.test);
}

function blatt(rot) {
  return rot.test.split(VERSCHACHTELT).at(-1);
}

function vollerName(rot) {
  return rot.test.replace(VERSCHACHTELT_ALLE, ABSTAND);
}

function meldeHaengende(faelle) {
  for (const fall of faelle.filter((eintrag) => eintrag.rot && eintrag.name === eintrag.datei)) {
    console.error(`Gegenprobe ohne Sandbox: ${fall.datei} nach ${DATEIGRENZE_MS / MS_JE_SEKUNDE} s ohne Ende abgebrochen`);
  }
}

function ohneSandbox(rot, tests) {
  const ordner = mkdtempSync(join(tmpdir(), "artefakt-hash-"));
  try {
    const bericht = join(ordner, BERICHT_NAME);
    const argumente = ["--test", `--test-timeout=${DATEIGRENZE_MS}`, `--test-reporter=${BERICHT}`, `--test-reporter-destination=${bericht}`, ...patternFlagsFor(BANK), `--test-name-pattern=${muster(vollerName(rot))}`, ...tests];
    spawnSync(execPath, argumente, { cwd: cwd(), env: { ...env, NODE_ENV: "test" }, stdio: "ignore" });
    const faelle = lies(bericht);
    meldeHaengende(faelle);
    return faelle.filter((fall) => !fall.suite && [blatt(rot), vollerName(rot)].includes(fall.name));
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function einzigUndGruen(rot, tests) {
  const faelle = ohneSandbox(rot, tests);
  return faelle.length === 1 && faelle[0].datei === rot.datei && faelle[0].name === blatt(rot) && !faelle[0].rot;
}

export function nurInDerSandboxRot(datei, { rote, tests }) {
  return rote.filter((rot) => !bereitsAusgelassen(datei, rot) && einzigUndGruen(rot, tests));
}

export function lasseAus(datei, rote) {
  AUSGELASSEN.set(datei, [...(AUSGELASSEN.get(datei) ?? []), ...rote]);
}

function ausgelassene(datei, tests) {
  return (AUSGELASSEN.get(datei) ?? []).filter((rot) => tests.includes(rot.datei));
}

export function ganzAusgelassen(datei, tests, namen) {
  const faelle = ausgelassene(datei, tests);
  return namen !== undefined && namen.every((name) => faelle.some((rot) => [blatt(rot), vollerName(rot)].includes(name)));
}

export function auslassungen(datei, tests) {
  return skipFlags(ausgelassene(datei, tests).map((rot) => ({ name: vollerName(rot) })));
}
