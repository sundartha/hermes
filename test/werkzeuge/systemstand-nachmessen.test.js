import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT } from "./probe-repo.js";

const WORKFLOW_DIR = join(REPO_ROOT, ".github/workflows");
const NACHMESSEN = "systemstand-nachmessen.yml";
const SYSTEMSTAND = "systemstand.yml";
const TOP_LEVEL = /^\S/;
const TRIGGER_KEY = /^on:\s*$/;
const NAME_KEY = /^name:\s*(.+)$/;
const PUSH_KEY = /^ {2}push:\s*$/;
const TRIGGER_CHILD = /^ {2}\S/;
const BRANCHES_KEY = /^ {4}branches:\s*\[(.*)\]\s*$/;
const WORKFLOWS_KEY = /^ {4}workflows:\s*$/;
const LIST_ITEM = /^ {6}-\s+(.+)$/;
const QUOTES = /^["']|["']$/g;
const INLINE_TRIGGER = /^on:\s*\S/;
const PUSH_ONLY = /^ {2}push:\s*\S/;
const JOB_KEY = /^ {2}[a-z][\w-]*:\s*$/;
const PUSH_ONLY_JOB_IF = "    if: github.event.workflow_run.event == 'push'";
const GROUP_BY_EVENT = "  group: systemstand-nachmessen-${{ github.event.workflow_run.event }}";
const SYSTEMSTAND_RUN = /node tools\/systemstand\.mjs (--pruefen|--issues)\s*$/;

function lines(file) {
  return readFileSync(join(WORKFLOW_DIR, file), "utf8").split("\n");
}

function triggerBlock(workflow) {
  const start = workflow.findIndex((line) => TRIGGER_KEY.test(line));
  const rest = workflow.slice(start + 1);
  const end = rest.findIndex((line) => TOP_LEVEL.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

function pushBlock(workflow) {
  const block = triggerBlock(workflow);
  const start = block.findIndex((line) => PUSH_KEY.test(line));
  if (start === -1) return undefined;
  const rest = block.slice(start + 1);
  const end = rest.findIndex((line) => TRIGGER_CHILD.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

function pushBranchesLine(workflow) {
  return pushBlock(workflow)
    ?.map((line) => BRANCHES_KEY.exec(line))
    .find(Boolean);
}

function pushBranches(workflow) {
  const branches = pushBranchesLine(workflow);
  if (branches === undefined) return [];
  const entries = branches[1].split(",");
  return entries.map((branch) => branch.trim().replace(QUOTES, ""));
}

function workflowName(workflow) {
  const [, name] = workflow.map((line) => NAME_KEY.exec(line)).find(Boolean);
  return name.trim();
}

function pushedOnMaster() {
  const files = readdirSync(WORKFLOW_DIR).filter(
    (file) => file.endsWith(".yml") && file !== SYSTEMSTAND,
  );
  const pushed = files.map(lines).filter((workflow) => pushBranches(workflow).includes("master"));
  return pushed.map(workflowName).sort();
}

function unreadablePush(file) {
  const workflow = lines(file);
  if (workflow.some((line) => INLINE_TRIGGER.test(line))) return true;
  if (triggerBlock(workflow).some((line) => PUSH_ONLY.test(line))) return true;
  return pushBlock(workflow) !== undefined && pushBranchesLine(workflow) === undefined;
}

function jobsOf(workflow) {
  const start = workflow.indexOf("jobs:");
  return workflow.slice(start + 1).filter((line) => JOB_KEY.test(line));
}

function awaited() {
  const block = triggerBlock(lines(NACHMESSEN));
  const start = block.findIndex((line) => WORKFLOWS_KEY.test(line));
  const names = [];
  for (const line of block.slice(start + 1)) {
    const item = LIST_ITEM.exec(line);
    if (!item) break;
    names.push(item[1].trim());
  }
  return names.sort();
}

function systemstandRuns(file) {
  const options = lines(file).map((line) => SYSTEMSTAND_RUN.exec(line)?.[1]);
  return options.filter(Boolean).sort();
}

test("Systemstand nachmessen: wartet auf genau die Workflows, die bei einem Push auf master laufen", () => {
  assert.deepEqual(awaited(), pushedOnMaster());
});

test("Systemstand nachmessen: erkennt den push-Auslöser jeder Workflow-Datei", () => {
  const files = readdirSync(WORKFLOW_DIR).filter((file) => file.endsWith(".yml"));
  assert.deepEqual(files.filter(unreadablePush), []);
});

test("Systemstand nachmessen: misst nur nach Push-Läufen, getrennt von anderen Ereignissen", () => {
  const workflow = lines(NACHMESSEN);
  const guarded = workflow.filter((line) => line === PUSH_ONLY_JOB_IF);
  assert.equal(guarded.length, jobsOf(workflow).length);
  assert.ok(workflow.includes(GROUP_BY_EVENT));
});

test("Systemstand nachmessen: misst mit denselben Aufrufen wie der Systemstand auf master", () => {
  assert.deepEqual(systemstandRuns(NACHMESSEN), ["--issues", "--pruefen"]);
  assert.deepEqual(systemstandRuns(NACHMESSEN), systemstandRuns(SYSTEMSTAND));
});
