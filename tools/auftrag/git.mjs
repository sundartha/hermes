import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NUMSTAT_FELDER = 3;
const BINAER = "-";
const NUL = "\0";

export function git(args, { cwd, eingabe } = {}) {
  const lauf = spawnSync("git", args, { cwd, encoding: "utf8", input: eingabe });
  if (lauf.status !== 0) {
    throw new Error(`git ${args.join(" ")} ist mit Exit ${lauf.status} gescheitert: ${lauf.stderr}`);
  }
  return lauf.stdout;
}

export function istSauber(cwd) {
  return git(["status", "--porcelain", "--untracked-files=all"], { cwd }).trim() === "";
}

export function kopf(cwd) {
  return git(["rev-parse", "HEAD"], { cwd }).trim();
}

function zeilenzahl(wert) {
  return wert === BINAER ? 0 : Number(wert);
}

function verfolgteAenderungen(basis, cwd) {
  const eintraege = git(["diff", "--numstat", "--no-renames", "-z", basis], { cwd }).split(NUL);
  return eintraege
    .filter(Boolean)
    .map((eintrag) => eintrag.split("\t", NUMSTAT_FELDER))
    .map(([hinzu, , pfad]) => ({ pfad, zeilen: zeilenzahl(hinzu) }));
}

function neueDateien(cwd) {
  const pfade = git(["ls-files", "--others", "--exclude-standard", "-z"], { cwd }).split(NUL);
  return pfade.filter(Boolean).map((pfad) => {
    const inhalt = readFileSync(join(cwd, pfad), "utf8");
    return { pfad, zeilen: inhalt === "" ? 0 : inhalt.split("\n").length };
  });
}

export function aenderungenSeit(basis, cwd) {
  return [...verfolgteAenderungen(basis, cwd), ...neueDateien(cwd)];
}

export function vormerken(pfade, cwd) {
  if (pfade.length > 0) git(["add", "--", ...pfade], { cwd });
}

export function festhalten(nachricht, cwd) {
  return spawnSync("git", ["commit", "-q", "-F", "-"], { cwd, encoding: "utf8", input: nachricht });
}

export function weichZuruecksetzen(basis, cwd) {
  git(["reset", "-q", "--soft", basis], { cwd });
}
