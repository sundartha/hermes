import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { REPO_ROOT, isolatedEnvironment, outputLines, probeRepository } from "./probe-repo.js";

const runFile = promisify(execFile);

const TOOL = join(REPO_ROOT, "tools/systemstand.mjs");
const BASIS_FILE = "tools/basis/systemstand.json";
const REPOSITORY = "sundartha/hermes";
const REPO_PATH = `/repos/${REPOSITORY}`;
const HOST = "127.0.0.1";
const FIRST_PACKAGE = 13;
const LAST_PACKAGE = 38;
const ISSUE_OFFSET = 1000;
const EXTRA_ISSUE = 2000;
const GITHUB_PAGE = 100;
const PHASE_PULL = 500;
const PROOF_RUN = 600;
const OTHER_RUN = 601;
const SHA_LENGTH = 40;
const PROOF_SHA = "c".repeat(SHA_LENGTH);
const PROOF_RUNS = 10;
const ERROR_SEVERITY = 2;
const DONE_PRODUCT_LIMIT = 3.9;
const TOO_LONG_INSTRUCTIONS = 101;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAVAILABLE = 503;
const HTTP_FOUND = 302;
const REDIRECT_TARGET = "/labels/schritt";
const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const JSON_INDENT = 2;
const SINCE = "2026-10-01";
const PACKAGE_STEP_IDS = ["1b", "2", "3", "4", "5"];
const ESTIMATES = { "1b": 7, 2: 5, 3: 5, 4: 1, 5: 4 };
const WORKFLOW_FILES = [
  "rotproben.yml",
  "wiederherstellung.yml",
  "aufraeumen.yml",
  "auswertung.yml",
  "anweisungstexte.yml",
];
const CRITERIA = {
  "1b": ["pakete-geschlossen", "staging", "katalog-ohne-test", "rotproben", "wiederherstellung"],
  2: ["pakete-geschlossen", "auftrag", "aufraeumen", "auswertung", "phase-pr"],
  3: ["pakete-geschlossen", "kommentar-basislinie", "tests-ohne-quelltext"],
  4: ["pakete-geschlossen", "claude-md", "workflows-entfernt", "anweisungstexte"],
  5: ["pakete-geschlossen", "beleg-zehn-laeufe", "testverhaeltnis"],
};

