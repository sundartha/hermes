import { spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID, verify } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
const EXIT_KEYCHAIN_ENTRY_MISSING = 44;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_UNAUTHORIZED = 401;
const EXECUTABLE_MODE = 0o755;
const PERMISSION_BITS = 0o777;
const RSA_KEY_BITS = 2048;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MAX_JWT_SECONDS = 600;
const LONG_VALIDITY_MINUTES = 60;
const SHORT_VALIDITY_MINUTES = 5;
const APP_ID = "5250443";
const KEYCHAIN_SERVICE = "sundartha-agent-github-app-key";
const ACCESS_TOKENS_PATH = "/app/installations/169596050/access_tokens";
const REPOSITORIES_PATH = "/installation/repositories";
const BOT_LOGIN = "sundartha-agent[bot]";
const BOT_EMAIL = "340129717+sundartha-agent[bot]@users.noreply.github.com";
const HERMES = "sundartha/hermes";
const OTHER_REPOSITORY = "sundartha/anderes";
const UPSTREAM_URL = "https://github.com/sundartha/vodafone-agent.git";
const CREDENTIAL_REQUEST = "protocol=https\nhost=github.com\n\n";
const STORE_FILES = { "bin/gh": 0o700, "sitzung.mjs": 0o500, "token.json": 0o600 };
const FOREIGN_CREDENTIAL_CONFIG = [
  "[credential]",
  '  helper = "!f() { echo username=fremd; echo password=fremd; }; f"',
  "",
].join("\n");
const FAKE_GH = ["#!/bin/sh", 'printf "%s" "$GH_TOKEN"', ""].join("\n");

let workDir;
let server;
let apiUrl;
let keys;
let securityLog;
const issuedTokens = [];
const requests = [];
const worktrees = {};
const binDirs = {};
let scenario = {};

function fakeSecurity(keyBase64) {
  const expected = [`-a ${APP_ID}`, `-s ${KEYCHAIN_SERVICE}`, "-w"].join("|");
  return [
    "#!/usr/bin/env node",
    'const { appendFileSync } = require("node:fs");',
    "const [command, ...rest] = process.argv.slice(2);",
    `appendFileSync(${JSON.stringify(securityLog)}, JSON.stringify([command, ...rest]) + "\\n");`,
    "const asked = [];",
    "for (let i = 0; i < rest.length; i += 1) {",
    '  if (rest[i] === "-w") asked.push("-w");',
    '  else { asked.push(rest[i] + " " + rest[i + 1]); i += 1; }',
    "}",
    `const found = command === "find-generic-password" && asked.sort().join("|") === ${JSON.stringify(expected)};`,
    `if (!found || ${JSON.stringify(keyBase64)} === null) process.exit(${EXIT_KEYCHAIN_ENTRY_MISSING});`,
    `process.stdout.write(${JSON.stringify(keyBase64)} + "\\n");`,
    "",
  ].join("\n");
}

function fakeCaffeinate() {
  return [
    "#!/usr/bin/env node",
    'const { spawnSync } = require("node:child_process");',
    'const { readdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");',
    'const { basename, delimiter, dirname, join, relative } = require("node:path");',
    "const first = process.env.PATH.split(delimiter)[0];",
    'const inStore = basename(first) === "bin" && basename(dirname(first)).startsWith("sitzung-app-");',
    "const store = inStore ? dirname(first) : null;",
    "const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>",
    "  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);",
    "const files = () => (store === null ? [] : walk(store)).map((file) => ({",
    `  path: relative(store, file), mode: statSync(file).mode & ${PERMISSION_BITS},`,
    '  content: readFileSync(file, "utf8") }));',
    'const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };',
    "const run = (command, args, input) => {",
    '  const { status, stdout, stderr } = spawnSync(command, args, { env, input, encoding: "utf8" });',
    "  return { status, stdout, stderr };",
    "};",
    "const filesBefore = files();",
    'const gh = [run("gh", ["auth", "status"]), run("gh", ["api", "user"])];',
    `const fill = () => run("git", ["credential", "fill"], ${JSON.stringify(CREDENTIAL_REQUEST)});`,
    "const credentials = [fill(), fill()];",
    "const probe = { args: process.argv.slice(2), env: process.env, store, gh, credentials,",
    "  files: [...filesBefore, ...files()] };",
    "writeFileSync(process.env.SITZUNG_PROBE_DATEI, JSON.stringify(probe));",
    "",
  ].join("\n");
}

