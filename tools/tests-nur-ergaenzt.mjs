import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { env } from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { Linter } from "eslint";

const TEST_DIR = "test/";
const UNPROTECTED_TEST_PATHS = [":(exclude)test/testbaenke-run.mjs", ":(exclude)test/werkzeuge/"];
const GATE_TESTS_FILE = "tools/gate-tests.json";
const BEHAVIOUR_LABEL = "verhalten-geaendert";
const APPROVERS = ["Antonio20045", "jonas986"];
const ALLOWED_LIST_HEADING = "Tests, deren Erwartung sich ändern darf";
const TESTSCHUTZ_WORKFLOW = "testschutz.yml";
const GITHUB_API = "https://api.github.com";
const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const USER_AGENT = "hermes-testschutz";
const TEST_FUNCTIONS = new Set(["test", "it"]);
const SUBTEST_METHOD = "test";
const SUBTEST_MIN_ARGUMENTS = 2;
const FUNCTION_NODE_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);
const JAVASCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const COMMONJS_EXTENSION = ".cjs";
const STATUS_ADDED = "A";
const STATUS_DELETED = "D";
const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+/;
const BINARY_DIFF_PATTERN = /^Binary files /m;
const HEADING_PATTERN = /^#{1,6}\s+(.+)$/;
const LIST_MARKER_PATTERN = /^(?:[-*+]|\d+[.)])\s+/;
const CODE_SPAN_PATTERN = /^`(.+)`$/;
const LINE_BREAK_PATTERN = /\r?\n/;
const CLOSING_REFERENCE_PATTERN = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;
const DEFAULT_HUNK_LENGTH = 1;
const NAME_STATUS_FIELDS = 2;
const MAX_GIT_OUTPUT_BYTES = 67_108_864;
const OPEN_PULL_REQUESTS_PAGE_SIZE = 100;
const MAX_LABEL_EVENTS = 100;
const RUN_POLL_INTERVAL_MS = 10_000;
const RUN_POLL_ATTEMPTS = 30;
const EXIT_FAILURE = 1;

const ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number
      body
      lastEditedAt
      timelineItems(last: ${MAX_LABEL_EVENTS}, itemTypes: [LABELED_EVENT, UNLABELED_EVENT]) {
        nodes {
          __typename
          ... on LabeledEvent { createdAt actor { login } label { name } }
          ... on UnlabeledEvent { createdAt actor { login } label { name } }
        }
      }
    }
  }
}`;

function parseOptions() {
  const { values } = parseArgs({
    options: { basis: { type: "string" }, pr: { type: "string" }, issue: { type: "string" } },
  });
  if (values.issue !== undefined) return { issue: Number(values.issue) };
  if (values.basis === undefined || values.pr === undefined) {
    throw new Error(
      "Aufruf: node tools/tests-nur-ergaenzt.mjs --basis <sha> --pr <nr> oder --issue <nr>",
    );
  }
  return { basis: values.basis, pullRequest: Number(values.pr) };
}

function git(args) {
  const result = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} ist gescheitert: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function changedExistingTestFiles(basis) {
  const fields = git([
    "diff",
    "--no-renames",
    "--name-status",
    "-z",
    basis,
    "HEAD",
    "--",
    TEST_DIR,
    ...UNPROTECTED_TEST_PATHS,
  ]).split("\0");
  const changes = [];
  for (let i = 0; i + 1 < fields.length; i += NAME_STATUS_FIELDS) {
    changes.push({ status: fields[i], file: fields[i + 1] });
  }
  return changes.filter(({ status }) => status !== STATUS_ADDED);
}

function removedLines(basis, file) {
  const diff = git([
    "diff",
    "--no-renames",
    "--no-color",
    "--no-ext-diff",
    "-U0",
    basis,
    "HEAD",
    "--",
    file,
  ]);
  const lines = diff.split("\n").flatMap((line) => {
    const match = HUNK_HEADER_PATTERN.exec(line);
    if (match === null) return [];
    const start = Number(match[1]);
    const length = match[2] === undefined ? DEFAULT_HUNK_LENGTH : Number(match[2]);
    return [...Array.from({ length }).keys()].map((offset) => start + offset);
  });
  return { lines, binary: BINARY_DIFF_PATTERN.test(diff) };
}

function callExpressions(sourceCode) {
  const found = [];
  const pending = [sourceCode.ast];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node.type === "CallExpression") found.push(node);
    for (const key of sourceCode.visitorKeys[node.type] ?? []) {
      pending.push(...[node[key]].flat().filter(Boolean));
    }
  }
  return found;
}

function isTestCall({ callee, arguments: args }) {
  if (callee.type === "Identifier") return TEST_FUNCTIONS.has(callee.name);
  if (callee.type !== "MemberExpression") return false;
  if (TEST_FUNCTIONS.has(callee.object.name)) return true;
  const isSubtest = callee.property.name === SUBTEST_METHOD && args.length >= SUBTEST_MIN_ARGUMENTS;
  return isSubtest && FUNCTION_NODE_TYPES.has(args.at(-1).type);
}

function staticTestName(argument) {
  if (argument?.type === "Literal" && typeof argument.value === "string") return argument.value;
  if (argument?.type === "TemplateLiteral" && argument.expressions.length === 0) {
    const [quasi] = argument.quasis;
    return quasi.value.cooked;
  }
  return undefined;
}

function testCases(file, source) {
  const sourceType = extname(file) === COMMONJS_EXTENSION ? "commonjs" : "module";
  const linter = new Linter();
  const messages = linter.verify(source, {
    languageOptions: { ecmaVersion: "latest", sourceType },
  });
  if (messages.some(({ fatal }) => fatal)) return [];
  const cases = callExpressions(linter.getSourceCode()).filter(isTestCall);
  const named = cases.map((node) => ({ name: staticTestName(node.arguments[0]), loc: node.loc }));
  return named.filter(({ name }) => name !== undefined);
}

function innermostTestName(cases, line) {
  const enclosing = cases.filter(({ loc }) => loc.start.line <= line && line <= loc.end.line);
  const span = ({ loc }) => loc.end.line - loc.start.line;
  return enclosing.toSorted((left, right) => span(left) - span(right))[0]?.name;
}

function groupLines(file, lines, nameOfLine) {
  const units = new Map();
  for (const line of lines) {
    const name = nameOfLine(line);
    if (!units.has(name)) units.set(name, { file, name, lines: [] });
    units.get(name).lines.push(line);
  }
  return [...units.values()];
}

function changedUnits(basis, { status, file }) {
  if (status === STATUS_DELETED) return [{ file, deleted: true, lines: [] }];
  const { lines, binary } = removedLines(basis, file);
  if (binary) return [{ file, name: undefined, lines: [] }];
  if (!JAVASCRIPT_EXTENSIONS.has(extname(file))) return groupLines(file, lines, () => undefined);
  const cases = testCases(file, git(["show", `${basis}:${file}`]));
  return groupLines(file, lines, (line) => innermostTestName(cases, line));
}

function gatesByTestFile() {
  const gates = JSON.parse(readFileSync(GATE_TESTS_FILE, "utf8"));
  const byFile = new Map();
  for (const [gate, { tests }] of Object.entries(gates)) {
    for (const file of tests) byFile.set(file, [...(byFile.get(file) ?? []), gate]);
  }
  return byFile;
}

function githubHeaders() {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN fehlt; die Prüfung braucht die GitHub-API.");
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
  };
}

function repositoryName() {
  const [owner, name] = (env.GITHUB_REPOSITORY ?? "").split("/");
  if (!owner || !name)
    throw new Error("GITHUB_REPOSITORY fehlt oder hat nicht die Form owner/name.");
  return { owner, name, full: `${owner}/${name}` };
}

async function graphql(query, number) {
  const { owner, name } = repositoryName();
  const response = await fetch(env.GITHUB_GRAPHQL_URL || GITHUB_GRAPHQL, {
    method: "POST",
    headers: githubHeaders(),
    body: JSON.stringify({ query, variables: { owner, name, number } }),
  });
  if (!response.ok) throw new Error(`Die GitHub-API antwortet mit HTTP ${response.status}.`);
  const { data, errors } = await response.json();
  if (errors?.length) {
    throw new Error(`Die GitHub-API meldet: ${errors.map(({ message }) => message).join("; ")}`);
  }
  return data.repository;
}

async function rest(method, path) {
  const response = await fetch(`${env.GITHUB_API_URL || GITHUB_API}${path}`, {
    method,
    headers: githubHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Die GitHub-API antwortet auf ${method} ${path} mit HTTP ${response.status}.`);
  }
  return response;
}

