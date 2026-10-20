import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const NUMSTAT_FELDER = 3;
const BINAER = "-";
const STATUS_SPALTEN = 3;
const STDIN = "-";
const DIFF_UNTERSCHIEDLICH = 1;
export const NUL = "\0";
const AUFTRAG_ZEILE = "^Auftrag: ";
const RUECKNAHME_ZEILE = "^This reverts commit ";
const ZURUECKGENOMMEN = /^This reverts commit ([0-9a-f]{40})\.$/gm;

export function git(args, { cwd, eingabe } = {}) {
  const lauf = spawnSync("git", args, { cwd, encoding: "utf8", input: eingabe });
  if (lauf.status !== 0) {
    throw new Error(`git ${args.join(" ")} ist mit Exit ${lauf.status} gescheitert: ${lauf.stderr}`);
  }
  return lauf.stdout;
}

export function gemeinsamerOrdner(root, ...teile) {
  const gemeinsam = git(["rev-parse", "--git-common-dir"], { cwd: root }).trim();
  return join(resolve(root, gemeinsam), ...teile);
}

export function gibtEsIn(commit, pfad, cwd) {
  return spawnSync("git", ["cat-file", "-e", `${commit}:${pfad}`], { cwd }).status === 0;
}

export function legeWorktreeAn(commit, ordner, cwd) {
  git(["worktree", "add", "--detach", "-q", ordner, commit], { cwd });
  return () => git(["worktree", "remove", "--force", ordner], { cwd });
}

export function istSauber(cwd) {
  return git(["status", "--porcelain", "--untracked-files=all"], { cwd }).trim() === "";
}

export function offenePfade(cwd) {
  const eintraege = git(["status", "--porcelain", "--untracked-files=all", "-z"], { cwd }).split(NUL);
  return eintraege.filter(Boolean).map((eintrag) => eintrag.slice(STATUS_SPALTEN));
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

function zeilenImText(inhalt) {
  const zeilen = inhalt.split("\n");
  if (zeilen.at(-1) === "") zeilen.pop();
  return zeilen.length;
}

function neueDateien(cwd) {
  const pfade = git(["ls-files", "--others", "--exclude-standard", "-z"], { cwd }).split(NUL);
  return pfade.filter(Boolean).map((pfad) => ({ pfad, zeilen: zeilenImText(readFileSync(join(cwd, pfad), "utf8")) }));
}

function zeilenGegenAlt(basis, { alt, neu }, cwd) {
  const vorher = git(["show", `${basis}:${alt}`], { cwd });
  const lauf = spawnSync("git", ["diff", "--no-index", "--numstat", "--", STDIN, neu], { cwd, encoding: "utf8", input: vorher });
  if (lauf.status !== 0 && lauf.status !== DIFF_UNTERSCHIEDLICH) throw new Error(`git diff --no-index ${neu} ist mit Exit ${lauf.status} gescheitert: ${lauf.stderr}`);
  const [hinzu] = lauf.stdout.split("\t", 1);
  return hinzu === "" ? 0 : zeilenzahl(hinzu);
}

export function aenderungenSeit(basis, cwd, nurTypenPaare = []) {
  const altFuer = new Map(nurTypenPaare.map(({ alt, neu }) => [neu, alt]));
  return [...verfolgteAenderungen(basis, cwd), ...neueDateien(cwd)].map((eintrag) => {
    const alt = altFuer.get(eintrag.pfad);
    return alt === undefined ? eintrag : { ...eintrag, zeilen: zeilenGegenAlt(basis, { alt, neu: eintrag.pfad }, cwd) };
  });
}

export function arbeitsstand(cwd) {
  const hash = createHash("sha256").update(git(["diff", "HEAD", "--binary", "--no-color", "--no-ext-diff"], { cwd }));
  for (const pfad of git(["ls-files", "--others", "--exclude-standard", "-z"], { cwd }).split(NUL).filter(Boolean)) {
    hash.update(`${NUL}${pfad}${NUL}`).update(readFileSync(join(cwd, pfad)));
  }
  return hash.digest("hex");
}

export function vormerken(pfade, cwd) {
  if (pfade.length > 0) git(["add", "--", ...pfade], { cwd });
}

export function festhalten(nachricht, cwd) {
  return spawnSync("git", ["commit", "-q", "-F", "-"], { cwd, encoding: "utf8", input: nachricht });
}

export function auftragsTrailer(cwd) {
  const ruecknahmen = git(["log", `--grep=${RUECKNAHME_ZEILE}`, "--format=%B"], { cwd });
  const zurueckgenommen = new Set([...ruecknahmen.matchAll(ZURUECKGENOMMEN)].map(([, alt]) => alt));
  const ausgabe = git(["log", "-z", `--grep=${AUFTRAG_ZEILE}`, "--format=%H%n%(trailers:only,unfold)"], { cwd });
  const commits = ausgabe.split(NUL).map((eintrag) => eintrag.split("\n"));
  const geltend = commits.filter(([sha]) => sha !== "" && !zurueckgenommen.has(sha));
  return geltend.map(([, ...trailer]) => new Set(trailer.filter(Boolean)));
}

export function weichZuruecksetzen(basis, cwd) {
  git(["reset", "-q", "--soft", basis], { cwd });
}
