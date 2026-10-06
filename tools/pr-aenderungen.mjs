import { spawnSync } from "node:child_process";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import { ESLint } from "eslint";

const HUNK_KOPF = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const ZEILENENDE = "\n";
const ENTFERNT = "-";
const HINZUGEFUEGT = "+";
const STANDARD_HUNK_LAENGE = 1;
const FELDER_JE_DATEI = 2;
const MAX_GIT_AUSGABE = 268_435_456;
const EXIT_ABBRUCH = 2;
const OBJEKTART_COMMIT = "commit";
const JS_ENDUNGEN = new Set([".js", ".mjs", ".cjs"]);
const DIFF_OHNE_UMBENENNUNG = ["diff", "--no-renames", "--no-color", "--no-ext-diff", "-U0"];

export const STATUS_NEU = "A";
export const STATUS_GELOESCHT = "D";

export class Abbruch extends Error {}

export function git(args, root) {
  const lauf = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_GIT_AUSGABE,
  });
  if (lauf.status !== 0) throw new Abbruch(`git ${args.join(" ")}: ${lauf.stderr.trim()}`);
  return lauf.stdout;
}

export function basisAusAufruf(aufruf, root) {
  const { values } = parseArgs({ options: { basis: { type: "string" } } });
  const { basis } = values;
  if (basis === undefined || basis.trim() === "") {
    throw new Abbruch(`--basis fehlt oder ist leer. ${aufruf}`);
  }
  if (!istCommit(basis, root)) {
    throw new Abbruch(`Die Basis ${basis} ist kein Commit in diesem Checkout. ${aufruf}`);
  }
  return basis;
}

function istCommit(objekt, root) {
  try {
    return git(["cat-file", "-t", objekt], root).trim() === OBJEKTART_COMMIT;
  } catch {
    return false;
  }
}

export function geaenderteDateien(basis, root, { filter, muster = [] }) {
  const args = ["diff", "--name-status", "-z", "--no-renames", `--diff-filter=${filter}`, basis, "HEAD"];
  const felder = git([...args, "--", ...muster], root).split("\0");
  const dateien = [];
  for (let index = 0; index + 1 < felder.length; index += FELDER_JE_DATEI) {
    dateien.push({ status: felder[index], datei: felder[index + 1] });
  }
  return dateien;
}

export function dateiInhalt(commit, datei, root) {
  return git(["show", `${commit}:${datei}`], root);
}

function hunkSeite(start, laenge) {
  const anzahl = laenge === undefined ? STANDARD_HUNK_LAENGE : Number(laenge);
  return { start: Number(start), anzahl, zeilen: [] };
}

export function gibtEs(commit, datei, root) {
  return git(["ls-tree", "--name-only", commit, "--", datei], root).trim() !== "";
}

function hunksAus(ausgabe) {
  const gefunden = [];
  for (const zeile of ausgabe.split(ZEILENENDE)) {
    const kopf = HUNK_KOPF.exec(zeile);
    const aktuell = gefunden.at(-1);
    if (kopf !== null) {
      gefunden.push({ alt: hunkSeite(kopf[1], kopf[2]), neu: hunkSeite(kopf[3], kopf[4]) });
    } else if (aktuell !== undefined && zeile.startsWith(HINZUGEFUEGT)) {
      aktuell.neu.zeilen.push(zeile.slice(HINZUGEFUEGT.length));
    } else if (aktuell !== undefined && zeile.startsWith(ENTFERNT)) {
      aktuell.alt.zeilen.push(zeile.slice(ENTFERNT.length));
    }
  }
  return gefunden;
}

export function hunks(basis, datei, root) {
  return hunksAus(git([...DIFF_OHNE_UMBENENNUNG, basis, "HEAD", "--", datei], root));
}

function zeilenDerHunks(gefunden) {
  return gefunden.flatMap(({ neu }) =>
    neu.zeilen.map((text, index) => ({ zeile: neu.start + index, text })),
  );
}

export function hinzugefuegteZeilen(basis, datei, root) {
  return zeilenDerHunks(hunks(basis, datei, root));
}

export function hinzugefuegteZeilenGegenueber(vorher, datei, root) {
  return zeilenDerHunks(hunksAus(git([...DIFF_OHNE_UMBENENNUNG, vorher, `HEAD:${datei}`], root)));
}

export async function gelinteteJsDateien(root, dateien) {
  const eslint = new ESLint({ cwd: root });
  const gefunden = new Set();
  for (const { datei } of dateien) {
    const istJs = JS_ENDUNGEN.has(extname(datei)) && !(await eslint.isPathIgnored(join(root, datei)));
    if (istJs) gefunden.add(datei);
  }
  return gefunden;
}

export async function ausfuehren(pruefung) {
  try {
    process.exitCode = await pruefung(process.cwd());
  } catch (error) {
    console.error(`Abbruch: ${error.message}`);
    if (!(error instanceof Abbruch)) console.error(error.stack);
    process.exitCode = EXIT_ABBRUCH;
  }
}
