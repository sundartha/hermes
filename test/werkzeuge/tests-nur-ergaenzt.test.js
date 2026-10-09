import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, isolatedEnvironment, probeRepository, runIn } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/tests-nur-ergaenzt.mjs");
const REPOSITORY = "sundartha/vodafone-agent";
const PULL_REQUEST = "7";
const ISSUE = 12;
const LABEL = "verhalten-geaendert";
const ANTONIO = "Antonio20045";
const BOT = "sundartha-agent";
const LABEL_TIME = "2026-09-30T10:00:00Z";
const LATER = "2026-09-30T11:00:00Z";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const RUN_ID = 4711;
const OTHER_PULL_REQUEST = 8;
const OTHER_ISSUE = 13;
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const ALLOWED_HEADING = "## Tests, deren Erwartung sich ändern darf";
const SUM_TEST = "rechnet eins plus eins";
const NAME_TEST = "kennt den Namen";
const GATE_TEST = "sperrt teure Ziele";
const GATE = "Denylist";
const EXAMPLE_FILE = "test/beispiel.test.js";
const GATE_FILE = "test/gate.test.js";
const HELPER_FILE = "test/helfer.js";

function testFile(cases) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    "",
    ...cases.flatMap(([name, assertion]) => [
      `test(${JSON.stringify(name)}, () => {`,
      `  ${assertion}`,
      "});",
      "",
    ]),
  ].join("\n");
}

function probe(context) {
  const directory = probeRepository(context, {
    [EXAMPLE_FILE]: testFile([
      [SUM_TEST, "assert.equal(1 + 1, 2);"],
      [NAME_TEST, 'assert.equal("Hermes".length, 6);'],
    ]),
    [GATE_FILE]: testFile([[GATE_TEST, 'assert.equal("+900".startsWith("+900"), true);']]),
    [HELPER_FILE]: "export const wert = 1;\n",
    "tools/gate-tests.json": JSON.stringify({
      [GATE]: { module: ["src/denylist.js"], tests: [GATE_FILE] },
    }),
  });
  const basis = runIn(directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  return { directory, basis };
}

function change(directory, { file, from, to }) {
  const path = join(directory, file);
  const content = readFileSync(path, "utf8");
  assert.ok(content.includes(from), `${file} enthält ${from} nicht`);
  writeFileSync(path, content.replace(from, to));
  commitAll(directory, `Ändere ${file}`);
}

function labeled(login, createdAt = LABEL_TIME) {
  return { __typename: "LabeledEvent", createdAt, actor: { login }, label: { name: LABEL } };
}

function issueBody(names) {
  return [
    "## Ziel",
    "",
    "Verhalten ändert sich.",
    "",
    ALLOWED_HEADING,
    "",
    ...names.map((name) => `- ${name}`),
    "",
  ].join("\r\n");
}

function linkedIssue({ names = [], events = [], lastEditedAt = null }) {
  return {
    number: ISSUE,
    body: issueBody(names),
    lastEditedAt,
    timelineItems: { nodes: events },
  };
}

function pullRequestBody(issue) {
  const summary = "Ändert einen Test.";
  return issue === undefined ? summary : `${summary}\r\n\r\nCloses #${issue.number}`;
}

function answerFor(answers, request) {
  const path = request.url.split("?")[0];
  return answers[`${request.method} ${path}`];
}

async function withGitHub(answers, body) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    request.resume();
    request.on("end", () => {
      const answer = answerFor(answers, request);
      const status = answer === undefined ? HTTP_NOT_FOUND : (answer.status ?? HTTP_OK);
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer?.body ?? {}));
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    return await body(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    await new Promise((done) => server.close(done));
  }
}

function runTool(directory, args, apiUrl) {
  const env = {
    ...isolatedEnvironment(),
    GITHUB_TOKEN: "probe-token",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_API_URL: apiUrl,
    GITHUB_GRAPHQL_URL: `${apiUrl}/graphql`,
  };
  return new Promise((done) => {
    const child = spawn(process.execPath, [TOOL, ...args], { cwd: directory, env });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => done({ status, output }));
  });
}

