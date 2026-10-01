import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import {
  block,
  git,
  readInput,
  repositoryRoot,
  startDirectory,
  withoutGitVariables,
} from "./lib.mjs";

const MAX_OUTPUT_LINES = 60;
const REPAIR_SENTENCE = "Repariere den Code, nicht die Prüfung.";
const BEFORE_PUSH_FLAG = "--vor-push";
const GREEN_STATE_FILE = "pruefleiter-gruen";
const SCRATCH_INDEX_FILE = "pruefleiter-index";

function workingTreeHash(root, gitDirectory) {
  const index = join(gitDirectory, SCRATCH_INDEX_FILE);
  const environment = { GIT_INDEX_FILE: index };
  rmSync(index, { force: true });
  const added = git(root, ["add", "-A"], environment);
  const tree = added.ok ? git(root, ["write-tree"], environment) : added;
  rmSync(index, { force: true });
  return tree.ok ? tree.text : null;
}

function lastGreenHash(stateFile) {
  try {
    return readFileSync(stateFile, "utf8").trim();
  } catch {
    return null;
  }
}

function runPruefleiter(root) {
  return spawnSync("npm", ["run", "--silent", "pruefleiter", "--", BEFORE_PUSH_FLAG], {
    cwd: root,
    encoding: "utf8",
    env: withoutGitVariables(env),
    maxBuffer: Infinity,
  });
}

function failureLines({ stdout, stderr }) {
  const output = `${stdout ?? ""}${stderr ?? ""}`.split("\n").filter((line) => line.trim() !== "");
  return [...output.slice(0, MAX_OUTPUT_LINES - 1), REPAIR_SENTENCE];
}

function main() {
  const root = repositoryRoot(startDirectory(readInput()));
  const gitDirectory = git(root, ["rev-parse", "--absolute-git-dir"]).text;
  const stateFile = join(gitDirectory, GREEN_STATE_FILE);
  const hash = workingTreeHash(root, gitDirectory);
  if (hash !== null && hash === lastGreenHash(stateFile)) return;
  const result = runPruefleiter(root);
  if (result.status === 0) {
    if (hash !== null) writeFileSync(stateFile, hash);
    return;
  }
  block(failureLines(result));
}

main();
