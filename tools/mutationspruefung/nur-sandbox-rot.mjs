import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cwd, env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { patternFlagsFor } from "../../test/testbaenke-run.mjs";
import { auslassungen as skipFlags, muster } from "../tests-ausmisten/ausnehmen.mjs";
import { DATEIGRENZE_MS } from "./gegenprobe-grenze.mjs";
import { MAX_MELDUNGSZEILEN_GESAMT, meldungsblock } from "./meldungsblock.mjs";
import { leseFaelle } from "./erstlauf-bericht.mjs";
import { sandboxMeldung } from "./sandbox-meldungen.mjs";

const BERICHT = fileURLToPath(new URL("./erstlauf-bericht.mjs", import.meta.url));
const ZEILENENDE = "\n";
const VERSCHACHTELT = " > ";
const VERSCHACHTELT_ALLE = / > /g;
const ABSTAND = " ";
const AUSGELASSEN = new Map();
const BANK = "regression";
const BERICHT_NAME = "faelle.jsonl";
const MS_JE_SEKUNDE = 1000;
const MELDUNG_MAX = 200;
const MELDUNGEN = new Map();
const GEMELDET = new Set();
const SANDBOX_STAND = "aus dem roten Sandbox-Lauf";
let aktuellerStand = "";
let gemeldeteBlockzeilen = 0;

export const SANDBOX_GRUND = "im Erstlauf nur in der Sandbox rot, ohne Sandbox grün";

function bereitsAusgelassen(datei, rot) {
  return (AUSGELASSEN.get(datei) ?? []).some((aus) => aus.datei === rot.datei && aus.test === rot.test);
}

function blatt(rot) {
  return rot.test.split(VERSCHACHTELT).at(-1);
}

function vollerName(rot) {
  return rot.test.replace(VERSCHACHTELT_ALLE, ABSTAND);
}

function pfadMuster(rot) {
  const stufen = rot.test.split(VERSCHACHTELT);
  return stufen.map((stufe, index) => `--test-name-pattern=${muster(stufen.slice(0, index + 1).join(ABSTAND))}`);
}

function gegenprobeDateien(rot, tests) {
  const name = blatt(rot);
  const gleichnamig = tests.filter((datei) => datei !== rot.datei && existsSync(datei) && readFileSync(datei, "utf8").includes(name));
  return [rot.datei, ...gleichnamig];
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
    const argumente = ["--test", `--test-timeout=${DATEIGRENZE_MS}`, `--test-reporter=${BERICHT}`, `--test-reporter-destination=${bericht}`, ...patternFlagsFor(BANK), ...pfadMuster(rot), ...gegenprobeDateien(rot, tests)];
    spawnSync(execPath, argumente, { cwd: cwd(), env: { ...env, NODE_ENV: "test" }, stdio: "ignore" });
    const faelle = leseFaelle(bericht);
    meldeHaengende(faelle);
    return faelle.filter((fall) => !fall.suite && [blatt(rot), vollerName(rot)].includes(fall.name));
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function einzeilig(text) {
  const zeile = text.split(ZEILENENDE)[0].trim();
  return zeile.length > MELDUNG_MAX ? `${zeile.slice(0, MELDUNG_MAX - 1)}…` : zeile;
}

export function merkeStand(stand) {
  aktuellerStand = stand;
}

export function meldeMeldung(rot) {
  const schluessel = `${rot.datei} › ${rot.test}`;
  const gemerkt = MELDUNGEN.get(schluessel);
  if (gemerkt === undefined || GEMELDET.has(schluessel)) return;
  GEMELDET.add(schluessel);
  console.error(`Meldung des roten Tests: ${rot.datei} › ${rot.test} (${gemerkt.stand}): ${einzeilig(gemerkt.meldung)}`);
  const block = meldungsblock(gemerkt.meldung, MAX_MELDUNGSZEILEN_GESAMT - gemeldeteBlockzeilen);
  gemeldeteBlockzeilen += block.length;
  for (const zeile of block) console.error(zeile);
}

function merkeSandboxMeldung(rot) {
  const meldung = rot.meldung ?? sandboxMeldung(rot.datei, [blatt(rot), vollerName(rot)]);
  if (meldung !== undefined) MELDUNGEN.set(`${rot.datei} › ${rot.test}`, { meldung, stand: [aktuellerStand, SANDBOX_STAND].filter(Boolean).join(", ") });
}

function einzigUndGruen(rot, tests) {
  const faelle = ohneSandbox(rot, tests);
  if (faelle.length === 0) console.error(`Gegenprobe ohne Sandbox nicht bestimmbar: ${rot.datei} › ${rot.test} wurde nicht ausgeführt (0 Fälle gefunden), der Fall bleibt rot`);
  const ohneBefund = faelle.find((fall) => fall.rot && fall.datei === rot.datei && fall.meldung);
  if (ohneBefund !== undefined) MELDUNGEN.set(`${rot.datei} › ${rot.test}`, { meldung: ohneBefund.meldung, stand: aktuellerStand });
  const gruen = faelle.length === 1 && faelle[0].datei === rot.datei && faelle[0].name === blatt(rot) && !faelle[0].rot;
  if (gruen) merkeSandboxMeldung(rot);
  return gruen;
}

export function ohneSandboxGruen(rote, tests) {
  return rote.filter((rot) => einzigUndGruen(rot, tests));
}

export function nurInDerSandboxRot(datei, { rote, tests }) {
  return ohneSandboxGruen(rote.filter((rot) => !bereitsAusgelassen(datei, rot)), tests);
}

export function lasseAus(datei, rote) {
  AUSGELASSEN.set(datei, [...(AUSGELASSEN.get(datei) ?? []), ...rote]);
}

export function uebernimmAusgelassene(eintraege) {
  for (const { quelle, datei, test } of eintraege) {
    if (!bereitsAusgelassen(quelle, { datei, test })) lasseAus(quelle, [{ datei, test }]);
  }
}

export function alleAusgelassenen() {
  return [...AUSGELASSEN].flatMap(([quelle, rote]) => rote.map(({ datei, test }) => ({ quelle, datei, test })));
}

function ausgelassene(datei, tests) {
  return (AUSGELASSEN.get(datei) ?? []).filter((rot) => tests.includes(rot.datei));
}

export function auslassungFuer(rote) {
  return skipFlags(rote.map((rot) => ({ name: vollerName(rot) })));
}

export function auslassungen(datei, tests) {
  return auslassungFuer(ausgelassene(datei, tests));
}
