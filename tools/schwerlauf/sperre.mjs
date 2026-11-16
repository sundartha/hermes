import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import process, { argv, env } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCHALTER = "HERMES_LOKAL_SCHWER";
export const EXIT_GESPERRT = 3;
const MELDUNG = " läuft nur auf GitHub Actions (Pflicht-Checks des PR bzw. workflow_dispatch). Lokal: npm run pruefen oder npm test -- <datei>.";

const EHRLICHKEIT = "Die Sperre beruht auf Absprache: GITHUB_ACTIONS=true kann jeder Prozess setzen, es ist keine Sicherung, und es lokal zu setzen ist ein Regelbruch.";

export function schwerErlaubt() {
  if (env.GITHUB_ACTIONS === "true") return true;
  return env[SCHALTER] === "ja" && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

export function nimmSperreAuchFuerKindprozesse(anlass) {
  if (schwerErlaubt()) return;
  console.error(`${anlass}${MELDUNG}\n${EHRLICHKEIT}`);
  process.exit(EXIT_GESPERRT);
}

export const TIEFE = "TEST_TIEFE";
const MELDUNGSDATEI = "TEST_TIEFE_MELDUNG";
export const TIEFE_HOECHSTENS = 2;
export const EXIT_ZU_TIEF = 4;
const DATEI = fileURLToPath(import.meta.url);
const TESTDATEI = /\.test\.[cm]?[jt]s$/;

export function tiefe() {
  return Number(env[TIEFE] ?? 0) || 0;
}

export function pruefeTiefe(anlass) {
  if (tiefe() < TIEFE_HOECHSTENS) return;
  const meldung = `${anlass}: Abbruch, ${TIEFE}=${tiefe()} (höchstens ${TIEFE_HOECHSTENS - 1} Ebenen): Ein Test startet sich vermutlich selbst.`;
  console.error(meldung);
  if (env[MELDUNGSDATEI]) appendFileSync(env[MELDUNGSDATEI], `${meldung}\n`);
  process.exit(EXIT_ZU_TIEF);
}

export function mitWaechter(umgebung) {
  if (!existsSync(DATEI)) return umgebung;
  const alt = umgebung.NODE_OPTIONS ?? "";
  return { ...umgebung, NODE_OPTIONS: `${alt} --import=${pathToFileURL(DATEI).href}`.trim() };
}

export const AUFRUFER = "HERMES_AUFRUFER_PID";
const SPERRDATEI = "lauf.pid";
const AUFRUFER_ABFRAGE_MS = 2000;
const KEIN_PROZESS = "ESRCH";

function pidLebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (fehler) {
    return fehler.code !== KEIN_PROZESS;
  }
}

function eintragen(pfad) {
  try {
    const datei = openSync(pfad, "wx");
    writeSync(datei, String(process.pid));
    closeSync(datei);
    return true;
  } catch (fehler) {
    if (fehler.code === "EEXIST") return false;
    throw fehler;
  }
}

function halter(pfad) {
  return Number(readFileSync(pfad, "utf8")) || 0;
}

export function nimmLaufSperre(verzeichnis) {
  mkdirSync(verzeichnis, { recursive: true });
  const pfad = join(verzeichnis, SPERRDATEI);
  if (!eintragen(pfad)) {
    const pid = halter(pfad);
    if (pidLebt(pid)) return { genommen: false, pid };
    unlinkSync(pfad);
    if (!eintragen(pfad)) return { genommen: false, pid: halter(pfad) };
  }
  process.once("exit", () => {
    if (halter(pfad) === process.pid) unlinkSync(pfad);
  });
  return { genommen: true, pid: process.pid };
}

function eigeneGruppe() {
  const ausgabe = spawnSync("ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" });
  return Number(ausgabe.stdout) || 0;
}

function beendeGruppeOhneAufrufer(aufrufer) {
  if (pidLebt(aufrufer)) return;
  const gruppe = eigeneGruppe();
  if (gruppe > 1) process.kill(-gruppe, "SIGKILL");
}

if (env[AUFRUFER] && !schwerErlaubt()) {
  const aufrufer = Number(env[AUFRUFER]);
  setInterval(() => beendeGruppeOhneAufrufer(aufrufer), AUFRUFER_ABFRAGE_MS).unref();
}

if (TESTDATEI.test(argv[1] ?? "")) {
  pruefeTiefe(`Testdatei ${argv[1]}`);
  env[TIEFE] = String(tiefe() + 1);
}