async function getJson(path) {
  const response = await rest("GET", path);
  return response.json();
}

function closedIssueNumbers(body) {
  const matches = (body ?? "").matchAll(CLOSING_REFERENCE_PATTERN);
  return [...new Set([...matches].map((match) => Number(match[1])))];
}

function labelProblem(issue) {
  const events = issue.timelineItems.nodes.filter(({ label }) => label?.name === BEHAVIOUR_LABEL);
  const last = events.at(-1);
  if (last?.__typename !== "LabeledEvent") {
    return `Issue #${issue.number} trägt das Label ${BEHAVIOUR_LABEL} nicht.`;
  }
  const actor = last.actor?.login ?? "ein unbekanntes Konto";
  if (!APPROVERS.includes(actor)) {
    return `Issue #${issue.number}: das Label ${BEHAVIOUR_LABEL} hat ${actor} gesetzt; es zählt nur, wenn ${APPROVERS.join(" oder ")} es setzen.`;
  }
  if (issue.lastEditedAt !== null && issue.lastEditedAt > last.createdAt) {
    return `Issue #${issue.number}: der Text wurde nach dem Label geändert; ${APPROVERS.join(" oder ")} müssen das Label neu setzen.`;
  }
  return undefined;
}

function itemText(line) {
  const text = line.trim().replace(LIST_MARKER_PATTERN, "").trim();
  return CODE_SPAN_PATTERN.exec(text)?.[1] ?? text;
}

function allowedNames(body) {
  const lines = (body ?? "").split(LINE_BREAK_PATTERN).map((line) => line.trim());
  const start = lines.findIndex(
    (line) => HEADING_PATTERN.exec(line)?.[1].trim() === ALLOWED_LIST_HEADING,
  );
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => HEADING_PATTERN.test(line));
  return rest
    .slice(0, end === -1 ? rest.length : end)
    .map(itemText)
    .filter(Boolean);
}

async function approval(pullRequest) {
  const { full } = repositoryName();
  const { body } = await getJson(`/repos/${full}/pulls/${pullRequest}`);
  const issueNumbers = closedIssueNumbers(body);
  if (issueNumbers.length === 0) {
    const notLinked = "Der PR ist mit keinem Issue verknüpft; im PR-Text fehlt „Closes #<Issue>“.";
    return { names: new Set(), notes: [notLinked], approvedIssues: [] };
  }
  const issues = await Promise.all(
    issueNumbers.map(async (number) => (await graphql(ISSUE_QUERY, number)).issue),
  );
  const verdicts = issues.map((issue) => ({ issue, problem: labelProblem(issue) }));
  const notes = verdicts.map(({ problem }) => problem).filter(Boolean);
  const approved = verdicts
    .filter(({ problem }) => problem === undefined)
    .map(({ issue }) => issue);
  const names = new Set(approved.flatMap(({ body: issueBody }) => allowedNames(issueBody)));
  const approvedIssues = approved.map(({ number }) => `#${number}`);
  return { names, notes, approvedIssues };
}

function listHint() {
  return `unter „${ALLOWED_LIST_HEADING}“ in einem Issue mit dem Label ${BEHAVIOUR_LABEL} von ${APPROVERS.join(" oder ")}`;
}

