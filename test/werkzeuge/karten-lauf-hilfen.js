import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../..", import.meta.url));
export const TEST_FRIST = { timeout: 170000 };
export const EXIT_ROT = 1;
const FUNKTIONSKARTE = join(REPO, "tools", "funktionskarte.mjs");
const RUECKFRAGE_KARTE = "docs/funktionen/rueckfrage.md";
const LAUF_FRIST_MS = 160000;

export function funktionskarteAufrufen(wurzel, argumente, env = process.env) {
  return new Promise((fertig) => {
    execFile(
      process.execPath,
      [FUNKTIONSKARTE, ...argumente],
      { cwd: wurzel, env, timeout: LAUF_FRIST_MS },
      (fehler, stdout, stderr) => fertig({ exit: fehler?.code ?? 0, stdout, stderr }),
    );
  });
}

export function budgetOrdner(praefix) {
  const ordner = mkdtempSync(join(tmpdir(), praefix));
  after(() => {
    rmSync(ordner, { recursive: true, force: true });
  });
  return ordner;
}

export function budgetDatei(ordner, name, attrappen) {
  const pfad = join(ordner, `${name}.json`);
  writeFileSync(pfad, `${JSON.stringify({ attrappen, staging: {} }, null, 2)}\n`);
  return pfad;
}

export async function rueckfrageKartePruefen(antwortzeiten, zusatz = []) {
  const lauf = await funktionskarteAufrufen(REPO, [
    "pruefen",
    "--karte",
    RUECKFRAGE_KARTE,
    "--antwortzeiten",
    antwortzeiten,
    ...zusatz,
  ]);
  return { exit: lauf.exit, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}
