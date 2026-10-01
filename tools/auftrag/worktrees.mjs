import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { git } from "./git.mjs";
import { REMOTE } from "./sperren.mjs";

export const MASTER = `${REMOTE}/master`;
const WORKTREES = "arbeitsbaeume";
const EINSCHLUSS = ".worktreeinclude";
const ECHTE_UMGEBUNG = ".env";
const INSTALLATION = ["ci", "--prefer-offline", "--ignore-scripts"];

export function phasenBranch({ issue, phase }) {
  return `phase/${issue}-${phase}`;
}

function integrationsPfad(root, { issue, phase }) {
  return join(root, WORKTREES, `phase-${issue}-${phase}`);
}

function auftragsName({ phase }, kennung) {
  return `${phase.issue}-${kennung}`;
}

function auftragsPfad(ort, kennung) {
  return join(ort.integration, WORKTREES, auftragsName(ort, kennung));
}

function istIgnoriert(cwd, pfad) {
  return spawnSync("git", ["check-ignore", "-q", "--", pfad], { cwd }).status === 0;
}

function kopiereEinschluesse(root, ziel) {
  const liste = join(root, EINSCHLUSS);
  if (!existsSync(liste)) return;
  const eintraege = readFileSync(liste, "utf8").split("\n").map((zeile) => zeile.trim());
  const pfade = eintraege.filter((pfad) => pfad !== "" && pfad !== ECHTE_UMGEBUNG);
  for (const pfad of pfade.filter((kandidat) => existsSync(join(root, kandidat)) && istIgnoriert(ziel, kandidat))) {
    mkdirSync(dirname(join(ziel, pfad)), { recursive: true });
    copyFileSync(join(root, pfad), join(ziel, pfad));
  }
}

function einrichten(root, pfad) {
  kopiereEinschluesse(root, pfad);
  const lauf = spawnSync("npm", INSTALLATION, { cwd: pfad, encoding: "utf8" });
  if (lauf.status !== 0) {
    throw new Error(`npm ${INSTALLATION.join(" ")} in ${pfad} endete mit Exit ${lauf.status}: ${lauf.stderr}`);
  }
}

export function legeIntegrationAn(root, phase) {
  git(["fetch", "-q", REMOTE, "master"], { cwd: root });
  const pfad = integrationsPfad(root, phase);
  git(["worktree", "add", "-q", "-b", phasenBranch(phase), pfad, MASTER], { cwd: root });
  einrichten(root, pfad);
  return pfad;
}

export function legeAuftragAn(ort, kennung) {
  const pfad = auftragsPfad(ort, kennung);
  git(["worktree", "add", "-q", "-b", `worktree-${auftragsName(ort, kennung)}`, pfad, "HEAD"], { cwd: ort.integration });
  einrichten(ort.root, pfad);
  return pfad;
}

export function sichereDiff(pfad, basis) {
  git(["add", "-N", "--", "."], { cwd: pfad });
  return git(["diff", "--no-color", basis], { cwd: pfad });
}

export function entferneAuftrag(ort, kennung) {
  const pfad = auftragsPfad(ort, kennung);
  if (existsSync(pfad)) git(["worktree", "remove", "--force", pfad], { cwd: ort.root });
  spawnSync("git", ["branch", "-q", "-D", `worktree-${auftragsName(ort, kennung)}`], { cwd: ort.root });
}

export function entferneIntegration(ort, { branch }) {
  if (existsSync(ort.integration)) git(["worktree", "remove", "--force", ort.integration], { cwd: ort.root });
  git(["worktree", "prune"], { cwd: ort.root });
  if (branch) spawnSync("git", ["branch", "-q", "-D", phasenBranch(ort.phase)], { cwd: ort.root });
}
