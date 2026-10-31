import { isAbsolute, join, resolve } from "node:path";
import { env } from "node:process";

import { block, isInside, readInput, realPath, startDirectory } from "./lib.mjs";
import { bashSrcFund } from "./src-schutz-bash.mjs";
import { AENDERUNG_HINWEIS, BUILD_ROLE, mainCheckout, productCodePath } from "./src-pfad.mjs";

const WORKTREES_DIRECTORY = join(".claude", "worktrees");

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
    AENDERUNG_HINWEIS,
  ]);
}

function bashFund(input, command) {
  try {
    return bashSrcFund(input, command);
  } catch (error) {
    return `Prüfung abgebrochen: ${error?.message ?? error}`;
  }
}

function blockBashProductCode(input, command) {
  if (env.HERMES_ROLLE === BUILD_ROLE) return;
  const fund = bashFund(input, command);
  if (fund === null) return;
  block("hooks/src-nur-lauf", [
    `Bash-Befehl blockiert (${fund}): Code unter src/ schreibt nur der Bau-Agent über lauf, auch per Shell.`,
    AENDERUNG_HINWEIS,
  ]);
}

function main() {
  const input = readInput();
  const command = input.tool_input?.command;
  if (typeof command === "string") return blockBashProductCode(input, command);
  const path = input.tool_input?.file_path;
  if (typeof path !== "string") return;
  const directory = startDirectory(input);
  const checkout = realPath(mainCheckout(directory));
  const target = realPath(isAbsolute(path) ? path : resolve(directory, path));
  blockMainCheckout(path, target, checkout);
  blockProductCode(target, checkout);
}

main();
