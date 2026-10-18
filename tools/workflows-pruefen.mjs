import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { zweckBlock } from "./auftrag/zweck.mjs";
import {
  SECRETS_PATTERN,
  indentOf,
  isContentLine,
  mentionsWorkflowRun,
  structureRules,
  triggerSection,
  workflowNameFindings,
} from "./workflows-pruefen/struktur.mjs";

const DEFAULT_WORKFLOW_DIR = ".github/workflows";
const DEFAULT_ACTIONS_DIR = ".github/actions";
const NON_BLOCKING_PATTERNS = [/continue-on-error/, /\|\|\s*true/];
const PULL_REQUEST_TARGET_PATTERN = /\bpull_request_target\b/;
const USES_REFERENCE_PATTERN = /\buses:\s*["']?([^\s"'#]+)/;
const COMMIT_SHA_REFERENCE_PATTERN = /@[0-9a-f]{40}$/;
const LOCAL_WORKFLOW_PATTERN = /^\.\/\.github\/workflows\/([\w.-]+\.ya?ml)$/;
const LOCAL_ACTION_PATTERN = /^\.\/\.github\/actions\/(\w[\w.-]*)$/;
const ACTION_FILE_NAME = "action.yml";
const ACTION_USING_PATTERN = /(?:^|[\s{,])["']?using["']?\s*:\s*["']?([\w-]*)/;
const COMPOSITE = "composite";
const COMPOSITE_ONLY = "lokale Actions nur mit runs.using: composite";
const NPM_CI_PATTERN = /\bnpm\s+ci\b/;
const STEP_NAME_PATTERN = /^\s*(?:-\s+)?name\s*:/;
const IGNORE_SCRIPTS_PATTERN = /--ignore-scripts(?:=true)?(?=\s|$)/;
const PRODUCTION_ENVIRONMENT_PATTERN = /^\s*environment\s*:\s*["']?produktion["']?\s*(?:#.*)?$/i;
const PRODUCTION_FLOW_PATTERN =
  /^\s*environment\s*:\s*\{[^}]*\bname\s*:\s*["']?produktion["']?\s*[,}]/i;
const PRODUCTION_NAME_PATTERN = /^\s*name\s*:\s*["']?produktion["']?\s*(?:#.*)?$/i;
const ENVIRONMENT_BLOCK_PATTERN = /^\s*environment\s*:\s*(?:#.*)?$/;
const ENVIRONMENT_KEY_PATTERN = /^\s*(?:-\s+)?["']?environment["']?\s*:/;
const PULL_REQUEST_TRIGGER_PATTERN = /\b(?:pull_request|merge_group)/;
const SECRET_WORKFLOWS_NAME = "tools/basis/geheimnis-workflows.json";
const ZWECK = "github/workflows";
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

function localActionFinding(reference, { actionsDir, localActionsAllowed }) {
  const action = LOCAL_ACTION_PATTERN.exec(reference)?.[1];
  if (action === undefined || !existsSync(join(actionsDir, action, ACTION_FILE_NAME))) {
    return `${reference} ist nicht per 40-stelliger Commit-SHA eingebunden`;
  }
  if (localActionsAllowed) return undefined;
  return `${reference}: lokale Actions nur in Workflows außerhalb von ${SECRET_WORKFLOWS_NAME} und ohne workflow_run`;
}

function actionWithoutCommitSha({ workflowDir, actionsDir }, localActionsAllowed) {
  return (line) => {
    const reference = USES_REFERENCE_PATTERN.exec(line)?.[1];
    if (reference === undefined || COMMIT_SHA_REFERENCE_PATTERN.test(reference)) return undefined;
    const local = LOCAL_WORKFLOW_PATTERN.exec(reference)?.[1];
    if (local !== undefined && existsSync(join(workflowDir, local))) return undefined;
    return localActionFinding(reference, { actionsDir, localActionsAllowed });
  };
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

function parentLine(lines, index) {
  const indent = indentOf(lines[index]);
  return lines.slice(0, index).findLast((line) => isContentLine(line) && indentOf(line) < indent);
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

function environmentOutsideList(line) {
  if (!ENVIRONMENT_KEY_PATTERN.test(line)) return undefined;
  return `environment: nur in Workflows aus ${SECRET_WORKFLOWS_NAME}`;
}

const LINE_RULES = [
  ...NON_BLOCKING_PATTERNS.map(nonBlockingStepRule),
  pullRequestTarget,
  npmCiWithInstallScripts,
];

function runsForPullRequests(lines) {
  const section = triggerSection(lines);
  return section === undefined || PULL_REQUEST_TRIGGER_PATTERN.test(section);
}

function lineRulesFor(lines, { listed, directories }) {
  const pullRequestRules = runsForPullRequests(lines) ? [secretsInPullRequestWorkflow] : [];
  const localActionsAllowed = !listed && !mentionsWorkflowRun(lines);
  const rules = [
    ...LINE_RULES,
    actionWithoutCommitSha(directories, localActionsAllowed),
    ...pullRequestRules,
    ...structureRules(lines, { listed }),
  ];
  if (listed) return rules;
  return [...rules, secretsOutsideList, productionEnvironmentOutsideList, environmentOutsideList];
}

function listedWorkflow(filePath) {
  return SECRET_WORKFLOWS.includes(basename(filePath));
}

function neverListed() {
  return false;
}

function compositeOnly(line, index, lines) {
  const runsUsing = ACTION_USING_PATTERN.exec(line)?.[1];
  if (runsUsing !== undefined && runsUsing !== COMPOSITE) return COMPOSITE_ONLY;
  if (index > 0) return undefined;
  const composite = lines.some((other) => ACTION_USING_PATTERN.exec(other)?.[1] === COMPOSITE);
  return composite ? undefined : COMPOSITE_ONLY;
}

function findingsInFile(directories, isListed, extraRules = []) {
  return ({ filePath, lines }) => {
    const rules = [
      ...lineRulesFor(lines, { listed: isListed(filePath), directories }),
      ...extraRules,
    ];
    return lines.flatMap((line, index) =>
      rules
        .map((rule) => rule(line, index, lines))
        .filter(Boolean)
        .map((finding) => `${filePath}:${index + 1}: ${finding}`),
    );
  };
}

function readWorkflow(filePath) {
  return { filePath, lines: readFileSync(filePath, "utf8").split("\n") };
}

function workflowFiles(workflowDir) {
  const paths = readdirSync(workflowDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(workflowDir, entry.name));
  return paths.sort().map(readWorkflow);
}

function actionFiles(actionsDir) {
  if (!existsSync(actionsDir)) return [];
  const paths = readdirSync(actionsDir).map((name) => join(actionsDir, name, ACTION_FILE_NAME));
  return paths
    .filter((filePath) => existsSync(filePath))
    .sort()
    .map(readWorkflow);
}

const [, , workflowDir = DEFAULT_WORKFLOW_DIR, actionsDir = DEFAULT_ACTIONS_DIR] = process.argv;
const directories = { workflowDir, actionsDir };
const workflows = workflowFiles(workflowDir);
const findings = [
  ...workflows.flatMap(findingsInFile(directories, listedWorkflow)),
  ...actionFiles(directories.actionsDir).flatMap(
    findingsInFile(directories, neverListed, [compositeOnly]),
  ),
  ...workflowNameFindings(workflows),
];
for (const finding of findings) console.error(finding);
if (findings.length > 0) {
  console.log(zweckBlock(ZWECK).join("\n"));
  process.exitCode = 1;
}
