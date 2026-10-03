import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const DEFAULT_WORKFLOW_DIR = ".github/workflows";
const NON_BLOCKING_PATTERNS = [/continue-on-error/, /\|\|\s*true/];
const PULL_REQUEST_TARGET_PATTERN = /\bpull_request_target\b/;
const USES_REFERENCE_PATTERN = /\buses:\s*["']?([^\s"'#]+)/;
const COMMIT_SHA_REFERENCE_PATTERN = /@[0-9a-f]{40}$/;
const NPM_CI_PATTERN = /\bnpm\s+ci\b/;
const STEP_NAME_PATTERN = /^\s*(?:-\s+)?name\s*:/;
const IGNORE_SCRIPTS_PATTERN = /--ignore-scripts(?:=true)?(?=\s|$)/;
const SECRETS_PATTERN = /\bsecrets\b/i;
const PRODUCTION_ENVIRONMENT_PATTERN = /^\s*environment\s*:\s*["']?produktion["']?\s*(?:#.*)?$/i;
const PRODUCTION_FLOW_PATTERN =
  /^\s*environment\s*:\s*\{[^}]*\bname\s*:\s*["']?produktion["']?\s*[,}]/i;
const PRODUCTION_NAME_PATTERN = /^\s*name\s*:\s*["']?produktion["']?\s*(?:#.*)?$/i;
const ENVIRONMENT_BLOCK_PATTERN = /^\s*environment\s*:\s*(?:#.*)?$/;
const INDENT_PATTERN = /^\s*/;
const CONTENT_LINE_PATTERN = /^\s*[^\s#]/;
const TRIGGER_KEY_PATTERN = /^["']?on["']?\s*:/;
const TOP_LEVEL_KEY_PATTERN = /^[^\s#]/;
const PULL_REQUEST_TRIGGER_PATTERN = /\bpull_request/;
const SECRET_WORKFLOWS_NAME = "tools/basis/geheimnis-workflows.json";
const SECRET_WORKFLOWS = JSON.parse(
  readFileSync(new URL("basis/geheimnis-workflows.json", import.meta.url), "utf8"),
);

function nonBlockingStepRule(pattern) {
  return (line) => pattern.exec(line)?.[0];
}

function pullRequestTarget(line) {
  if (!PULL_REQUEST_TARGET_PATTERN.test(line)) return undefined;
  return "pull_request_target ist als Auslöser verboten";
}

function actionWithoutCommitSha(line) {
  const reference = USES_REFERENCE_PATTERN.exec(line)?.[1];
  if (reference === undefined || COMMIT_SHA_REFERENCE_PATTERN.test(reference)) return undefined;
  return `${reference} ist nicht per 40-stelliger Commit-SHA eingebunden`;
}

function npmCiWithInstallScripts(line) {
  if (STEP_NAME_PATTERN.test(line) || !NPM_CI_PATTERN.test(line)) return undefined;
  if (IGNORE_SCRIPTS_PATTERN.test(line)) return undefined;
  return "npm ci ohne --ignore-scripts";
}

function secretsInPullRequestWorkflow(line) {
  if (!SECRETS_PATTERN.test(line)) return undefined;
  return "secrets in einem Workflow, der für Pull Requests läuft; für die GitHub-API github.token benutzen";
}

function secretsOutsideList(line) {
  if (!SECRETS_PATTERN.test(line)) return undefined;
  return `secrets nur in Workflows aus ${SECRET_WORKFLOWS_NAME}`;
}

function indentOf(line) {
  return INDENT_PATTERN.exec(line)[0].length;
}

function parentLine(lines, index) {
  const indent = indentOf(lines[index]);
  return lines
    .slice(0, index)
    .findLast((line) => CONTENT_LINE_PATTERN.test(line) && indentOf(line) < indent);
}

function namesProductionEnvironment(line, index, lines) {
  if (PRODUCTION_ENVIRONMENT_PATTERN.test(line) || PRODUCTION_FLOW_PATTERN.test(line)) return true;
  if (!PRODUCTION_NAME_PATTERN.test(line)) return false;
  return ENVIRONMENT_BLOCK_PATTERN.test(parentLine(lines, index) ?? "");
}

function productionEnvironmentOutsideList(line, index, lines) {
  if (!namesProductionEnvironment(line, index, lines)) return undefined;
  return `Environment produktion nur in Workflows aus ${SECRET_WORKFLOWS_NAME}`;
}

const LINE_RULES = [
  ...NON_BLOCKING_PATTERNS.map(nonBlockingStepRule),
  pullRequestTarget,
  actionWithoutCommitSha,
  npmCiWithInstallScripts,
];

function triggerSection(lines) {
  const start = lines.findIndex((line) => TRIGGER_KEY_PATTERN.test(line));
  if (start === -1) return undefined;
  const nextTopLevelKey = lines.findIndex(
    (line, index) => index > start && TOP_LEVEL_KEY_PATTERN.test(line),
  );
  return lines.slice(start, nextTopLevelKey === -1 ? lines.length : nextTopLevelKey).join("\n");
}

function runsForPullRequests(lines) {
  const section = triggerSection(lines);
  return section === undefined || PULL_REQUEST_TRIGGER_PATTERN.test(section);
}

function lineRulesFor(filePath, lines) {
  const rules = runsForPullRequests(lines)
    ? [...LINE_RULES, secretsInPullRequestWorkflow]
    : LINE_RULES;
  if (SECRET_WORKFLOWS.includes(basename(filePath))) return rules;
  return [...rules, secretsOutsideList, productionEnvironmentOutsideList];
}

function findingsInFile(filePath) {
  const lines = readFileSync(filePath, "utf8").split("\n");
  const rules = lineRulesFor(filePath, lines);
  return lines.flatMap((line, index) =>
    rules
      .map((rule) => rule(line, index, lines))
      .filter(Boolean)
      .map((finding) => `${filePath}:${index + 1}: ${finding}`),
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