async function check({ directory, basis }, issue) {
  const answers = {
    [`GET /repos/${REPOSITORY}/pulls/${PULL_REQUEST}`]: { body: { body: pullRequestBody(issue) } },
    "POST /graphql": { body: { data: { repository: { issue } } } },
  };
  return withGitHub(answers, async (apiUrl, requests) => {
    const result = await runTool(directory, ["--basis", basis, "--pr", PULL_REQUEST], apiUrl);
    return { ...result, requests };
  });
}

function changeSumExpectation(directory) {
  change(directory, {
    file: EXAMPLE_FILE,
    from: "assert.equal(1 + 1, 2);",
    to: "assert.ok(1 + 1 > 0);",
  });
}

test("tests-nur-ergaenzt: ein angehängter Test geht ohne Frage an GitHub durch", async (context) => {
  const repo = probe(context);
  appendFileSync(join(repo.directory, EXAMPLE_FILE), testFile([["ist neu", "assert.ok(true);"]]));
  commitAll(repo.directory, "Hänge einen Test an");
  const result = await check(repo);
  assert.equal(result.status, EXIT_OK, result.output);
  assert.match(result.output, /keine bestehende Testzeile geändert oder gelöscht/);
  assert.deepEqual(result.requests, []);
});

test("tests-nur-ergaenzt: eine geänderte Erwartung ohne Label stoppt mit Datei, Test und Zeile", async (context) => {
  const repo = probe(context);
  changeSumExpectation(repo.directory);
  const result = await check(repo, linkedIssue({ names: [SUM_TEST] }));
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /Issue #12 trägt das Label verhalten-geaendert nicht/);
  assert.match(
    result.output,
    /test\/beispiel\.test\.js, Testfall „rechnet eins plus eins“, Zeilen 5:/,
  );
});

test("tests-nur-ergaenzt: ein PR ohne verknüpftes Issue stoppt", async (context) => {
  const repo = probe(context);
  changeSumExpectation(repo.directory);
  const result = await check(repo);
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /mit keinem Issue verknüpft/);
});

test("tests-nur-ergaenzt: ein Label vom Bot stoppt", async (context) => {
  const repo = probe(context);
  changeSumExpectation(repo.directory);
  const result = await check(repo, linkedIssue({ names: [SUM_TEST], events: [labeled(BOT)] }));
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /das Label verhalten-geaendert hat sundartha-agent gesetzt/);
});

test("tests-nur-ergaenzt: ein Label von Antonio mit genanntem Test geht durch", async (context) => {
  const repo = probe(context);
  changeSumExpectation(repo.directory);
  const result = await check(repo, linkedIssue({ names: [SUM_TEST], events: [labeled(ANTONIO)] }));
  assert.equal(result.status, EXIT_OK, result.output);
  assert.match(result.output, /durch Issue #12 freigegeben/);
});

test("tests-nur-ergaenzt: ein Label von Antonio deckt keinen anderen Test", async (context) => {
  const repo = probe(context);
  changeSumExpectation(repo.directory);
  const result = await check(repo, linkedIssue({ names: [NAME_TEST], events: [labeled(ANTONIO)] }));
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /Testfall „rechnet eins plus eins“/);
  assert.doesNotMatch(result.output, /Testfall „kennt den Namen“/);
});

test("tests-nur-ergaenzt: ein nach dem Label entferntes Label stoppt", async (context) => {
  const repo = probe(context);
  changeSumExpectation(repo.directory);
  const unlabeled = { ...labeled(ANTONIO, LATER), __typename: "UnlabeledEvent" };
  const events = [labeled(ANTONIO), unlabeled];
  const result = await check(repo, linkedIssue({ names: [SUM_TEST], events }));
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /trägt das Label verhalten-geaendert nicht/);
});

test("tests-nur-ergaenzt: ein nach dem Label geänderter Issue-Text stoppt", async (context) => {
  const repo = probe(context);
  changeSumExpectation(repo.directory);
  const issue = linkedIssue({ names: [SUM_TEST], events: [labeled(ANTONIO)], lastEditedAt: LATER });
  const result = await check(repo, issue);
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /der Text wurde nach dem Label geändert/);
});