function writeExecutable(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, EXECUTABLE_MODE);
}

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

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function isValidAppJwt(jwt) {
  const [header, payload, signature = ""] = jwt.split(".");
  const signed = Buffer.from(`${header}.${payload}`);
  if (!verify("sha256", signed, keys.app.publicKey, Buffer.from(signature, "base64url"))) {
    return false;
  }
  const { iat, exp, iss } = decodeJwtPart(payload);
  const now = Date.now() / MS_PER_SECOND;
  const timely = iat <= now && now < exp && exp - iat <= MAX_JWT_SECONDS;
  return decodeJwtPart(header).alg === "RS256" && iss === APP_ID && timely;
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function issueToken(response) {
  const token = `ghs_probe_${issuedTokens.length + 1}`;
  issuedTokens.push(token);
  const expiresAt = new Date(Date.now() + scenario.minutes * MS_PER_MINUTE).toISOString();
  sendJson(response, HTTP_CREATED, { token, expires_at: expiresAt });
}

function listRepositories(response) {
  const repositories = scenario.repositories.map((fullName) => ({ full_name: fullName }));
  const totalCount = scenario.totalCount ?? repositories.length;
  sendJson(response, HTTP_OK, { total_count: totalCount, repositories });
}

function answerGithub(request, response) {
  const { pathname } = new URL(request.url, apiUrl);
  const bearer = (request.headers.authorization ?? "").replace(/^Bearer /, "");
  requests.push(`${request.method} ${pathname}`);
  if (request.method === "POST" && pathname === ACCESS_TOKENS_PATH && isValidAppJwt(bearer)) {
    issueToken(response);
    return;
  }
  if (request.method === "GET" && pathname === REPOSITORIES_PATH && issuedTokens.includes(bearer)) {
    listRepositories(response);
    return;
  }
  sendJson(response, HTTP_UNAUTHORIZED, { message: "Bad credentials" });
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
    SITZUNG_GITHUB_API: apiUrl,
  };
}

function runSession({ cwd, args = [], keychain = "app", ...github }) {
  scenario = { minutes: LONG_VALIDITY_MINUTES, repositories: [HERMES], ...github };
  const probeFile = join(workDir, `probe-${randomUUID()}.json`);
  const temporaryDir = mkdtempSync(join(workDir, "Mein 'Ordner' "));
  const path = [binDirs[keychain], binDirs.session, binDirs.gh, process.env.PATH];
  const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
    cwd,
    env: {
      ...baseEnvironment(),
      PATH: path.join(delimiter),
      TMPDIR: temporaryDir,
      SITZUNG_PROBE_DATEI: probeFile,
    },
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
      const leftovers = readdirSync(temporaryDir);
      resolvePromise({ status, stdout, stderr, launch, leftovers });
    });
  });
}

function gitWithSessionEnv(sessionEnv, args) {
  return spawnSync("git", args, {
    cwd: workDir,
    env: { ...sessionEnv, GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
  });
}

function passwordOf(credential) {
  return credential.stdout.match(/^password=(.*)$/m)?.[1];
}

function tokensUsedInSession(launch) {
  return [...launch.gh.map(({ stdout }) => stdout), ...launch.credentials.map(passwordOf)];
}

function securityCalls() {
  return readFileSync(securityLog, "utf8").split("\n").filter(Boolean);
}

function assertRefused(result, message) {
  assert.equal(result.status, EXIT_FAILURE);
  assert.match(result.stderr, message);
  assert.equal(result.launch, undefined);
  assert.deepEqual(result.leftovers, []);
}

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), "sitzung-"));
  securityLog = join(workDir, "security.log");
  writeFileSync(securityLog, "");
  keys = {
    app: generateKeyPairSync("rsa", { modulusLength: RSA_KEY_BITS }),
    foreign: generateKeyPairSync("rsa", { modulusLength: RSA_KEY_BITS }),
  };
  const pem = (pair) => pair.privateKey.export({ type: "pkcs8", format: "pem" });
  keys.pem = pem(keys.app);
  keys.base64 = Buffer.from(keys.pem).toString("base64");
  binDirs.session = join(workDir, "bin");
  binDirs.gh = join(workDir, "echtes gh");
  binDirs.app = join(workDir, "schluesselbund-app");
  binDirs.foreign = join(workDir, "schluesselbund-fremd");
  binDirs.empty = join(workDir, "schluesselbund-leer");
  writeExecutable(join(binDirs.session, "caffeinate"), fakeCaffeinate());
  writeExecutable(join(binDirs.gh, "gh"), FAKE_GH);
  writeExecutable(join(binDirs.app, "security"), fakeSecurity(keys.base64));
  const foreignBase64 = Buffer.from(pem(keys.foreign)).toString("base64");
  writeExecutable(join(binDirs.foreign, "security"), fakeSecurity(foreignBase64));
  writeExecutable(join(binDirs.empty, "security"), fakeSecurity(null));
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
  server = createServer(answerGithub);
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(workDir, { recursive: true, force: true });
});

