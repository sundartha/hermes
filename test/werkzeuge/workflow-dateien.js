import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./probe-repo.js";

const WORKFLOW_DIR = join(REPO_ROOT, ".github/workflows");
const WORKFLOW_FILE = /\.ya?ml$/;
const LINE_BREAK = /\r?\n/;
const NEXT_STEP = /^ {6}- /;
const NEXT_JOB = /^ {2}[a-z][\w-]*:$/;

export function workflowFiles(directory = WORKFLOW_DIR) {
  return readdirSync(directory).filter((file) => WORKFLOW_FILE.test(file));
}

export function workflowLines(file, directory = WORKFLOW_DIR) {
  return readFileSync(join(directory, file), "utf8").split(LINE_BREAK);
}

export function workflowStepLines(file, step, directory = WORKFLOW_DIR) {
  const lines = workflowLines(file, directory);
  const start = lines.indexOf(`      - name: ${step}`);
  assert.notEqual(start, -1, `- name: ${step} fehlt in ${file}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => NEXT_STEP.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

export function workflowJobLines(file, job, directory = WORKFLOW_DIR) {
  const lines = workflowLines(file, directory);
  const start = lines.indexOf(`  ${job}:`);
  assert.notEqual(start, -1, `Job ${job} fehlt in ${file}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => NEXT_JOB.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}
