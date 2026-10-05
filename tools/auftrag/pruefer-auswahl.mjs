import { spawnSync } from "node:child_process";
import { env } from "node:process";

import { istKritisch } from "./agenten.mjs";

const PROBE_BRANCH = /^(?:rotprobe|beleg)\//;
const PAKET_BRANCH = /^paket\/([^/-]+)-/;
const PAKET_ZEILE = /^Paket: (\S+)$/gm;
const AUFTRAG_ZEILE = /^Auftrag: \S+$/m;
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

export function istEigenerPaketCommit(nachricht, branch) {
  const paket = PAKET_BRANCH.exec(branch)?.[1];
  if (paket === undefined || AUFTRAG_ZEILE.test(nachricht)) return false;
  return [...nachricht.matchAll(PAKET_ZEILE)].some((treffer) => treffer[1] === paket);
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
  const ausgabe = gitAusgabe(["rev-list", "--reverse", "--no-merges", `${basis}..${head}`], root);
  return ausgabe.split(ZEILENUMBRUCH).filter(Boolean);
}

function beschreibung({ sha, nachricht }, root) {
  const dateien = geaenderteDateien(sha, root);
  return {
    sha,
    patchId: patchIdVon(sha, root),
    dateien,
    kritisch: dateien.some((pfad) => istKritisch(pfad)),
    nachricht,
  };
}

export function zuPruefendeCommits({ basis, head, branch, prRepo, root }) {
  if (istProbeBranch(branch)) return { probeBranch: true, commits: [], weggelassen: [] };
  const alle = commitsZwischen(basis, head, root).map((sha) => ({
    sha,
    nachricht: commitNachricht(sha, root),
  }));
  const paketBranch = istEigenesRepo(prRepo) ? branch : "";
  const weggelassen = alle
    .filter(({ nachricht }) => istEigenerPaketCommit(nachricht, paketBranch))
    .map(({ sha }) => sha);
  const commits = alle
    .filter(({ sha }) => !weggelassen.includes(sha))
    .map((commit) => beschreibung(commit, root));
  return { probeBranch: false, commits, weggelassen };
}
