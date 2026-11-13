import { appendFileSync, existsSync } from "node:fs";
import { argv, env } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

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