function unitFindings(unit, names, gates) {
  if (unit.deleted)
    return [`${unit.file}: die ganze Testdatei ist gelöscht; das ist immer gesperrt.`];
  const where = unit.lines.length > 0 ? `, Zeilen ${unit.lines.join(", ")}` : "";
  const findings = [];
  if (unit.name !== undefined && !names.has(unit.name)) {
    findings.push(
      `${unit.file}, Testfall „${unit.name}“${where}: geändert oder gelöscht, aber der Test steht nicht ${listHint()}.`,
    );
  }
  if (unit.name === undefined && !names.has(unit.file)) {
    findings.push(
      `${unit.file}${where} (außerhalb eines Testfalls): geändert oder gelöscht, aber die Datei steht nicht ${listHint()}.`,
    );
  }
  const missingGates = (gates.get(unit.file) ?? []).filter((gate) => !names.has(gate));
  if (missingGates.length > 0) {
    findings.push(
      `${unit.file} prüft Safety-Gates; das Gate ${missingGates.map((gate) => `„${gate}“`).join(", ")} steht nicht ${listHint()}.`,
    );
  }
  return findings;
}

async function checkPullRequest({ basis, pullRequest }) {
  const units = changedExistingTestFiles(basis).flatMap((change) => changedUnits(basis, change));
  if (units.length === 0) {
    console.log("Testschutz: keine bestehende Testzeile geändert oder gelöscht.");
    return;
  }
  const { names, notes, approvedIssues } = await approval(pullRequest);
  const gates = gatesByTestFile();
  const findings = [...new Set(units.flatMap((unit) => unitFindings(unit, names, gates)))];
  if (findings.length === 0) {
    console.log(
      `Testschutz: ${units.length} geänderte Stellen in bestehenden Tests sind durch Issue ${approvedIssues.join(", ")} freigegeben.`,
    );
    return;
  }
  console.error("Testschutz: bestehende Testzeilen sind geändert oder gelöscht, ohne Freigabe.");
  for (const line of [...notes, ...findings]) console.error(line);
  process.exitCode = EXIT_FAILURE;
}

async function latestRun(sha) {
  const { full } = repositoryName();
  const path = `/repos/${full}/actions/workflows/${TESTSCHUTZ_WORKFLOW}/runs?event=pull_request&head_sha=${sha}&per_page=1`;
  const { workflow_runs: runs } = await getJson(path);
  return runs[0];
}

async function completedRun(sha) {
  for (let attempt = 0; attempt < RUN_POLL_ATTEMPTS; attempt += 1) {
    const run = await latestRun(sha);
    if (run === undefined || run.status === "completed") return run;
    await sleep(RUN_POLL_INTERVAL_MS);
  }
  throw new Error(`Der Testschutz-Lauf für ${sha} wird nicht fertig.`);
}

async function rerunLinkedPullRequests({ issue }) {
  const { full } = repositoryName();
  const open = await getJson(
    `/repos/${full}/pulls?state=open&per_page=${OPEN_PULL_REQUESTS_PAGE_SIZE}`,
  );
  const pulls = open.filter(({ body }) => closedIssueNumbers(body).includes(issue));
  if (pulls.length === 0) console.log(`Issue #${issue}: kein offener PR verknüpft.`);
  for (const { number, head } of pulls) {
    const run = await completedRun(head.sha);
    if (run === undefined) {
      console.log(`PR #${number}: kein Testschutz-Lauf für ${head.sha}.`);
      continue;
    }
    await rest("POST", `/repos/${full}/actions/runs/${run.id}/rerun`);
    console.log(`PR #${number}: Testschutz-Lauf ${run.id} neu gestartet.`);
  }
}

async function main() {
  const options = parseOptions();
  await (options.issue === undefined
    ? checkPullRequest(options)
    : rerunLinkedPullRequests(options));
}

try {
  await main();
} catch (error) {
  console.error(`Testschutz: Abbruch: ${error.message}`);
  process.exitCode = EXIT_FAILURE;
}
