import { appendFileSync, existsSync } from "node:fs";
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

if (TESTDATEI.test(argv[1] ?? "")) {
  pruefeTiefe(`Testdatei ${argv[1]}`);
  env[TIEFE] = String(tiefe() + 1);
}