function json(value) {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

const HEALTHY_FILES = {
  "tools/auftrag.mjs": "export {};\n",
  "tools/basis/eslint-wirksam.json": json({
    ".": { rules: { "hermes/keine-kommentare": [ERROR_SEVERITY] } },
    test: { rules: { "hermes/kein-quelltext-als-text": [ERROR_SEVERITY] } },
  }),
  "eslint-suppressions.json": json({}),
  "CLAUDE.md": "# Hermes\n",
  "tools/basis/testverhaeltnis.json": json({ produkt: { obergrenze: DONE_PRODUCT_LIMIT } }),
};

function basis({ starts = {}, recorded = {} } = {}) {
  const entry = (id) => ({
    start: starts[id] ?? null,
    schaetzungTage: ESTIMATES[id],
    erfuelltSeit: recorded[id] ?? {},
  });
  return json({ schritte: Object.fromEntries(PACKAGE_STEP_IDS.map((id) => [id, entry(id)])) });
}

function everyCriterionSince() {
  const since = (ids) => Object.fromEntries(ids.map((id) => [id, SINCE]));
  return Object.fromEntries(Object.entries(CRITERIA).map(([step, ids]) => [step, since(ids)]));
}

function packageIssue(id, state, number) {
  return { number, title: `Paket ${id}: Probe`, state };
}

function packageIssues(states = {}) {
  const issues = [];
  for (let number = FIRST_PACKAGE; number <= LAST_PACKAGE; number += 1) {
    const state = states[number] ?? "closed";
    if (state !== "fehlt") issues.push(packageIssue(number, state, ISSUE_OFFSET + number));
  }
  return issues;
}

function healthyGitHub() {
  return {
    packages: packageIssues(),
    comments: {},
    workflows: Object.fromEntries(
      WORKFLOW_FILES.map((file) => [file, [{ conclusion: "success" }]]),
    ),
    mergedPulls: { [PHASE_PULL]: "phase/probe" },
    proofPulls: [{ head: { sha: PROOF_SHA } }],
    proofJobs: Array.from({ length: PROOF_RUNS }, () => "success"),
    health: HTTP_OK,
    stepIssues: [],
    created: [],
  };
}

function onePage(list, url) {
  const size = Number(url.searchParams.get("per_page") ?? list.length);
  const number = Number(url.searchParams.get("page") ?? 1);
  return list.slice((number - 1) * size, number * size);
}

function repoRoutes(state) {
  const runs = [
    { id: PROOF_RUN, name: "Beleg zehn Läufe" },
    { id: OTHER_RUN, name: "CI" },
  ];
  const jobs = (id) => (id === `${PROOF_RUN}` ? state.proofJobs : ["failure"]);
  return [
    [
      /^\/issues$/,
      (url) =>
        onePage(
          url.searchParams.get("labels") === "paket" ? state.packages : state.stepIssues,
          url,
        ),
    ],
    [/^\/issues\/(\d+)\/comments$/, (url, [, number]) => state.comments[number] ?? []],
    [
      /^\/actions\/workflows\/([^/]+)\/runs$/,
      (url, [, file]) => state.workflows[file] && { workflow_runs: state.workflows[file] },
    ],
    [/^\/pulls$/, () => state.proofPulls],
    [/^\/pulls\/(\d+)$/, (url, [, number]) => ({ head: { ref: state.mergedPulls[number] } })],
    [/^\/actions\/runs$/, () => ({ workflow_runs: runs })],
    [
      /^\/actions\/runs\/(\d+)\/jobs$/,
      (url, [, id]) => ({ jobs: jobs(id).map((conclusion) => ({ conclusion })) }),
    ],
    [/^\/labels\/schritt$/, () => ({})],
  ];
}

function mergedPullItems(state, url) {
  if (!url.searchParams.get("q").includes("is:merged")) return { items: [] };
  return { items: Object.keys(state.mergedPulls).map((number) => ({ number: Number(number) })) };
}

function reply(state, url) {
  if (url.pathname === "/healthz") return [state.health, {}, { location: REDIRECT_TARGET }];
  if (url.pathname === "/search/issues") return [HTTP_OK, mergedPullItems(state, url)];
  const path = url.pathname.slice(REPO_PATH.length);
  for (const [pattern, handler] of repoRoutes(state)) {
    const match = pattern.exec(path);
    if (match === null) continue;
    const payload = handler(url, match);
    return payload === undefined ? [HTTP_NOT_FOUND, {}] : [HTTP_OK, payload];
  }
  return [HTTP_NOT_FOUND, {}];
}

async function startGitHub(context, state) {
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "POST") state.created.push(JSON.parse(Buffer.concat(chunks)));
      const [status, payload, headers] = reply(state, new URL(request.url, `http://${HOST}`));
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(JSON.stringify(payload));
    });
  });
  server.listen(0, HOST);
  await once(server, "listening");
  context.after(() => server.close());
  return `http://${HOST}:${server.address().port}`;
}

function linesByStep(stdout) {
  return Object.fromEntries(
    outputLines(stdout).map((line) => [line.slice("Schritt ".length, line.indexOf(":")), line]),
  );
}

async function systemstand(context, { files = {}, github = {}, starts, recorded, ...run } = {}) {
  const tree = { ...HEALTHY_FILES, [BASIS_FILE]: basis({ starts, recorded }), ...files };
  const present = Object.entries(tree).filter(([, content]) => content !== null);
  const directory = probeRepository(context, Object.fromEntries(present));
  const state = { ...healthyGitHub(), ...github };
  const address = await startGitHub(context, state);
  const environment = {
    ...isolatedEnvironment(),
    GITHUB_API_URL: address,
    GITHUB_REPOSITORY: REPOSITORY,
    GH_TOKEN: "probe",
    GITHUB_TOKEN: "",
    STAGING_URL: run.staging ?? address,
  };
  const options = { cwd: directory, env: environment };
  const outcome = await runFile(process.execPath, [TOOL, ...(run.args ?? [])], options).then(
    (done) => ({ ...done, code: EXIT_OK }),
    (failed) => failed,
  );
  const lines = linesByStep(outcome.stdout);
  return { status: outcome.code, lines, stderr: outcome.stderr, created: state.created };
}

