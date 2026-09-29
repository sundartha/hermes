import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = resolve(REPO_ROOT, "tools/rotprobe.mjs");
const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXECUTABLE_MODE = 0o755;
const PAKET_BRANCH = "paket/99-probe";
const PULL_REQUEST_NUMBER = "77";
const REJECTING_HOOK = "#!/bin/sh\nexit 1\n";
const FAKE_GH = [
  "#!/usr/bin/env node",
  'const { appendFileSync } = require("node:fs");',
  "appendFileSync(process.env.ROTPROBE_GH_PROTOKOLL, JSON.stringify(process.argv.slice(2)) + '\\n');",
  `console.log("https://github.com/sundartha/probe/pull/${PULL_REQUEST_NUMBER}");`,
  "",
].join("\n");
const IDENTITY = {
  GIT_AUTHOR_NAME: "probe",
  GIT_AUTHOR_EMAIL: "probe@example.invalid",
  GIT_COMMITTER_NAME: "probe",
  GIT_COMMITTER_EMAIL: "probe@example.invalid",
};

let workDir;
let remoteDir;
let repoDir;
let patchFile;
let ghLog;

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...IDENTITY } });
}

function gitOk(cwd, args) {
  const run = git(cwd, args);
  assert.equal(run.status, EXIT_OK, run.stderr);
  return run.stdout.trim();
}

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, EXECUTABLE_MODE);
}

function runRotprobe(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    env: {
      ...process.env,
      ...IDENTITY,
      PATH: `${join(workDir, "bin")}${delimiter}${process.env.PATH}`,
      ROTPROBE_GH_PROTOKOLL: ghLog,
    },
  });
}

function ghCalls() {
  if (!existsSync(ghLog)) return [];
  return readFileSync(ghLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function valueAfter(args, flag) {
  return args[args.indexOf(flag) + 1];
}

function remoteBranchExists(branch) {
  return (
    git(remoteDir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === EXIT_OK
  );
}

before(() => {
  workDir = mkdtempSync(join(tmpdir(), "rotprobe-"));
  remoteDir = join(workDir, "remote.git");
  repoDir = join(workDir, "arbeit");
  patchFile = join(workDir, "verstoss.patch");
  ghLog = join(workDir, "gh-aufrufe.jsonl");
  mkdirSync(join(workDir, "bin"));
  mkdirSync(join(workDir, "hooks"));
  mkdirSync(repoDir);
  writeExecutable(join(workDir, "bin", "gh"), FAKE_GH);
  writeExecutable(join(workDir, "hooks", "pre-commit"), REJECTING_HOOK);
  writeExecutable(join(workDir, "hooks", "pre-push"), REJECTING_HOOK);
  gitOk(workDir, ["init", "-q", "--bare", "-b", "master", remoteDir]);
  gitOk(repoDir, ["init", "-q", "-b", "master"]);
  writeFileSync(join(repoDir, "a.txt"), "eins\n");
  gitOk(repoDir, ["add", "a.txt"]);
  gitOk(repoDir, ["commit", "-q", "-m", "Start"]);
  gitOk(repoDir, ["remote", "add", "upstream", "https://github.com/sundartha/probe.git"]);
  gitOk(repoDir, ["remote", "set-url", "--push", "upstream", remoteDir]);
  gitOk(repoDir, ["push", "-q", "upstream", "master"]);
  gitOk(repoDir, ["switch", "-q", "-c", PAKET_BRANCH]);
  writeFileSync(join(repoDir, "a.txt"), "zwei\n");
  writeFileSync(patchFile, gitOk(repoDir, ["diff"]) + "\n");
  gitOk(repoDir, ["checkout", "--", "a.txt"]);
  gitOk(repoDir, ["config", "core.hooksPath", join(workDir, "hooks")]);
  assert.notEqual(
    git(repoDir, ["commit", "--allow-empty", "-q", "-m", "Kontrolle"]).status,
    EXIT_OK,
  );
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

test("rotprobe: legt rotprobe/<paket>-<fall> mit genau einem Commit an, pusht trotz ablehnender Hooks und oeffnet einen Entwurfs-PR", () => {
  const result = runRotprobe(["99", "verstoss", patchFile]);
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(result.stdout, `${PULL_REQUEST_NUMBER}\n`);
  assert.equal(gitOk(remoteDir, ["rev-list", "--count", "master..rotprobe/99-verstoss"]), "1");
  assert.equal(gitOk(remoteDir, ["show", "rotprobe/99-verstoss:a.txt"]), "zwei");
  assert.match(
    gitOk(remoteDir, ["log", "-1", "--format=%B", "rotprobe/99-verstoss"]),
    /^Paket: 99$/m,
  );
  const args = ghCalls().at(-1);
  assert.equal(args[0], "pr");
  assert.equal(args[1], "create");
  assert.ok(args.includes("--draft"), args.join(" "));
  assert.equal(valueAfter(args, "--title"), "Rot-Probe 99: verstoss");
  assert.equal(valueAfter(args, "--head"), "rotprobe/99-verstoss");
  assert.equal(valueAfter(args, "--base"), "master");
  assert.equal(valueAfter(args, "--repo"), "sundartha/probe");
  assert.equal(gitOk(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]), PAKET_BRANCH);
  assert.equal(readFileSync(join(repoDir, "a.txt"), "utf8"), "eins\n");
});

test("rotprobe: --art beleg legt beleg/<paket>-<fall> an und oeffnet einen Entwurfs-PR", () => {
  const result = runRotprobe(["99", "lauf", patchFile, "--art", "beleg"]);
  assert.equal(result.status, EXIT_OK, result.stderr);
  assert.equal(gitOk(remoteDir, ["rev-list", "--count", "master..beleg/99-lauf"]), "1");
  assert.equal(valueAfter(ghCalls().at(-1), "--title"), "Beleg 99: lauf");
});

test("rotprobe: ein Branch-Name ohne rotprobe/ oder beleg/ wird abgelehnt, und nichts wird angelegt", () => {
  const callsBefore = ghCalls().length;
  const result = runRotprobe(["99", "verstoss", patchFile, "--art", "paket"]);
  assert.equal(result.status, EXIT_FAILURE);
  assert.match(result.stderr, /paket\/99-verstoss/);
  assert.notEqual(
    git(repoDir, ["rev-parse", "--verify", "--quiet", "refs/heads/paket/99-verstoss"]).status,
    EXIT_OK,
  );
  assert.equal(remoteBranchExists("paket/99-verstoss"), false);
  assert.equal(ghCalls().length, callsBefore);
});
