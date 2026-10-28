import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const EXIT_OK = 0;
export const EXIT_VORHANDEN = 1;
export const EXIT_AUFRUF = 2;

const EINSTIEG = join(REPO, "tools/neu/neu.mjs");
const KARTEN = ["tools/bausteine.json", "tools/bereiche.json"];
const wurzeln = [];

export function frischeWurzel(praefix) {
  const wurzel = mkdtempSync(join(tmpdir(), praefix));
  wurzeln.push(wurzel);
  for (const karte of KARTEN) {
    mkdirSync(dirname(join(wurzel, karte)), { recursive: true });
    cpSync(join(REPO, karte), join(wurzel, karte));
  }
  return wurzel;
}

export function raeumeWurzelnAuf() {
  for (const wurzel of wurzeln) rmSync(wurzel, { recursive: true, force: true });
}

export function neu(wurzel, ...argumente) {
  return spawnSync(process.execPath, [EINSTIEG, "--wurzel", wurzel, ...argumente], {
    encoding: "utf8",
  });
}

export function lesen(wurzel, pfad) {
  return readFileSync(join(wurzel, pfad), "utf8");
}
