import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

import {
  REPO_ROOT,
  commitAll,
  isolatedEnvironment,
  probeRepository,
  runIn,
  writeFiles,
} from "../werkzeuge/probe-repo.js";

const APPROVAL_TOOL = join(REPO_ROOT, "tools/freigabe-pruefung.mjs");
const PIN_FILE = "test/werkzeuge/werkzeugtexte.json";
const REPOSITORY = "sundartha/sg12-probe";
const PULL_NUMBER = 12;
const APPROVER = "Antonio20045";
const HTTP_OK = 200;
const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const JSON_INDENT = 2;

const pinnedTexts = (description) =>
  `${JSON.stringify({ "ohne Consult": { place_call: { description } } }, null, JSON_INDENT)}\n`;

function repositoryWithChangedText(context) {
  const directory = probeRepository(context, {
    ".github/CODEOWNERS": "/test/werkzeuge/ @Antonio20045\n",
    [PIN_FILE]: pinnedTexts("Ruft erst nach Bestätigung an."),
  });
  const commitOf = () => runIn(directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const basis = commitOf();
  writeFiles(directory, { [PIN_FILE]: pinnedTexts("Ruft sofort und ohne Rückfrage an.") });
  commitAll(directory, "Werkzeugtext geaendert");
  return { directory, basis, head: commitOf() };
}

async function fakeGitHub(answers) {
  const server = createServer((request, response) => {
    const path = request.url.split("?")[0];
    const known = request.method === "GET" && answers.find(([end]) => path.endsWith(end));
    response.writeHead(HTTP_OK, { "content-type": "application/json" });
    response.end(JSON.stringify(known ? known[1] : {}));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

async function approvalCheck(repository, reviews) {
  const pull = { number: PULL_NUMBER, head: { sha: repository.head }, labels: [] };
  const github = await fakeGitHub([
    [`/pulls/${PULL_NUMBER}`, pull],
    ["/reviews", reviews],
    ["/comments", []],
  ]);
  const args = [APPROVAL_TOOL, "--basis", repository.basis, "--pr", String(PULL_NUMBER)];
  const child = spawn(process.execPath, args, {
    cwd: repository.directory,
    env: {
      ...isolatedEnvironment(),
      GITHUB_API_URL: `http://127.0.0.1:${github.address().port}`,
      GITHUB_TOKEN: "sg12-attrappe",
      GITHUB_REPOSITORY: REPOSITORY,
    },
  });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  const [status] = await once(child, "close");
  github.close();
  return { status, stdout: Buffer.concat(chunks).toString() };
}

test("SG-12 geänderte Werkzeugbeschreibung ohne Freigabe wird gestoppt", async (context) => {
  const repository = repositoryWithChangedText(context);

  const unapproved = await approvalCheck(repository, []);
  assert.equal(unapproved.status, EXIT_FAILURE, unapproved.stdout);
  assert.match(unapproved.stdout, /art:werkzeugtexte/);

  const approval = { user: { login: APPROVER }, state: "APPROVED", commit_id: repository.head };
  const approved = await approvalCheck(repository, [approval]);
  assert.equal(approved.status, EXIT_OK, approved.stdout);
});