test("1b und die Schritte 2 bis 5 sind erfüllt, wenn alle Paket-Issues zu und alle Endkriterien erfüllt sind", async (context) => {
  const result = await systemstand(context);
  assert.equal(result.status, EXIT_OK, result.stderr);
  for (const id of PACKAGE_STEP_IDS) assert.equal(result.lines[id], `Schritt ${id}: erfüllt`);
});

test("je Schritt lautet der Grund „offen, weil Paket NN offen ist“, auch für ein Zusatzpaket", async (context) => {
  const cases = [
    { step: "1b", paket: 17 },
    { step: "2", paket: 27 },
    { step: "3", paket: 33 },
    { step: "4", paket: 35 },
    { step: "5", paket: 37 },
  ];
  for (const { step, paket } of cases) {
    const result = await systemstand(context, {
      github: { packages: packageIssues({ [paket]: "open" }) },
    });
    assert.equal(result.lines[step], `Schritt ${step}: offen, weil Paket ${paket} offen ist`);
  }
  const extra = [...packageIssues(), packageIssue("18b", "open", EXTRA_ISSUE)];
  const result = await systemstand(context, { github: { packages: extra } });
  assert.equal(result.lines["1b"], "Schritt 1b: offen, weil Paket 18b offen ist");
});

test("mehrere offene Pakete nennen die ersten drei und die Zahl der übrigen, ein fehlendes Issue zählt als offen", async (context) => {
  const states = { 13: "open", 14: "open", 15: "open", 16: "open", 17: "open", 36: "fehlt" };
  const result = await systemstand(context, { github: { packages: packageIssues(states) } });
  assert.equal(
    result.lines["1b"],
    "Schritt 1b: offen, weil die Pakete 13, 14, 15 und 2 weitere offen sind",
  );
  assert.match(result.lines["5"], /^Schritt 5: offen, weil [^;]*\b36\b[^;]*$/);
  const firstPage = Array.from({ length: GITHUB_PAGE }, (slot, index) =>
    packageIssue(FIRST_PACKAGE, "closed", EXTRA_ISSUE + index),
  );
  const paged = [...firstPage, ...packageIssues({ 17: "open" })];
  const secondPage = await systemstand(context, { github: { packages: paged } });
  assert.equal(secondPage.lines["1b"], "Schritt 1b: offen, weil Paket 17 offen ist");
});

function suppressed(rule, counts) {
  return json(
    Object.fromEntries(
      counts.map((count, index) => [`test/f${index}.test.js`, { [rule]: { count } }]),
    ),
  );
}

