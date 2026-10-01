import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, isolatedEnvironment } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/wochenbericht.mjs");
const RECORDING = JSON.parse(
  readFileSync(join(REPO_ROOT, "test/werkzeuge/wochenbericht-aufzeichnung.json"), "utf8"),
);
const REPOSITORY = "sundartha/hermes";
const ISSUE = RECORDING.entscheidungsIssue.number;
const NOTE = { ...RECORDING.notiz, created_at: "2026-01-05T09:00:00Z" };
const PRESENTED_LONG_AGO = "2026-01-06T05:23:00Z";
const PRESENTED_IN_FUTURE = "2999-01-01T05:23:00Z";

function comment(login, body, createdAt = "2026-01-07T08:00:00Z") {
  return { id: login.length, user: { login }, created_at: createdAt, body };
}

function presented(createdAt) {
  return comment("github-actions[bot]", "<!-- wochenbericht-vorgelegt -->\nVorgelegt.", createdAt);
}

function listFor(url, comments) {
  if (url.searchParams.get("page") !== "1") return [];
  if (url.pathname.endsWith(`/issues/${ISSUE}/comments`)) return comments;
  return url.searchParams.get("labels") === "entscheidung" ? [RECORDING.entscheidungsIssue] : [];
}

async function evaluate(context, comments) {
  const writes = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      if (request.method !== "GET") writes.push(`${request.method} ${url.pathname} ${text}`);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(request.method === "GET" ? listFor(url, comments) : {}));
    });
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  context.after(() => server.close());
  const env = {
    ...isolatedEnvironment(),
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
    GITHUB_REPOSITORY: REPOSITORY,
    GH_TOKEN: "probe",
  };
  const status = await new Promise((done) =>
    execFile(process.execPath, [TOOL, "--auswerten"], { cwd: REPO_ROOT, env }, (error) =>
      done(error?.code ?? 0),
    ),
  );
  assert.equal(status, 0);
  return writes;
}

function decision(writes) {
  const posted = writes.find((write) =>
    write.startsWith(`POST /repos/${REPOSITORY}/issues/${ISSUE}/comments`),
  );
  return posted && JSON.parse(posted.slice(posted.indexOf("{"))).body;
}

test("Wochenbericht: eine 2 vom Bot zählt nicht, es gilt die Vorgabe", async (context) => {
  const writes = await evaluate(context, [
    NOTE,
    presented(PRESENTED_LONG_AGO),
    comment("sundartha-bot", "2"),
  ]);
  assert.match(decision(writes), /Entschieden: Option 1\n/);
  assert.match(decision(writes), /es gilt die Vorgabe/);
});

test("Wochenbericht: eine 2 von Antonio wird angewandt und das Label wechselt", async (context) => {
  const writes = await evaluate(context, [
    NOTE,
    presented(PRESENTED_LONG_AGO),
    comment("Antonio20045", " 2\n"),
  ]);
  assert.match(decision(writes), /Entschieden: Option 2\n/);
  assert.match(decision(writes), /von Antonio20045/);
  assert.ok(
    writes.some((write) => write.includes(`/issues/${ISSUE}/labels {"labels":["entschieden"]}`)),
  );
  assert.ok(writes.includes(`DELETE /repos/${REPOSITORY}/issues/${ISSUE}/labels/entscheidung `));
});

test("Wochenbericht: ohne Antwort gilt nach drei Tagen die Vorgabe", async (context) => {
  const writes = await evaluate(context, [NOTE, presented(PRESENTED_LONG_AGO)]);
  assert.match(decision(writes), /Entschieden: Option 1\n/);
});

test("Wochenbericht: vor Ablauf von drei Tagen wird nichts entschieden", async (context) => {
  const writes = await evaluate(context, [
    NOTE,
    presented(PRESENTED_IN_FUTURE),
    comment("Antonio20045", "2"),
  ]);
  assert.deepEqual(writes, []);
});