test("tests-nur-ergaenzt: ein Gate-Test ohne genanntes Gate stoppt", async (context) => {
  const repo = probe(context);
  change(repo.directory, { file: GATE_FILE, from: "true);", to: "false === false);" });
  const result = await check(repo, linkedIssue({ names: [GATE_TEST], events: [labeled(ANTONIO)] }));
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(
    result.output,
    /test\/gate\.test\.js prüft Safety-Gates; das Gate „Denylist“ steht nicht/,
  );
});

test("tests-nur-ergaenzt: ein Gate-Test mit genanntem Gate geht durch", async (context) => {
  const repo = probe(context);
  change(repo.directory, { file: GATE_FILE, from: "true);", to: "false === false);" });
  const issue = linkedIssue({ names: [GATE_TEST, GATE], events: [labeled(ANTONIO)] });
  const result = await check(repo, issue);
  assert.equal(result.status, EXIT_OK, result.output);
});

test("tests-nur-ergaenzt: ein geänderter Helfer braucht die Datei in der Liste", async (context) => {
  const repo = probe(context);
  change(repo.directory, { file: HELPER_FILE, from: "wert = 1", to: "wert = 0" });
  const red = await check(repo, linkedIssue({ names: [SUM_TEST], events: [labeled(ANTONIO)] }));
  assert.equal(red.status, EXIT_FINDING, red.output);
  assert.match(red.output, /test\/helfer\.js, Zeilen 1 \(außerhalb eines Testfalls\)/);
  const green = await check(
    repo,
    linkedIssue({ names: [HELPER_FILE], events: [labeled(ANTONIO)] }),
  );
  assert.equal(green.status, EXIT_OK, green.output);
});

test("tests-nur-ergaenzt: eine gelöschte Testdatei stoppt auch mit Label", async (context) => {
  const repo = probe(context);
  rmSync(join(repo.directory, EXAMPLE_FILE));
  commitAll(repo.directory, "Lösche einen Test");
  const names = [SUM_TEST, NAME_TEST, EXAMPLE_FILE];
  const result = await check(repo, linkedIssue({ names, events: [labeled(ANTONIO)] }));
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /test\/beispiel\.test\.js: die ganze Testdatei ist gelöscht/);
});

test("tests-nur-ergaenzt: ein Label startet den Testschutz der verknüpften PRs neu", async (context) => {
  const { directory } = probe(context);
  const runsPath = `/repos/${REPOSITORY}/actions/workflows/testschutz.yml/runs`;
  const rerunPath = `/repos/${REPOSITORY}/actions/runs/${RUN_ID}/rerun`;
  const answers = {
    [`GET /repos/${REPOSITORY}/pulls`]: {
      body: [
        { number: Number(PULL_REQUEST), body: `Closes #${ISSUE}`, head: { sha: HEAD_SHA } },
        { number: OTHER_PULL_REQUEST, body: `Closes #${OTHER_ISSUE}`, head: { sha: OTHER_SHA } },
      ],
    },
    [`GET ${runsPath}`]: { body: { workflow_runs: [{ id: RUN_ID, status: "completed" }] } },
    [`POST ${rerunPath}`]: { status: HTTP_CREATED },
  };
  const result = await withGitHub(answers, async (apiUrl, requests) => ({
    ...(await runTool(directory, ["--issue", String(ISSUE)], apiUrl)),
    requests,
  }));
  assert.equal(result.status, EXIT_OK, result.output);
  assert.ok(
    result.requests.includes(`GET ${runsPath}?event=pull_request&head_sha=${HEAD_SHA}&per_page=1`),
  );
  assert.ok(result.requests.includes(`POST ${rerunPath}`));
  assert.ok(!result.requests.some((request) => request.includes(OTHER_SHA)));
  assert.match(result.output, /PR #7: Testschutz-Lauf 4711 neu gestartet/);
});