const MISSING_END_CRITERIA = [
  { step: "1b", run: { staging: "" }, reason: "die Staging-Adresse nicht hinterlegt ist" },
  { step: "1b", run: { github: { health: HTTP_UNAVAILABLE } }, pattern: /\/healthz\b.*\b503\b/ },
  { step: "1b", run: { github: { health: HTTP_FOUND } }, pattern: /\/healthz\b.*\b302\b/ },
  {
    step: "1b",
    run: { files: { "tools/basis/katalog-ohne-test.txt": "SG-01\nSG-02\n" } },
    pattern: /katalog-ohne-test\.txt.*\b2\b/,
  },
  {
    step: "1b",
    run: { github: { workflows: { "wiederherstellung.yml": [{ conclusion: "success" }] } } },
    reason: "Paket 20 fehlt",
  },
  {
    step: "1b",
    run: {
      github: {
        workflows: {
          "rotproben.yml": [{ conclusion: "success" }],
          "wiederherstellung.yml": [{ conclusion: "failure" }],
        },
      },
    },
    pattern: /wiederherstellung\.yml.*failure/,
  },
  { step: "2", run: { files: { "tools/auftrag.mjs": null } }, pattern: /tools\/auftrag\.mjs/ },
  {
    step: "2",
    run: {
      github: {
        workflows: { "aufraeumen.yml": [{ conclusion: "success" }], "auswertung.yml": [] },
      },
    },
    pattern: /auswertung\.yml/,
  },
  {
    step: "2",
    run: { github: { mergedPulls: { [PHASE_PULL]: "phasen-probe" } } },
    pattern: /phase\//,
  },
  {
    step: "3",
    run: {
      files: { "eslint-suppressions.json": suppressed("hermes/keine-kommentare", [1, 1, 1]) },
    },
    pattern: /Kommentarregel.*\b3\b/,
  },
  {
    step: "3",
    run: {
      files: { "eslint-suppressions.json": suppressed("hermes/kein-quelltext-als-text", [1, 1]) },
    },
    pattern: /\b2\b.*als Text/,
  },
  {
    step: "3",
    run: { files: { "tools/basis/eslint-wirksam.json": json({}) } },
    reason: "Paket 31 fehlt",
  },
  {
    step: "4",
    run: { files: { "CLAUDE.md": "Zeile\n".repeat(TOO_LONG_INSTRUCTIONS) } },
    pattern: /CLAUDE\.md.*\b101\b/,
  },
  {
    step: "4",
    run: { files: { ".claude/workflows/a.js": "1;\n", ".claude/workflows/b.js": "2;\n" } },
    pattern: /\.claude\/workflows\/.*\b2\b/,
  },
  {
    step: "4",
    run: { github: { workflows: { "rotproben.yml": [{ conclusion: "success" }] } } },
    reason: "Paket 35 fehlt",
  },
  { step: "5", run: { github: { proofPulls: [] } }, pattern: /beleg\/38-zehn-laeufe/ },
  {
    step: "5",
    run: { github: { proofJobs: Array.from({ length: PROOF_RUNS - 1 }, () => "success") } },
    pattern: /beleg\/38-zehn-laeufe.*\b9\b/,
  },
  {
    step: "5",
    run: {
      github: {
        proofJobs: [...Array.from({ length: PROOF_RUNS }, () => "success"), "failure"],
      },
    },
    pattern: /beleg\/38-zehn-laeufe/,
  },
  {
    step: "5",
    run: { files: { "tools/basis/testverhaeltnis.json": json({ produkt: { obergrenze: 4.1 } }) } },
    pattern: /testverhaeltnis\.json.*4\.1/,
  },
];

test("fehlt ein Endkriterium, nennt die Zeile des Schritts genau diesen einen Grund", async (context) => {
  for (const { step, run, reason, pattern } of MISSING_END_CRITERIA) {
    const { lines } = await systemstand(context, run);
    const prefix = `Schritt ${step}: offen, weil `;
    if (reason !== undefined) assert.equal(lines[step], `${prefix}${reason}`);
    if (pattern === undefined) continue;
    assert.ok(lines[step].startsWith(prefix) && !lines[step].includes(";"), lines[step]);
    assert.match(lines[step], pattern);
  }
});

test("--pruefen kennt die neuen Kriterien und sperrt einen Rückfall; ein Staging-Ausfall sperrt nur master", async (context) => {
  const recorded = everyCriterionSince();
  const steady = await systemstand(context, { recorded, args: ["--pruefen"] });
  assert.equal(steady.status, EXIT_OK, steady.stderr);
  const longInstructions = { "CLAUDE.md": "Zeile\n".repeat(TOO_LONG_INSTRUCTIONS) };
  const inPullRequest = ["--pruefen", "--pr-basis", "HEAD"];
  const regression = await systemstand(context, {
    recorded,
    files: longInstructions,
    args: inPullRequest,
  });
  assert.equal(regression.status, EXIT_FAILURE);
  const stagingDown = { recorded, github: { health: HTTP_UNAVAILABLE } };
  const pullRequest = await systemstand(context, { ...stagingDown, args: inPullRequest });
  assert.equal(pullRequest.status, EXIT_OK, pullRequest.stderr);
  const master = await systemstand(context, { ...stagingDown, args: ["--pruefen"] });
  assert.equal(master.status, EXIT_FAILURE);
});
