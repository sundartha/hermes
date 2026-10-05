import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

import {
  REPO_ROOT,
  commitAll,
  isolatedEnvironment,
  outputLines,
  probeRepository,
  runIn,
  writeFiles,
} from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/systemstand.mjs");
const BASIS_FILE = "tools/basis/systemstand.json";
const REPOSITORY = "sundartha/hermes";
const SHA_LENGTH = 40;
const MASTER_SHA = "a".repeat(SHA_LENGTH);
const PROBE_SHA = "b".repeat(SHA_LENGTH);
const RULESET_ID = 7;
const PROBE_NUMBER = 5;
const STEP_IDS = ["1a", "1b", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];
const REQUIRED_CHECKS = ["CI", "Prüfungen prüfen", "Testschutz"];
const SINCE = "2026-09-30";
const HEAD_SHA = "c".repeat(SHA_LENGTH);
const OLDER_SHA = "d".repeat(SHA_LENGTH);
const REBASED_COMMITS = 6;
const RUNNING = { status: "in_progress", conclusion: null };
const GREEN = { status: "completed", conclusion: "success" };
const RED = { status: "completed", conclusion: "failure" };
const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const JSON_INDENT = 2;
const STAGING_VARIABLE = "STAGING_URL";
const OPERATING_MODES = [[], ["--pruefen"], ["--pruefen", "--pr-basis", "HEAD"], ["--issues"]];

function workflow(name, command) {
  const lines = ["on:", "  pull_request:", "jobs:", "  job:", `    name: ${name}`, "    steps:"];
  return [`name: ${name}`, ...lines, `      - run: ${command}`, ""].join("\n");
}

const LENIENT_CI = `${workflow("CI", "npm run lint")}        continue-on-error: true\n`;

const REPOSITORY_FILES = {
  ".github/workflows/ci.yml": workflow("CI", "npm run lint"),
  ".github/workflows/testschutz.yml": workflow("Testschutz", "node tools/tests-nur-ergaenzt.mjs"),
  ".github/workflows/pruefungen-pruefen.yml": workflow(
    "Prüfungen prüfen",
    "node tools/eslint-konfig-pruefen.mjs",
  ),
  ".github/CODEOWNERS": "/tools/ @Antonio20045\n",
  "src/app.js": "export const wert = 1;\n",
};

function basis(recorded) {
  const schritte = { "1a": { start: null, schaetzung: null, erfuelltSeit: recorded } };
  return `${JSON.stringify({ schritte }, null, JSON_INDENT)}\n`;
}

function rule(type, parameters = {}) {
  return { type, ruleset_id: RULESET_ID, parameters };
}

function healthyGitHub() {
  const checks = REQUIRED_CHECKS.map((context) => ({ context }));
  return {
    autoMergeAllowed: true,
    rules: [
      rule("deletion"),
      rule("non_fast_forward"),
      rule("pull_request", { required_approving_review_count: 0, require_code_owner_review: true }),
      rule("required_status_checks", {
        strict_required_status_checks_policy: true,
        required_status_checks: checks,
      }),
    ],
    ruleset: { name: "master-schutz", enforcement: "active", current_user_can_bypass: "never" },
    masterRuns: [{ name: "CI", status: "completed", conclusion: "success" }],
    probes: [{ number: PROBE_NUMBER, title: "Rot-Probe 20: lint-fehler" }],
    probeRuns: [{ name: "CI", status: "completed", conclusion: "failure" }],
    labelExists: true,
    issues: [],
  };
}

function historyAnswer(history, repo, url) {
  if (url.pathname === `${repo}/commits`) return history.map(({ sha }) => ({ sha }));
  const commit = history.find(({ sha }) => sha === url.searchParams.get("head_sha"));
  if (url.pathname !== `${repo}/actions/runs` || commit === undefined) return undefined;
  return { workflow_runs: commit.runs };
}

