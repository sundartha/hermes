import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { env } from "node:process";

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
const PRODUCT_CODE = "src/";
const BUILD_ROLE = "bau";

function mainCheckout(directory) {
  const common = git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return common.ok ? dirname(common.text) : repositoryRoot(directory);
}

function existingDirectory(path) {
  const parent = dirname(path);
  return existsSync(parent) || parent === path ? parent : existingDirectory(parent);
}

function productCodePath(target, checkout) {
  const directory = existingDirectory(target);
  if (realPath(mainCheckout(directory)) !== checkout) return null;
  const root = realPath(repositoryRoot(directory));
  const path = relative(root, target).split(sep).join("/");
  return path.toLowerCase().startsWith(PRODUCT_CODE) ? path : null;
}

function blockMainCheckout(path, target, checkout) {
  const insideMain = isInside(target, checkout);
  const insideWorktrees = isInside(target, join(checkout, WORKTREES_DIRECTORY));
  if (!insideMain || insideWorktrees) return;
  block("hooks/worktree-pflicht", [
    `Schreibzugriff im Haupt-Checkout blockiert: ${path}`,
    `Arbeite in einem Worktree unter ${WORKTREES_DIRECTORY}/.`,
  ]);
}

function blockProductCode(target, checkout) {
  const code = productCodePath(target, checkout);
  if (code === null || env.HERMES_ROLLE === BUILD_ROLE) return;
  block("hooks/src-nur-lauf", [
    `Schreibzugriff auf ${code} blockiert: Code unter src/ schreibt nur der Bau-Agent über lauf.`,
    "Beginne mit dem Skill aenderung: erst Fragen, dann Einstufung, dann Pitch bzw. Dokumente, dann lauf.",
  ]);
}

function main() {
  const input = readInput();
  const path = input.tool_input?.file_path;
  if (typeof path !== "string") return;
  const directory = startDirectory(input);
  const checkout = realPath(mainCheckout(directory));
  const target = realPath(isAbsolute(path) ? path : resolve(directory, path));
  blockMainCheckout(path, target, checkout);
  blockProductCode(target, checkout);
}

main();
