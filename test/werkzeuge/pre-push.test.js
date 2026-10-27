import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AFFECTED_TESTS_TOOL,
  ESLINT_BIN,
  PRE_PUSH_HOOK,
  PRUEFLEITER_TOOL,
  failingTest,
  isolatedEnvironment,
  passingTest,
  probeDirectory,
  probeRepository,
  runIn,
} from "./probe-repo.js";

const UPSTREAM_BASE_REF = "refs/remotes/upstream/master";
const RED_PRODUCT_TEST_MARKER = "roter betroffener Test";
const RED_TOOL_TEST_MARKER = "roter Werkzeugtest";
const RED_FULL_SUITE_MARKER = "roter Test der vollen Suite";

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

function probeWithPruefleiter(context) {
  const lockFile = join(probeDirectory(context, {}), "sperre");
  const directory = probeRepository(context, {
    "package.json": JSON.stringify({
      name: "pre-push-pruefleiter-probe",
      private: true,
      type: "module",
      scripts: {
        lint: `node ${JSON.stringify(ESLINT_BIN)} .`,
        "test:betroffen": `node ${JSON.stringify(AFFECTED_TESTS_TOOL)}`,
        pruefleiter: `SCHWERLAUF_SPERRDATEI=${JSON.stringify(lockFile)} node ${JSON.stringify(PRUEFLEITER_TOOL)}`,
      },
    }),
    "eslint.config.js": 'export default [{ rules: { "no-debugger": "error" } }];\n',
    "src/basis.js": "export const wert = 1;\n",
    "src/rot.js": "export const rot = 1;\n",
    "test/basis.test.js": [
      'import { wert } from "../src/basis.js";',
      passingTest("gruener betroffener Test"),
    ].join("\n"),
    "test/rot.test.js": failingTest(RED_PRODUCT_TEST_MARKER, "x", "../src/rot.js"),
    "test/voll.test.js": failingTest(RED_FULL_SUITE_MARKER, "x"),
    "test/werkzeuge/werkzeug.test.js": failingTest(RED_TOOL_TEST_MARKER, "x"),
    "tools/werkzeug.mjs": "export const werkzeug = 0;\n",
  });
  runIn(directory, "git", ["update-ref", UPSTREAM_BASE_REF, "HEAD"]);
  return directory;
}

function appendTo(directory, path, text) {
  appendFileSync(join(directory, path), text);
}

test("Der pre-push-Hook startet bei einer Aenderung unter tools weder Werkzeugtests noch die volle Suite", (context) => {
  const directory = probeWithPruefleiter(context);
  appendTo(directory, "tools/werkzeug.mjs", "export const geaendert = 1;\n");

  const hook = runHookAsGitDoes(directory);

  assert.equal(hook.status, 0, hook.stdout + hook.stderr);
  assert.doesNotMatch(hook.stdout, new RegExp(RED_TOOL_TEST_MARKER));
  assert.doesNotMatch(hook.stdout, new RegExp(RED_FULL_SUITE_MARKER));
});

test("Der pre-push-Hook faehrt bei einer Aenderung unter src die betroffenen Tests", (context) => {
  const directory = probeWithPruefleiter(context);
  appendTo(directory, "src/rot.js", "export const geaendert = 2;\n");

  const hook = runHookAsGitDoes(directory);

  assert.notEqual(hook.status, 0);
  assert.match(hook.stdout, new RegExp(RED_PRODUCT_TEST_MARKER));
});

test("Der pre-push-Hook faehrt Lint und nennt die Fundstelle", (context) => {
  const directory = probeWithPruefleiter(context);
  appendTo(directory, "src/basis.js", "debugger;\n");

  const hook = runHookAsGitDoes(directory);

  assert.notEqual(hook.status, 0);
  assert.match(hook.stdout, /src\/basis\.js:2/);
});

const PRUEFLEITER_MARKER = "Prüfleiter gestartet";
const NULL_SHA = "0".repeat(40);
const LOKALER_SHA = "1".repeat(40);
const PUSH_DES_WERKZEUGS = { HERMES_PUSH_LAUF_MUTATION: "1" };

function probeWithPruefleiterMarker(context) {
  return probeRepository(context, {
    "package.json": JSON.stringify({ name: "pre-push-marker-probe", private: true, scripts: { pruefleiter: `echo ${PRUEFLEITER_MARKER}` } }),
  });
}

function runHookWithRefs(directory, kennung, ...remoteRefs) {
  const lines = remoteRefs.map(([localRef, remoteRef]) => `${localRef} ${localRef === "(delete)" ? NULL_SHA : LOKALER_SHA} ${remoteRef} ${NULL_SHA}\n`);
  return spawnSync("sh", [PRE_PUSH_HOOK], {
    cwd: directory,
    encoding: "utf8",
    input: lines.join(""),
    env: { ...isolatedEnvironment(), ...kennung, GIT_DIR: join(directory, ".git") },
  });
}

test("Der pre-push-Hook laesst einen Push nur nach lauf-mutation ohne Pruefleiter durch", (context) => {
  const hook = runHookWithRefs(probeWithPruefleiterMarker(context), PUSH_DES_WERKZEUGS, ["refs/heads/x", "refs/heads/lauf-mutation/x"]);

  assert.equal(hook.status, 0, hook.stdout + hook.stderr);
  assert.doesNotMatch(hook.stdout, new RegExp(PRUEFLEITER_MARKER));
});

test("Der pre-push-Hook faehrt den Pruefleiter, wenn neben lauf-mutation ein anderer Branch gepusht wird", (context) => {
  const hook = runHookWithRefs(probeWithPruefleiterMarker(context), PUSH_DES_WERKZEUGS, ["refs/heads/x", "refs/heads/lauf-mutation/x"], ["refs/heads/y", "refs/heads/paket/y"]);

  assert.match(hook.stdout, new RegExp(PRUEFLEITER_MARKER));
});

test("Der pre-push-Hook faehrt den Pruefleiter fuer einen Branch, der nur mit lauf-mutation beginnt", (context) => {
  const hook = runHookWithRefs(probeWithPruefleiterMarker(context), PUSH_DES_WERKZEUGS, ["refs/heads/x", "refs/heads/lauf-mutation-x"]);

  assert.match(hook.stdout, new RegExp(PRUEFLEITER_MARKER));
});

test("Der pre-push-Hook faehrt den Pruefleiter beim Loeschen eines anderen Branches und ohne Angaben auf stdin", (context) => {
  const directory = probeWithPruefleiterMarker(context);

  assert.match(runHookWithRefs(directory, PUSH_DES_WERKZEUGS, ["(delete)", "refs/heads/paket/y"]).stdout, new RegExp(PRUEFLEITER_MARKER));
  assert.match(runHookWithRefs(directory, PUSH_DES_WERKZEUGS).stdout, new RegExp(PRUEFLEITER_MARKER));
});

test("Der pre-push-Hook faehrt den Pruefleiter fuer lauf-mutation, wenn der Push nicht vom Werkzeug gekennzeichnet ist", (context) => {
  const hook = runHookWithRefs(probeWithPruefleiterMarker(context), {}, ["refs/heads/x", "refs/heads/lauf-mutation/x"]);

  assert.match(hook.stdout, new RegExp(PRUEFLEITER_MARKER));
});
