import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

export const FORMAT = 1;
export const SAUBER = "sauber";
export const GEAENDERT = "geaendert";
export const BLOCKIERT = "blockiert";
export const WEITER = "weiter";
const EINRUECKUNG = 2;
const ZEILENUMBRUCH = /[\r\n]+/g;
const NEU = ".neu";

export function schreibeJson(ordner, name, daten) {
  mkdirSync(ordner, { recursive: true });
  const ziel = join(ordner, name);
  writeFileSync(`${ziel}${NEU}`, `${JSON.stringify(daten, null, EINRUECKUNG)}\n`);
  renameSync(`${ziel}${NEU}`, ziel);
}

export function leseJson(ordner, name) {
  const pfad = join(ordner, name);
  return existsSync(pfad) ? JSON.parse(readFileSync(pfad, "utf8")) : null;
}

export function einzeilig(text) {
  return String(text ?? "").replace(ZEILENUMBRUCH, " ");
}

export function setzeAusgaben(werte) {
  if (!env.GITHUB_OUTPUT) return;
  const zeilen = Object.entries(werte).map(([name, wert]) => `${name}=${einzeilig(wert)}\n`);
  appendFileSync(env.GITHUB_OUTPUT, zeilen.join(""));
}

export function zusammenfassung(zeilen) {
  for (const zeile of zeilen) console.log(zeile);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${zeilen.join("\n")}\n`);
}

export function laufAdresse() {
  const server = env.GITHUB_SERVER_URL ?? "https://github.com";
  return `${server}/${env.GITHUB_REPOSITORY ?? "sundartha/hermes"}/actions/runs/${env.GITHUB_RUN_ID ?? "lokal"}`;
}

export function laufNummer() {
  return env.GITHUB_RUN_ID ?? "lokal";
}

export function ergebnisVon(ausgang, grund = "", weiteres = {}) {
  return { format: FORMAT, ausgang, grund, befunde: [], ...weiteres };
}
