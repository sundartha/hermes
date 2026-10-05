import assert from "node:assert/strict";
import { join } from "node:path";

import { REPO_ROOT, probeDirectory, runIn } from "./probe-repo.js";

export const TOOL = join(REPO_ROOT, "tools/workflows-pruefen.mjs");
const CI_WORKFLOW = [
  "name: CI",
  "on:",
  "  push:",
  "    branches: [master]",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  test:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Schritt",
  "        run: echo ok",
  "",
].join("\n");

export function runCheck(context, files) {
  const directory = probeDirectory(context, { "ci.yml": CI_WORKFLOW, ...files });
  const result = runIn(directory, process.execPath, [TOOL, directory]);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

export function expectFinding(
  context,
  { name = "pruefer-pruefen.yml", lines, target, message, files = {} },
) {
  const result = runCheck(context, { ...files, [name]: lines.join("\n") });
  assert.equal(result.status, 1, result.output);
  const where = `${name}:${lines.indexOf(target) + 1}: ${message}`;
  assert.ok(result.output.includes(where), `${where} fehlt in:\n${result.output}`);
  return result.output;
}

export function expectClean(context, name, lines) {
  const result = runCheck(context, { [name]: lines.join("\n") });
  assert.equal(result.status, 0, result.output);
  assert.equal(result.output, "");
}
