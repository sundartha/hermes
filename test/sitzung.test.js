import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { withoutGitVariables } from "./werkzeuge/git-umgebung.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = resolve(REPO_ROOT, "tools/sitzung.mjs");
const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const EXECUTABLE_MODE = 0o755;
const BOT_LOGIN = "sundartha-bot";
const BOT_ID = 4242;
const BOT_TOKEN = "bot-token";
const OWNER_TOKEN = "owner-token";
const UPSTREAM_URL = "https://github.com/sundartha/vodafone-agent.git";
const USERS = {
  [BOT_TOKEN]: { login: BOT_LOGIN, id: BOT_ID },
  [OWNER_TOKEN]: { login: "Antonio20045", id: 1 },
};
const FAKE_CAFFEINATE = [
  "#!/usr/bin/env node",
  'const { writeFileSync } = require("node:fs");',
  "writeFileSync(process.env.SITZUNG_PROBE_DATEI, JSON.stringify({ args: process.argv.slice(2), env: process.env }));",
  "",
].join("\n");
const FOREIGN_CREDENTIAL_CONFIG = [
  "[credential]",
  '  helper = "!f() { echo username=fremd; echo password=fremd; }; f"',
  "",
].join("\n");

let workDir;
let server;
let apiUrl;
let requestCount = 0;
const worktrees = {};

function gitIn(cwd, args) {
  const run = spawnSync(
    "git",
    ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", ...args],
    {
      cwd,
      encoding: "utf8",
      env: withoutGitVariables(process.env),
    },
  );
  assert.equal(run.status, EXIT_OK, run.stderr);
  return run.stdout.trim();
}

function createWorktree(name, { branch, upstream }) {
  const mainRepo = join(workDir, name);
  mkdirSync(mainRepo);
  gitIn(mainRepo, ["init", "-q", "-b", "master"]);
  gitIn(mainRepo, ["commit", "-q", "--allow-empty", "-m", "Start"]);
  gitIn(mainRepo, ["remote", "add", "upstream", upstream]);
  const worktree = join(mainRepo, ".claude", "worktrees", name);
  gitIn(mainRepo, ["worktree", "add", "-q", "-b", branch, worktree]);
  return { mainRepo, worktree };
}

function answerUserRequest(request, response) {
  requestCount += 1;
  const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
  const user = USERS[token];
  if (request.url !== "/user" || user === undefined) {
    response.writeHead(HTTP_UNAUTHORIZED, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "Bad credentials" }));
    return;
  }
  response.writeHead(HTTP_OK, { "content-type": "application/json" });
  response.end(JSON.stringify(user));
}

function baseEnvironment() {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(GH_|GITHUB_|GIT_|SITZUNG_)/.test(key)),
  );
  return {
    ...inherited,
    GH_TOKEN: "vorher-gesetzt",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "user.name",
    GIT_CONFIG_VALUE_0: "vorher-gesetzt",
    GIT_CONFIG_GLOBAL: join(workDir, "fremde-zugangsdaten.gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    PATH: `${join(workDir, "bin")}${delimiter}${process.env.PATH}`,
    SITZUNG_GITHUB_API: apiUrl,
  };
}

function runSession({ cwd, token, args = [] }) {
  const probeFile = join(workDir, `probe-${randomUUID()}.json`);
  const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
    cwd,
    env: { ...baseEnvironment(), SITZUNG_TOKEN: token, SITZUNG_PROBE_DATEI: probeFile },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolvePromise) => {
    child.on("close", (status) => {
      const started = existsSync(probeFile);
      const launch = started ? JSON.parse(readFileSync(probeFile, "utf8")) : undefined;
      resolvePromise({ status, stdout, stderr, launch });
    });
  });
}

function gitWithSessionEnv(sessionEnv, args, input) {
  return spawnSync("git", args, {
    cwd: workDir,
    env: { ...sessionEnv, GIT_TERMINAL_PROMPT: "0" },
    input,
    encoding: "utf8",
  });
}

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), "sitzung-"));
  mkdirSync(join(workDir, "bin"));
  writeFileSync(join(workDir, "bin", "caffeinate"), FAKE_CAFFEINATE);
  chmodSync(join(workDir, "bin", "caffeinate"), EXECUTABLE_MODE);
  writeFileSync(join(workDir, "fremde-zugangsdaten.gitconfig"), FOREIGN_CREDENTIAL_CONFIG);
  worktrees.paket = createWorktree("paket", { branch: "paket/99-probe", upstream: UPSTREAM_URL });
  worktrees.fremderBranch = createWorktree("fremd", {
    branch: "feature/probe",
    upstream: UPSTREAM_URL,
  });
  worktrees.fremderUpstream = createWorktree("fork", {
    branch: "paket/99-probe",
    upstream: "https://github.com/jonas986/vodafone-agent.git",
  });
  server = createServer(answerUserRequest);
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(workDir, { recursive: true, force: true });
});

