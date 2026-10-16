import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./probe-repo.js";

const WORKFLOW_DIR = join(REPO_ROOT, ".github/workflows");
const WORKFLOW_FILE = /\.ya?ml$/;
const LINE_BREAK = /\r?\n/;

export function workflowFiles(directory = WORKFLOW_DIR) {
  return readdirSync(directory).filter((file) => WORKFLOW_FILE.test(file));
}

export function workflowLines(file, directory = WORKFLOW_DIR) {
  return readFileSync(join(directory, file), "utf8").split(LINE_BREAK);
}