function answer(state, url) {
  const repo = `/repos/${REPOSITORY}`;
  const fromHistory = state.masterHistory && historyAnswer(state.masterHistory, repo, url);
  if (fromHistory) return [HTTP_OK, fromHistory];
  const routes = new Map([
    ["/graphql", { data: { repository: { autoMergeAllowed: state.autoMergeAllowed } } }],
    [`${repo}/rules/branches/master`, state.rules],
    [`${repo}/rulesets/${RULESET_ID}`, state.ruleset],
    [`${repo}/commits`, [{ sha: MASTER_SHA }]],
    [`${repo}/pulls/${PROBE_NUMBER}`, { head: { sha: PROBE_SHA } }],
    ["/search/issues", { items: state.probes }],
    [`${repo}/issues`, state.issues],
    [`${repo}/labels`, {}],
  ]);
  if (url.pathname === `${repo}/actions/runs`) {
    const onMaster = url.searchParams.get("head_sha") === MASTER_SHA;
    return [HTTP_OK, { workflow_runs: onMaster ? state.masterRuns : state.probeRuns }];
  }
  if (url.pathname === `${repo}/labels/schritt`) {
    return [state.labelExists ? HTTP_OK : HTTP_NOT_FOUND, {}];
  }
  if (url.pathname.startsWith(`${repo}/issues/`)) return [HTTP_OK, {}];
  return routes.has(url.pathname) ? [HTTP_OK, routes.get(url.pathname)] : [HTTP_NOT_FOUND, {}];
}

async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : JSON.parse(text);
}

async function fakeGitHub(context, state) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    requests.push({ method: request.method, path: url.pathname, body: await bodyOf(request) });
    const [status, payload] = answer(state, url);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  context.after(() => server.close());
  return { requests, url: `http://127.0.0.1:${server.address().port}` };
}

function runTool(directory, args, environment) {
  return new Promise((done) => {
    const options = { cwd: directory, env: environment };
    execFile(process.execPath, [TOOL, ...args], options, (error, stdout, stderr) =>
      done({ status: error ? error.code : EXIT_OK, stdout, stderr }),
    );
  });
}