test("sitzung: startet claude unter caffeinate mit Opus als Vorgabe", async () => {
  const result = await runSession({ cwd: worktrees.paket.worktree, token: BOT_TOKEN });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.deepEqual(result.launch.args, [
    "-i",
    "claude",
    "--model",
    "opus",
    "--permission-mode",
    "acceptEdits",
  ]);
});

test("sitzung: --modell sonnet startet claude mit Sonnet", async () => {
  const result = await runSession({
    cwd: worktrees.paket.worktree,
    token: BOT_TOKEN,
    args: ["--modell", "sonnet"],
  });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.deepEqual(result.launch.args, [
    "-i",
    "claude",
    "--model",
    "sonnet",
    "--permission-mode",
    "acceptEdits",
  ]);
});

test("sitzung: die gestartete Sitzung arbeitet mit Token, Zugangsdaten, Name und E-Mail des Bots", async () => {
  const { launch } = await runSession({ cwd: worktrees.paket.worktree, token: BOT_TOKEN });
  assert.equal(launch.env.GH_TOKEN, BOT_TOKEN);
  const credentials = gitWithSessionEnv(
    launch.env,
    ["credential", "fill"],
    "protocol=https\nhost=github.com\n\n",
  );
  assert.equal(credentials.status, EXIT_OK, credentials.stderr);
  assert.match(credentials.stdout, new RegExp(`^username=${BOT_LOGIN}$`, "m"));
  assert.match(credentials.stdout, new RegExp(`^password=${BOT_TOKEN}$`, "m"));
  assert.equal(
    gitWithSessionEnv(launch.env, ["config", "--get", "user.name"]).stdout.trim(),
    BOT_LOGIN,
  );
  assert.equal(
    gitWithSessionEnv(launch.env, ["config", "--get", "user.email"]).stdout.trim(),
    `${BOT_ID}+${BOT_LOGIN}@users.noreply.github.com`,
  );
});

test("sitzung: --nur-pruefen gibt nur den Login aus und startet nichts", async () => {
  const result = await runSession({
    cwd: worktrees.paket.worktree,
    token: BOT_TOKEN,
    args: ["--nur-pruefen"],
  });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(result.stdout, `${BOT_LOGIN}\n`);
  assert.equal(result.launch, undefined);
});

test("sitzung: ein Token eines anderen Kontos endet mit Exit 1 und startet nichts", async () => {
  const result = await runSession({ cwd: worktrees.paket.worktree, token: OWNER_TOKEN });
  assert.equal(result.status, EXIT_FAILURE);
  assert.match(result.stderr, /Antonio20045/);
  assert.equal(result.launch, undefined);
});

test("sitzung: ein von GitHub abgelehntes Token endet mit Exit 1 und startet nichts", async () => {
  const result = await runSession({ cwd: worktrees.paket.worktree, token: "falsch" });
  assert.equal(result.status, EXIT_FAILURE);
  assert.match(result.stderr, /HTTP 401/);
  assert.equal(result.launch, undefined);
});

test("sitzung: ausserhalb eines Paket-Worktrees fragt es GitHub gar nicht erst", async () => {
  const requestsBefore = requestCount;
  const places = [
    worktrees.paket.mainRepo,
    worktrees.fremderBranch.worktree,
    worktrees.fremderUpstream.worktree,
  ];
  for (const cwd of places) {
    const result = await runSession({ cwd, token: BOT_TOKEN });
    assert.equal(result.status, EXIT_FAILURE, cwd);
    assert.equal(result.launch, undefined, cwd);
  }
  assert.equal(requestCount, requestsBefore);
});

test("sitzung: ein unbekanntes Modell endet mit Exit 1 und startet nichts", async () => {
  const result = await runSession({
    cwd: worktrees.paket.worktree,
    token: BOT_TOKEN,
    args: ["--modell", "haiku"],
  });
  assert.equal(result.status, EXIT_FAILURE);
  assert.equal(result.launch, undefined);
});
