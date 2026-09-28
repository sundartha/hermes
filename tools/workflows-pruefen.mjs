import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_WORKFLOW_DIR = ".github/workflows";
const NON_BLOCKING_PATTERNS = [/continue-on-error/, /\|\|\s*true/];

function findingsInFile(filePath) {
  const lines = readFileSync(filePath, "utf8").split("\n");
  return lines.flatMap((line, index) =>
    NON_BLOCKING_PATTERNS.map((pattern) => pattern.exec(line))
      .filter(Boolean)
      .map((match) => `${filePath}:${index + 1}: ${match[0]}`),
  );
}

function workflowFiles(workflowDir) {
  return readdirSync(workflowDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(workflowDir, entry.name))
    .sort();
}

const [, , workflowDir = DEFAULT_WORKFLOW_DIR] = process.argv;
const findings = workflowFiles(workflowDir).flatMap(findingsInFile);
for (const finding of findings) console.error(finding);
if (findings.length > 0) process.exitCode = 1;
