import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  block,
  git,
  isInside,
  readInput,
  realPath,
  repositoryRoot,
  startDirectory,
} from "./lib.mjs";

const WORKTREES_DIRECTORY = join(".claude", "worktrees");

function mainCheckout(directory) {
  const common = git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return common.ok ? dirname(common.text) : repositoryRoot(directory);
}

function main() {
  const input = readInput();
  const path = input.tool_input?.file_path;
  if (typeof path !== "string") return;
  const directory = startDirectory(input);
  const checkout = realPath(mainCheckout(directory));
  const target = realPath(isAbsolute(path) ? path : resolve(directory, path));
  const insideMain = isInside(target, checkout);
  const insideWorktrees = isInside(target, join(checkout, WORKTREES_DIRECTORY));
  if (!insideMain || insideWorktrees) return;
  block([
    `Schreibzugriff im Haupt-Checkout blockiert: ${path}`,
    `Arbeite in einem Worktree unter ${WORKTREES_DIRECTORY}/.`,
  ]);
}

main();
