import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { env } from "node:process";

import { block, readInput, repositoryRoot, startDirectory, withoutGitVariables } from "./lib.mjs";

const PURPOSE_GROUPS = new URL("../../tools/lint-zweck.mjs", import.meta.url);

const LINTED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);
const ESLINT_PACKAGE = "eslint/package.json";
const ESLINT_BIN = join("bin", "eslint.js");
const ERROR_SEVERITY = 2;
const MAX_FINDINGS = 30;

function targetFile(input, directory) {
  const path = input.tool_input?.file_path;
  if (typeof path !== "string") return null;
  const absolute = isAbsolute(path) ? path : resolve(directory, path);
  const lintable = LINTED_EXTENSIONS.has(extname(absolute)) && existsSync(absolute);
  return lintable ? absolute : null;
}

function errorMessages(report) {
  return report.flatMap(({ filePath, messages }) =>
    messages.filter(({ severity }) => severity === ERROR_SEVERITY).map((message) => ({ ...message, filePath })),
  );
}

function findings(errors, root) {
  return errors.map(({ filePath, line, column, message, ruleId }) => {
    const file = relative(root, filePath);
    return `${file}:${line}:${column} ${message} (${ruleId ?? "Parser"})`;
  });
}

async function purposeLines(errors) {
  try {
    const { lintZweckZeilen } = await import(PURPOSE_GROUPS);
    return lintZweckZeilen(errors);
  } catch (error) {
    return [`Zweck-Texte der Regeln nicht geladen: ${error.message}`];
  }
}

function eslintBinary(root) {
  const packageJson = createRequire(join(root, "package.json")).resolve(ESLINT_PACKAGE);
  return join(dirname(packageJson), ESLINT_BIN);
}

function lintReport(root, file) {
  const run = spawnSync(process.execPath, [eslintBinary(root), "--format", "json", file], {
    cwd: root,
    encoding: "utf8",
    env: withoutGitVariables(env),
  });
  try {
    return JSON.parse(run.stdout);
  } catch {
    return [];
  }
}

async function main() {
  const input = readInput();
  const directory = startDirectory(input);
  const file = targetFile(input, directory);
  if (file === null) return;
  const root = repositoryRoot(directory);
  const errors = errorMessages(lintReport(root, file));
  if (errors.length === 0) return;
  const lines = findings(errors, root);
  const shown = lines.slice(0, MAX_FINDINGS);
  const hidden = lines.length - shown.length;
  const more = hidden > 0 ? [`… und ${hidden} weitere`] : [];
  const header = `Lint: ${lines.length} Befunde in der geänderten Datei`;
  block("hooks/lint-datei", [header, ...shown, ...more, ...(await purposeLines(errors))]);
}

await main();