function pullRequestBasis(directory, change) {
  if (change === undefined) return [];
  const base = runIn(directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(directory, change);
  commitAll(directory, "Änderung im PR");
  return ["--pr-basis", base];
}

async function systemstand(context, { files = {}, recorded = {}, github = {}, args = [], ...run }) {
  const directory = probeRepository(context, {
    ...REPOSITORY_FILES,
    [BASIS_FILE]: basis(recorded),
    ...files,
  });
  const extraArgs = pullRequestBasis(directory, run.change);
  const service = await fakeGitHub(context, { ...healthyGitHub(), ...github });
  const environment = {
    ...isolatedEnvironment(),
    GITHUB_API_URL: service.url,
    GITHUB_REPOSITORY: REPOSITORY,
    GH_TOKEN: run.token ?? "probe",
    GITHUB_TOKEN: "",
    STAGING_URL: service.url,
  };
  const result = await runTool(directory, [...args, ...extraArgs], environment);
  return { ...result, lines: outputLines(result.stdout), requests: service.requests };
}

function masterGreenOn(context, masterHistory) {
  return systemstand(context, {
    recorded: { "master-gruen": SINCE },
    github: { masterHistory },
    args: ["--pruefen"],
  });
}

function stepIds(lines) {
  return lines.map((line) => line.split(":")[0].replace("Schritt ", ""));
}

function writes(result, method, prefix) {
  return result.requests.filter(
    ({ method: used, path }) => used === method && path.startsWith(prefix),
  );
}

test("ohne Schalter gibt systemstand für 1a, 1b und 2 bis 11 je genau eine Zeile aus", async (context) => {
  const result = await systemstand(context, {});
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.deepEqual(stepIds(result.lines), STEP_IDS);
  assert.match(result.lines[0], /: erfüllt$/);
  for (const line of result.lines.slice(1)) assert.match(line, /: offen, weil \S/);
});

test("--pruefen bleibt grün, solange kein eingetragenes Kriterium zurückfällt", async (context) => {
  const result = await systemstand(context, {
    recorded: { "lint-fehler": SINCE, "master-gruen": SINCE },
    args: ["--pruefen"],
  });
  assert.equal(result.status, EXIT_OK, result.stderr);
});

test("continue-on-error in ci.yml macht --pruefen rot, wenn die Lint-Sperre eingetragen ist", async (context) => {
  const files = { ".github/workflows/ci.yml": LENIENT_CI };
  const recorded = await systemstand(context, {
    files,
    recorded: { "lint-fehler": SINCE },
    args: ["--pruefen"],
  });
  assert.equal(recorded.status, EXIT_FAILURE);
  assert.match(recorded.lines[0], /^Schritt 1a: offen, weil /);
  assert.match(recorded.stderr, /1a/);
  const notRecorded = await systemstand(context, { files, args: ["--pruefen"] });
  assert.equal(notRecorded.status, EXIT_OK, notRecorded.stderr);
});

test("ein PR, der den Eintrag löscht und die Sperre lockert, wird trotzdem rot", async (context) => {
  const result = await systemstand(context, {
    recorded: { "lint-fehler": SINCE },
    change: { ".github/workflows/ci.yml": LENIENT_CI, [BASIS_FILE]: basis({}) },
    args: ["--pruefen"],
  });
  assert.equal(result.status, EXIT_FAILURE);
});

test("ein roter master sperrt einen PR nicht, aber den Lauf auf master", async (context) => {
  const redMaster = {
    recorded: { "master-gruen": SINCE },
    github: { masterRuns: [{ name: "CI", status: "completed", conclusion: "failure" }] },
    args: ["--pruefen"],
  };
  const pullRequest = await systemstand(context, {
    ...redMaster,
    change: { "src/app.js": "1;\n" },
  });
  assert.equal(pullRequest.status, EXIT_OK, pullRequest.stderr);
  assert.match(pullRequest.stderr, /1a/);
  const master = await systemstand(context, redMaster);
  assert.equal(master.status, EXIT_FAILURE);
});

test("laufen auf dem neuesten master-Commit noch Workflows, ist master noch offen und kein Rückfall", async (context) => {
  const rebased = [...Array(REBASED_COMMITS).keys()].map((index) => ({
    sha: String(index).repeat(SHA_LENGTH),
    runs: [],
  }));
  const head = [
    { name: "CI", ...RUNNING },
    { name: "Abhängigkeiten", ...RUNNING },
  ];
  const result = await masterGreenOn(context, [{ sha: HEAD_SHA, runs: head }, ...rebased]);
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.match(result.lines[0], /^Schritt 1a: offen, weil /);
  assert.doesNotMatch(result.stderr, /Rückfall/);
});

test("ein roter Lauf auf einem älteren master-Commit zählt nicht, wenn derselbe Workflow auf dem neuesten grün ist", async (context) => {
  const older = {
    sha: OLDER_SHA,
    runs: [
      { name: "Abhängigkeiten", ...RED },
      { name: "CI", ...GREEN },
    ],
  };
  const headGreen = { name: "Abhängigkeiten", ...GREEN };
  const running = await masterGreenOn(context, [
    { sha: HEAD_SHA, runs: [headGreen, { name: "CI", ...RUNNING }] },
    older,
  ]);
  assert.equal(running.status, EXIT_OK, running.stderr);
  assert.doesNotMatch(running.lines[0], /Abhängigkeiten/);
  const finished = await masterGreenOn(context, [
    { sha: HEAD_SHA, runs: [headGreen, { name: "CI", ...GREEN }] },
    older,
  ]);
  assert.equal(finished.status, EXIT_OK, finished.stderr);
  assert.match(finished.lines[0], /^Schritt 1a: erfüllt$/);
});

test("ein roter Lauf auf dem neuesten master-Commit bleibt ein Rückfall, auch wenn andere noch laufen", async (context) => {
  const head = [
    { name: "CI", ...RED },
    { name: "Abhängigkeiten", ...RUNNING },
  ];
  const result = await masterGreenOn(context, [{ sha: HEAD_SHA, runs: head }]);
  assert.equal(result.status, EXIT_FAILURE);
  assert.match(result.stderr, /Rückfall in Schritt 1a: „master ist grün“ .*„CI“/);
});

test("1a bleibt offen, solange Paket 20 keine Rot-Probe gefahren hat oder eine durchging", async (context) => {
  const none = await systemstand(context, { github: { probes: [] } });
  const passed = await systemstand(context, {
    github: { probeRuns: [{ name: "CI", status: "completed", conclusion: "success" }] },
  });
  for (const result of [none, passed]) assert.match(result.lines[0], /^Schritt 1a: offen, weil /);
});

test("ohne Token bleibt die Ausgabe vollständig und ein eingetragenes Kriterium fällt zurück", async (context) => {
  const result = await systemstand(context, {
    token: "",
    recorded: { "push-auf-master": SINCE },
    args: ["--pruefen"],
  });
  assert.equal(result.status, EXIT_FAILURE);
  assert.deepEqual(stepIds(result.lines), STEP_IDS);
});

test("--pruefen wird rot bei einem unbekannten Kriterium in der Basis-Datei", async (context) => {
  const result = await systemstand(context, {
    recorded: { "lint-fehlr": SINCE },
    args: ["--pruefen"],
  });
  assert.equal(result.status, EXIT_FAILURE);
});

test("--issues legt fehlende Schritt-Issues samt Label an und schreibt nur geänderte neu", async (context) => {
  const first = await systemstand(context, {
    github: { labelExists: false },
    args: ["--issues"],
  });
  assert.equal(first.status, EXIT_OK, first.stderr);
  assert.equal(writes(first, "POST", `/repos/${REPOSITORY}/labels`).length, 1);
  const created = writes(first, "POST", `/repos/${REPOSITORY}/issues`).map(({ body }) => body);
  assert.deepEqual(
    created.map(({ title }) => title),
    STEP_IDS.map((id) => `Schritt ${id}`),
  );
  assert.ok(created.every(({ labels }) => labels.includes("schritt")));
  const issues = created.map(({ title, body }, index) => ({ number: index + 1, title, body }));
  issues[0].body = "veraltet";
  const second = await systemstand(context, { github: { issues }, args: ["--issues"] });
  assert.equal(second.status, EXIT_OK, second.stderr);
  assert.equal(writes(second, "POST", `/repos/${REPOSITORY}/issues`).length, 0);
  assert.deepEqual(
    writes(second, "PATCH", `/repos/${REPOSITORY}/issues`).map(({ path }) => path),
    [`/repos/${REPOSITORY}/issues/1`],
  );
});

function withStagingAddress(service, address) {
  const inherited = Object.entries(isolatedEnvironment()).filter(
    ([name]) => name !== STAGING_VARIABLE,
  );
  const environment = {
    ...Object.fromEntries(inherited),
    GITHUB_API_URL: service.url,
    GITHUB_REPOSITORY: REPOSITORY,
    GH_TOKEN: "probe",
    GITHUB_TOKEN: "",
  };
  return address === undefined ? environment : { ...environment, [STAGING_VARIABLE]: address };
}

test("ohne oder mit leerem STAGING_URL bricht systemstand in jeder Betriebsart mit Exit 1 ab, bevor es etwas ausgibt", async (context) => {
  const directory = probeRepository(context, { ...REPOSITORY_FILES, [BASIS_FILE]: basis({}) });
  const service = await fakeGitHub(context, healthyGitHub());
  for (const address of [undefined, ""]) {
    for (const args of OPERATING_MODES) {
      const result = await runTool(directory, args, withStagingAddress(service, address));
      assert.equal(result.status, EXIT_FAILURE, result.stdout);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^Systemstand: Abbruch: .*\bSTAGING_URL\b/);
    }
  }
  assert.deepEqual(service.requests, []);
});
