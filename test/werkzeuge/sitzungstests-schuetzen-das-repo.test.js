import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { withoutGitVariables } from "./git-umgebung.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROBED_TESTS = ["test/sitzung.test.js", "test/rotprobe.test.js"];
const EXIT_OK = 0;
const IDENTITY = ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid"];

let workDir;
let gitDir;

function gitInThrowaway(args) {
  const run = spawnSync("git", [...IDENTITY, `--git-dir=${gitDir}`, ...args], {
    encoding: "utf8",
    env: withoutGitVariables(process.env),
  });
  assert.equal(run.status, EXIT_OK, run.stderr);
  return run.stdout;
}

function snapshot() {
  return {
    config: readFileSync(join(gitDir, "config"), "utf8"),
    refs: gitInThrowaway(["for-each-ref"]),
    commits: gitInThrowaway(["rev-list", "--all", "--count"]),
    head: gitInThrowaway(["symbolic-ref", "HEAD"]),
  };
}

function runTestFile(file) {
  const environment = withoutGitVariables(process.env);
  delete environment.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["--test", file], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...environment, GIT_DIR: gitDir },
  });
}

before(() => {
  workDir = mkdtempSync(join(tmpdir(), "repo-schutz-"));
  const repoDir = join(workDir, "wegwerf");
  gitDir = join(repoDir, ".git");
  const init = spawnSync("git", ["init", "-q", "-b", "master", repoDir], {
    encoding: "utf8",
    env: withoutGitVariables(process.env),
  });
  assert.equal(init.status, EXIT_OK, init.stderr);
  gitInThrowaway(["commit", "-q", "--allow-empty", "-m", "Start"]);
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

for (const file of PROBED_TESTS) {
  test(`${file} laesst mit gesetztem GIT_DIR das fremde Repo unveraendert`, () => {
    const before = snapshot();
    runTestFile(file);
    assert.deepEqual(snapshot(), before);
  });
}
