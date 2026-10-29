import { spawnSync } from "node:child_process";

import { istTestdatei } from "./format.mjs";
import { git } from "./git.mjs";
import { kollisionenSeit } from "./kollision.mjs";
import { absicherungsBranch } from "./worktrees.mjs";

const MARKE = "refs/absicherung-uebernommen/";
const KEIN_FEHLER = 0;
const KURZ = 7;
const NUR_COMMIT = "^{commit}";

function aufloesen(root, ref) {
  const lauf = spawnSync("git", ["rev-parse", "--verify", "-q", ref + NUR_COMMIT], { cwd: root, encoding: "utf8" });
  return lauf.status === KEIN_FEHLER ? lauf.stdout.trim() : null;
}

function bisherUebernommen(root, marke, spitze) {
  const stand = aufloesen(root, marke);
  const vorfahr = stand !== null && spawnSync("git", ["merge-base", "--is-ancestor", stand, spitze], { cwd: root }).status === KEIN_FEHLER;
  return vorfahr ? stand : git(["merge-base", "HEAD", spitze], { cwd: root }).trim();
}

function nichtTests(root, commit) {
  const dateien = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--root", commit], { cwd: root }).split("\0").filter(Boolean);
  return dateien.filter((datei) => !istTestdatei(datei));
}

function fremdeAenderungen(root, commits) {
  return commits.flatMap((commit) => nichtTests(root, commit).map((datei) => `Absicherungs-Commit ${commit.slice(0, KURZ)} ändert ${datei} außerhalb von test/`));
}

function uebernommen(root, { commits, spitze, marke }) {
  const pick = spawnSync("git", ["cherry-pick", "--allow-empty", "--keep-redundant-commits", ...commits], { cwd: root, encoding: "utf8" });
  if (pick.status !== KEIN_FEHLER) {
    spawnSync("git", ["cherry-pick", "--abort"], { cwd: root });
    return [`Absicherungs-Commits lassen sich nicht übernehmen: ${pick.stderr.trim()}`];
  }
  git(["update-ref", marke, spitze], { cwd: root });
  return [];
}

export function uebernimmAbsicherung(root, phase) {
  const spitze = aufloesen(root, `refs/heads/${absicherungsBranch(phase)}`);
  if (spitze === null) return [];
  const marke = `${MARKE}${phase.phase}`;
  const basis = bisherUebernommen(root, marke, spitze);
  const commits = git(["rev-list", "--reverse", `${basis}..${spitze}`], { cwd: root }).split("\n").filter(Boolean);
  if (commits.length === 0) return [];
  const befunde = [...fremdeAenderungen(root, commits), ...kollisionenSeit({ cwd: root, basis, stand: "HEAD", commit: spitze })];
  if (befunde.length > 0) return [...befunde, `Die Absicherung der Phase ${phase.phase} wird nicht übernommen. Ausweg: den Branch ${absicherungsBranch(phase)} löschen; dann prüft jeder Auftrag den alten Stand voll.`];
  return uebernommen(root, { commits, spitze, marke });
}
