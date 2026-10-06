import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPAWN_TIMEOUT_MS = 15000;
const ATTRAPPE_MODUL = pathToFileURL(path.join(ROOT, "test", "_iel-b11-fetch-attrappe.mjs")).href;

export const BASIS_ENV = Object.freeze({
  PATH: process.env.PATH,
  NODE_ENV: "test",
  TELNYX_API_KEY: "test-telnyx-schluessel",
  TELNYX_ACCOUNT_SID: "test-account-sid",
  TELNYX_API_BASE: "http://telnyx.test",
  ELEVENLABS_API_KEY: "test-el-schluessel",
  ELEVENLABS_AGENT_ID: "agent_b11_test",
  ELEVENLABS_API_BASE: "http://el.test",
});

export function ielMessDateiNamen() {
  const scriptsInhalt = fs.readdirSync(path.join(ROOT, "scripts"));
  const treffer = scriptsInhalt.filter(
    (name) => name.startsWith("iel-mess") && fs.statSync(path.join(ROOT, "scripts", name)).isFile(),
  );
  return treffer.sort();
}

export function bauMessBaum(optionen = {}) {
  const { m1Zaehler, nachdeployZaehler = { ausgeloest: 0, anrufe: [] }, wegwerf } = optionen;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iel-b11-"));
  const scriptsDir = path.join(dir, "scripts");
  const tasksDir = path.join(scriptsDir, "iel-mess");
  fs.mkdirSync(scriptsDir);
  fs.mkdirSync(tasksDir);
  for (const datei of ielMessDateiNamen()) {
    fs.copyFileSync(path.join(ROOT, "scripts", datei), path.join(scriptsDir, datei));
  }
  fs.symlinkSync(path.join(ROOT, "src"), path.join(dir, "src"), "dir");
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
  const m1Pfad = path.join(ROOT, "scripts", "iel-mess", "iel-m1-zaehler.json");
  const m1Inhalt = m1Zaehler ?? JSON.parse(fs.readFileSync(m1Pfad, "utf8"));
  fs.writeFileSync(path.join(tasksDir, "iel-m1-zaehler.json"), JSON.stringify(m1Inhalt));
  fs.writeFileSync(path.join(tasksDir, "iel-nachdeploy-zaehler.json"), JSON.stringify(nachdeployZaehler));
  if (wegwerf) fs.writeFileSync(path.join(tasksDir, "iel-m1-wegwerf.json"), JSON.stringify(wegwerf));
  return dir;
}

function zaehlerHash(dir, datei) {
  const inhalt = fs.readFileSync(path.join(dir, "scripts", "iel-mess", datei));
  return createHash("sha256").update(inhalt).digest("hex");
}

export function m1ZaehlerHash(dir) {
  return zaehlerHash(dir, "iel-m1-zaehler.json");
}

export function faellePfadIn(dir) {
  return path.join(dir, "scripts", "iel-mess.cases.json");
}

function aendereKonfigurationIn(dir, aenderung) {
  const pfad = faellePfadIn(dir);
  const konfiguration = JSON.parse(fs.readFileSync(pfad, "utf8"));
  fs.writeFileSync(pfad, JSON.stringify(aenderung(konfiguration)));
}

export function setzeZusatzFall(dir, name, fall) {
  aendereKonfigurationIn(dir, (konfiguration) => ({
    ...konfiguration,
    faelle: { ...konfiguration.faelle, [name]: fall },
  }));
}

export function spawnDry(dir, args, zusatzEnv = {}) {
  const skriptPfad = path.join(dir, "scripts", "iel-mess.mjs");
  return spawnSync(process.execPath, [skriptPfad, ...args, "--dry-run"], {
    cwd: dir,
    env: { ...BASIS_ENV, ...zusatzEnv },
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
}

export function spawnEcht(dir, args, kontext) {
  const { szenario, protokollPfad, zusatzEnv = {} } = kontext;
  const env = { ...BASIS_ENV, ...zusatzEnv, IEL_B11_ATTRAPPE: JSON.stringify(szenario), IEL_B11_PROTOKOLL: protokollPfad };
  const skriptPfad = path.join(dir, "scripts", "iel-mess.mjs");
  return spawnSync(process.execPath, ["--import", ATTRAPPE_MODUL, skriptPfad, ...args], {
    cwd: dir,
    env,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
}

export function protokollPfadIn(dir) {
  return path.join(dir, "protokoll.json");
}

export function leseProtokoll(protokollPfad) {
  const inhalt = fs.readFileSync(protokollPfad, "utf8");
  return JSON.parse(inhalt);
}

export function jsonZeilenAus(stdout) {
  const zeilen = stdout.split("\n");
  const jsonZeilen = zeilen.filter((zeile) => zeile.startsWith("{"));
  return jsonZeilen.map((zeile) => JSON.parse(zeile));
}

export function ergebniszeileMitArt(stdout, art) {
  const objekte = jsonZeilenAus(stdout);
  return objekte.find((objekt) => objekt.art === art);
}

export function trockenAufrufe(stdout) {
  const zeilen = stdout.split("\n");
  const zeile = zeilen.find((einzelne) => einzelne.includes("fetch-Aufrufe in diesem Lauf:"));
  const treffer = zeile?.match(/(\d+)\s*$/);
  return Number(treffer?.[1] ?? NaN);
}
