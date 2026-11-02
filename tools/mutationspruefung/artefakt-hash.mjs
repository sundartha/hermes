import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cwd, env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { patternFlagsFor } from "../../test/testbaenke-run.mjs";
import { hashPaar } from "../auftrag/sollwerte.mjs";
import { auslassungen as skipFlags, muster } from "../tests-ausmisten/ausnehmen.mjs";

const BERICHT = fileURLToPath(new URL("./erstlauf-bericht.mjs", import.meta.url));
const ZEILENENDE = "\n";
const VERSCHACHTELT = " > ";
const VERSCHACHTELT_ALLE = / > /g;
const ABSTAND = " ";
const AUSGELASSEN = new Map();
const BANK = "regression";
const BERICHT_NAME = "faelle.jsonl";

export const ARTEFAKT_HASH_GRUND = "fester Artefakt-Hash, in der Sandbox nicht aussagekräftig";

function lies(datei) {
  return existsSync(datei) ? readFileSync(datei, "utf8").split(ZEILENENDE).filter(Boolean).map((zeile) => JSON.parse(zeile)) : [];
}

export function erstlaufBericht() {
  const datei = join(tmpdir(), `erstlauf-bericht-${randomUUID()}.jsonl`);
  return {
    nodeArgs: ["--test-reporter-destination=stdout", `--test-reporter=${BERICHT}`, `--test-reporter-destination=${datei}`],
    faelle: () => lies(datei),
    entfernen: () => rmSync(datei, { force: true }),
  };
}

function nennt(rot, fall) {
  return rot.datei === fall.datei && (rot.test === fall.name || rot.test.endsWith(`${VERSCHACHTELT}${fall.name}`));
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

function roterHashVergleich(faelle, rot) {
  const treffer = faelle.filter((fall) => nennt(rot, fall));
  return treffer.length === 1 && treffer[0].rot && hashPaar(treffer[0]) !== null;
}

function ohneSandbox(rot, tests) {
  const ordner = mkdtempSync(join(tmpdir(), "artefakt-hash-"));
  try {
    const bericht = join(ordner, BERICHT_NAME);
    const argumente = ["--test", `--test-reporter=${BERICHT}`, `--test-reporter-destination=${bericht}`, ...patternFlagsFor(BANK), `--test-name-pattern=${muster(vollerName(rot))}`, ...tests];
    spawnSync(execPath, argumente, { cwd: cwd(), env: { ...env, NODE_ENV: "test" }, stdio: "ignore" });
    return lies(bericht).filter((fall) => !fall.suite && [blatt(rot), vollerName(rot)].includes(fall.name));
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function einzigUndGruen(rot, tests) {
  const faelle = ohneSandbox(rot, tests);
  return faelle.length === 1 && faelle[0].datei === rot.datei && faelle[0].name === blatt(rot) && !faelle[0].rot;
}

export function festeArtefaktHashes(datei, { faelle, rote, tests }) {
  return rote.filter((rot) => !bereitsAusgelassen(datei, rot) && roterHashVergleich(faelle, rot) && einzigUndGruen(rot, tests));
}

export function lasseAus(datei, rote) {
  AUSGELASSEN.set(datei, [...(AUSGELASSEN.get(datei) ?? []), ...rote]);
}

export function auslassungen(datei, tests) {
  const faelle = (AUSGELASSEN.get(datei) ?? []).filter((rot) => tests.includes(rot.datei));
  return skipFlags(faelle.map((rot) => ({ name: vollerName(rot) })));
}