test("sitzung: startet claude unter caffeinate mit Opus als Vorgabe", async () => {
  const result = await runSession({ cwd: worktrees.paket.worktree });
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
  const result = await runSession({ cwd: worktrees.paket.worktree, args: ["--modell", "sonnet"] });
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

test("sitzung: startet mit dem Schlüssel aus dem Schlüsselbund und gibt der Sitzung das Installations-Token", async () => {
  const issuedBefore = issuedTokens.length;
  const result = await runSession({ cwd: worktrees.paket.worktree });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(issuedTokens.length, issuedBefore + 1);
  assert.equal(result.launch.env.GH_TOKEN, issuedTokens[issuedBefore]);
});

test("sitzung: sieht die App zusätzlich ein anderes Repo, endet es mit Exit 1 und startet nichts", async () => {
  const result = await runSession({
    cwd: worktrees.paket.worktree,
    repositories: [HERMES, OTHER_REPOSITORY],
  });
  assertRefused(result, /sundartha\/anderes/);
});

test("sitzung: sieht die App sundartha/hermes nicht, endet es mit Exit 1 und startet nichts", async () => {
  for (const repositories of [[], [OTHER_REPOSITORY]]) {
    const result = await runSession({ cwd: worktrees.paket.worktree, repositories });
    assertRefused(result, /erwartet ist nur sundartha\/hermes/);
  }
});

test("sitzung: meldet GitHub mehr Repos als auf der ersten Seite stehen, endet es mit Exit 1", async () => {
  const result = await runSession({ cwd: worktrees.paket.worktree, totalCount: 2 });
  assertRefused(result, /insgesamt 2/);
});

test("sitzung: git credential fill und gh bekommen in der Sitzung ein gültiges Token, ein fremder Helper wirkt nicht", async () => {
  const { launch } = await runSession({ cwd: worktrees.paket.worktree });
  for (const call of [...launch.gh, ...launch.credentials]) {
    assert.equal(call.status, EXIT_OK, call.stderr);
  }
  for (const credential of launch.credentials) {
    assert.deepEqual(credential.stdout.match(/^username=.*$/gm), ["username=x-access-token"]);
    assert.equal(credential.stdout.match(/^password=.*$/gm).length, 1);
  }
  for (const token of tokensUsedInSession(launch)) {
    assert.ok(issuedTokens.includes(token), token);
  }
});

test("sitzung: läuft das Token bald ab, holt jeder Aufruf von gh und git ein neues gültiges Token", async () => {
  const issuedBefore = issuedTokens.length;
  const { launch } = await runSession({
    cwd: worktrees.paket.worktree,
    minutes: SHORT_VALIDITY_MINUTES,
  });
  assert.equal(launch.env.GH_TOKEN, issuedTokens[issuedBefore]);
  assert.deepEqual(tokensUsedInSession(launch), issuedTokens.slice(issuedBefore + 1));
});

test("sitzung: läuft das Token noch lange, nutzen gh und git es ohne neue Anfrage", async () => {
  const issuedBefore = issuedTokens.length;
  const { launch } = await runSession({ cwd: worktrees.paket.worktree });
  assert.equal(issuedTokens.length, issuedBefore + 1);
  for (const token of tokensUsedInSession(launch)) {
    assert.equal(token, launch.env.GH_TOKEN);
  }
});

test("sitzung: git arbeitet in der Sitzung als sundartha-agent[bot] mit dessen noreply-Adresse", async () => {
  const { launch } = await runSession({ cwd: worktrees.paket.worktree });
  assert.equal(
    gitWithSessionEnv(launch.env, ["config", "--get", "user.name"]).stdout.trim(),
    BOT_LOGIN,
  );
  assert.equal(
    gitWithSessionEnv(launch.env, ["config", "--get", "user.email"]).stdout.trim(),
    BOT_EMAIL,
  );
});

test("sitzung: der Schlüssel steht weder in der Umgebung noch in den Argumenten noch in der Ablage", async () => {
  const { launch } = await runSession({ cwd: worktrees.paket.worktree });
  assert.notEqual(launch.files.length, 0);
  const places = [
    ...Object.values(launch.env),
    ...launch.args,
    ...launch.files.map(({ content }) => content),
  ];
  const [, firstKeyLine] = keys.pem.split("\n");
  for (const secret of [keys.pem, keys.base64, firstKeyLine]) {
    assert.equal(
      places.some((place) => place.includes(secret)),
      false,
    );
  }
});

test("sitzung: die Ablage hält nur Werkzeug, Token und gh mit engen Rechten und ist nach der Sitzung gelöscht", async () => {
  const result = await runSession({ cwd: worktrees.paket.worktree });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.notEqual(result.launch.store, null);
  const modes = Object.fromEntries(result.launch.files.map(({ path, mode }) => [path, mode]));
  assert.deepEqual(modes, STORE_FILES);
  assert.equal(existsSync(result.launch.store), false);
  assert.deepEqual(result.leftovers, []);
});

test("sitzung: --nur-pruefen gibt nur den Login aus und startet nichts", async () => {
  const result = await runSession({ cwd: worktrees.paket.worktree, args: ["--nur-pruefen"] });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(result.stdout, `${BOT_LOGIN}\n`);
  assert.equal(result.launch, undefined);
  assert.deepEqual(result.leftovers, []);
});

test("sitzung: lehnt GitHub das JWT ab, endet es mit Exit 1 und startet nichts", async () => {
  const result = await runSession({ cwd: worktrees.paket.worktree, keychain: "foreign" });
  assertRefused(result, /HTTP 401/);
});

test("sitzung: fehlt der Eintrag im Schlüsselbund, endet es mit Exit 1, ohne GitHub zu fragen", async () => {
  const requestsBefore = requests.length;
  const result = await runSession({ cwd: worktrees.paket.worktree, keychain: "empty" });
  assertRefused(result, /sundartha-agent-github-app-key/);
  assert.equal(requests.length, requestsBefore);
});

test("sitzung: ausserhalb eines Paket-Worktrees liest es weder den Schlüsselbund noch fragt es GitHub", async () => {
  const requestsBefore = requests.length;
  const securityCallsBefore = securityCalls().length;
  const places = [
    worktrees.paket.mainRepo,
    worktrees.fremderBranch.worktree,
    worktrees.fremderUpstream.worktree,
  ];
  for (const cwd of places) {
    const result = await runSession({ cwd });
    assert.equal(result.status, EXIT_FAILURE, cwd);
    assert.equal(result.launch, undefined, cwd);
  }
  assert.equal(requests.length, requestsBefore);
  assert.equal(securityCalls().length, securityCallsBefore);
});

test("sitzung: ein unbekanntes Modell endet mit Exit 1 und startet nichts", async () => {
  const result = await runSession({ cwd: worktrees.paket.worktree, args: ["--modell", "haiku"] });
  assert.equal(result.status, EXIT_FAILURE);
  assert.equal(result.launch, undefined);
});

function writeOrder(name, content) {
  const path = join(workDir, name);
  writeFileSync(path, content);
  return path;
}

test("sitzung: --auftrag gibt den Inhalt der Datei als erste Nachricht an claude", async () => {
  const order = "Du baust Paket 99.\n\n---\nZweiter Absatz.\n";
  const result = await runSession({
    cwd: worktrees.paket.worktree,
    args: ["--auftrag", writeOrder("prompt-paket-99-probe.md", order)],
  });
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.deepEqual(result.launch.args, [
    "-i",
    "claude",
    "--model",
    "opus",
    "--permission-mode",
    "acceptEdits",
    "--",
    order,
  ]);
});

test("sitzung: --auftrag mit falscher Paketnummer endet mit Exit 1 und startet nichts", async () => {
  const result = await runSession({
    cwd: worktrees.paket.worktree,
    args: ["--auftrag", writeOrder("prompt-paket-98-probe.md", "Anderes Paket.\n")],
  });
  assert.equal(result.status, EXIT_FAILURE);
  assert.match(result.stderr, /prompt-paket-98-probe\.md/);
  assert.equal(result.launch, undefined);
});

test("sitzung: --auftrag mit fehlender Datei endet mit Exit 1 und startet nichts", async () => {
  const result = await runSession({
    cwd: worktrees.paket.worktree,
    args: ["--auftrag", join(workDir, "unterordner", "prompt-paket-99-probe.md")],
  });
  assert.equal(result.status, EXIT_FAILURE);
  assert.match(result.stderr, /lässt sich nicht lesen/);
  assert.equal(result.launch, undefined);
});

test("sitzung: --auftrag mit leerer Datei endet mit Exit 1 und startet nichts", async () => {
  const result = await runSession({
    cwd: worktrees.paket.worktree,
    args: ["--auftrag", writeOrder("prompt-paket-99-probe.md", "  \n")],
  });
  assert.equal(result.status, EXIT_FAILURE);
  assert.match(result.stderr, /leer/);
  assert.equal(result.launch, undefined);
});
