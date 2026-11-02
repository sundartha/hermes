import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { REPO_ROOT } from "./probe-repo.js";

const WORKFLOW_DIR = join(REPO_ROOT, ".github/workflows");
const WORKFLOW_FILE = /\.ya?ml$/;
const LINE_BREAK = /\r?\n/;
const NEXT_STEP = /^ {6}- /;
const NEXT_JOB = /^ {2}[a-z][\w-]*:$/;
const STEP_SCRIPT_START = "        run: |";
const STEP_SCRIPT_INDENT = 10;
const CI_WORKFLOW = "ci.yml";
const COLLECTING_STEP = "Alle Jobs erfolgreich";

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

export function workflowStepScript(file, step, directory = WORKFLOW_DIR) {
  const body = workflowStepLines(file, step, directory);
  const start = body.indexOf(STEP_SCRIPT_START);
  assert.notEqual(start, -1, `${STEP_SCRIPT_START.trim()} fehlt im Schritt ${step} in ${file}`);
  return body
    .slice(start + 1)
    .map((line) => line.slice(STEP_SCRIPT_INDENT))
    .join("\n");
}

export function sammeljob(ereignis, ergebnisse) {
  const needs = Object.fromEntries(Object.entries(ergebnisse).map(([job, result]) => [job, { result }]));
  const umgebung = { ...env, NEEDS: JSON.stringify(needs), EREIGNIS: ereignis };
  const lauf = spawnSync("bash", ["-c", workflowStepScript(CI_WORKFLOW, COLLECTING_STEP)], { encoding: "utf8", env: umgebung });
  return { status: lauf.status, meldung: lauf.stdout + lauf.stderr };
}
