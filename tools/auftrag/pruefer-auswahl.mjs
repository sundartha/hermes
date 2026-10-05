import { spawnSync } from "node:child_process";
import { env } from "node:process";

import { istKritisch } from "./agenten.mjs";

const PROBE_BRANCH = /^(?:rotprobe|beleg)\//;
const LEERRAUM = /\s+/;
const NUL = "\0";
const ZEILENUMBRUCH = "\n";
const OHNE_FARBE = ["--no-color", "--no-ext-diff", "--no-renames"];
const MAX_GIT_AUSGABE = 268_435_456;

export function gitAusgabe(args, root, { eingabe, kodierung = "utf8" } = {}) {
  const lauf = spawnSync("git", args, {
    cwd: root,
    encoding: kodierung,
    input: eingabe,
    maxBuffer: MAX_GIT_AUSGABE,
  });
  if (lauf.status !== 0) {
    throw new Error(
      `git ${args[0]} ist mit Exit ${lauf.status} gescheitert: ${String(lauf.stderr ?? "")}`,
    );
  }
  return lauf.stdout;
}

export function istProbeBranch(branch) {
  return PROBE_BRANCH.test(branch);
}

export function istEigenesRepo(prRepo) {
  const eigenes = env.GITHUB_REPOSITORY ?? "";
  return eigenes !== "" && prRepo === eigenes;
}

export function commitNachricht(sha, root) {
  return gitAusgabe(["log", "-1", "--format=%B", sha], root);
}

export function patchIdVon(sha, root) {
  const anzeige = gitAusgabe(["show", ...OHNE_FARBE, sha], root);
  const ausgabe = gitAusgabe(["patch-id", "--verbatim"], root, { eingabe: anzeige });
  return ausgabe.trim().split(LEERRAUM)[0] ?? "";
}

export function geaenderteDateien(sha, root) {
  const ausgabe = gitAusgabe(
    ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--root", "--no-renames", sha],
    root,
  );
  return ausgabe.split(NUL).filter(Boolean);
}

function commitsZwischen(basis, head, root) {
  const ausgabe = gitAusgabe(["rev-list", "--reverse", "--parents", `${basis}..${head}`], root);
  return ausgabe
    .split(ZEILENUMBRUCH)
    .filter(Boolean)
    .map((zeile) => {
      const [sha, ...eltern] = zeile.split(LEERRAUM);
      return { sha, merge: eltern.length > 1 };
    });
}

function beschreibung({ sha, merge }, root) {
  const dateien = geaenderteDateien(sha, root);
  return {
    sha,
    patchId: patchIdVon(sha, root),
    dateien,
    kritisch: dateien.some((pfad) => istKritisch(pfad)),
    nachricht: commitNachricht(sha, root),
    merge,
  };
}

export function zuPruefendeCommits({ basis, head, branch, prRepo, root }) {
  if (istProbeBranch(branch) && istEigenesRepo(prRepo)) return { probeBranch: true, commits: [] };
  const commits = commitsZwischen(basis, head, root).map((commit) => beschreibung(commit, root));
  return { probeBranch: false, commits };
}
