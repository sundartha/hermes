import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import {
  PRE_PUSH_HOOK,
  isolatedEnvironment,
  probeRepository,
  runIn,
} from "./probe-repo.js";

const FOREIGN_REPOSITORY_SCRIPT = [
  'import { spawnSync } from "node:child_process";',
  'import { mkdtempSync, rmSync } from "node:fs";',
  'import { tmpdir } from "node:os";',
  'import { join } from "node:path";',
  'const foreign = mkdtempSync(join(tmpdir(), "fremdes-repo-"));',
  'const identity = ["-c", "user.name=Fremd", "-c", "user.email=fremd@example.invalid"];',
  'spawnSync("git", ["init", "-q"], { cwd: foreign });',
  'spawnSync("git", [...identity, "commit", "--allow-empty", "-q", "-m", "Fremd"], { cwd: foreign });',
  "rmSync(foreign, { recursive: true, force: true });",
  "",
].join("\n");

function probeWithForeignRepositoryCheck(context) {
  return probeRepository(context, {
    "package.json": JSON.stringify({
      name: "pre-push-probe",
      private: true,
      scripts: { pruefleiter: "node fremdes-repo.mjs" },
    }),
    "fremdes-repo.mjs": FOREIGN_REPOSITORY_SCRIPT,
  });
}

function runHookAsGitDoes(directory) {
  return spawnSync("sh", [PRE_PUSH_HOOK], {
    cwd: directory,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), GIT_DIR: join(directory, ".git") },
  });
}

test("Tests, die im pre-push-Hook eigene Repos anlegen, schreiben nicht ins gepushte Repo", (context) => {
  const directory = probeWithForeignRepositoryCheck(context);

  const hook = runHookAsGitDoes(directory);
  const history = runIn(directory, "git", ["log", "--format=%s"]);

  assert.equal(hook.status, 0, hook.stdout + hook.stderr);
  assert.equal(history.stdout.trim(), "Basis", history.stderr);
});
