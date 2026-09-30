import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

import { env } from "node:process";

import { block, readInput, repositoryRoot, startDirectory, withoutGitVariables } from "./lib.mjs";

const LINTED_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
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

function findings(report, root) {
  return report.flatMap(({ filePath, messages }) =>
    messages
      .filter(({ severity }) => severity === ERROR_SEVERITY)
      .map(({ line, column, message, ruleId }) => {
        const file = relative(root, filePath);
        return `${file}:${line}:${column} ${message} (${ruleId ?? "Parser"})`;
      }),
  );
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

function main() {
  const input = readInput();
  const directory = startDirectory(input);
  const file = targetFile(input, directory);
  if (file === null) return;
  const root = repositoryRoot(directory);
  const errors = findings(lintReport(root, file), root);
  if (errors.length === 0) return;
  const shown = errors.slice(0, MAX_FINDINGS);
  const hidden = errors.length - shown.length;
  const more = hidden > 0 ? [`… und ${hidden} weitere`] : [];
  block([`Lint: ${errors.length} Befunde in der geänderten Datei`, ...shown, ...more]);
}

main();
