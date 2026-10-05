import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import {
  AFFECTED_TESTS_TOOL,
  ESLINT_BIN,
  PRUEFLEITER_TOOL,
  REPO_ROOT,
  isolatedEnvironment,
  passingTest,
  probeRepository,
  runIn,
} from "./probe-repo.js";

const LOCKFILE_TOOL = join(REPO_ROOT, "tools/lockfile-alter.mjs");
const AUDIT_TOOL = join(REPO_ROOT, "tools/audit-vergleich.mjs");
const EXIT_OK = 0;
const EXIT_USAGE = 2;
const MISSING_BASIS = /Basis fehlt oder ist kein Commit: ""/;
const UNREACHABLE_REGISTRY = "http://127.0.0.1:9/";
const EMPTY_LOCK = {
  name: "leere-basis",
  version: "1.0.0",
  lockfileVersion: 3,
  requires: true,
  packages: { "": { name: "leere-basis", version: "1.0.0" } },
};

function manifest(scripts) {
  return `${JSON.stringify({ name: "leere-basis", version: "1.0.0", type: "module", scripts })}\n`;
}

function lockedProbe(context) {
  return probeRepository(context, {
    "package.json": manifest({}),
    "package-lock.json": `${JSON.stringify(EMPTY_LOCK)}\n`,
    "tools/basis/lieferkette-ausnahmen.json": "[]\n",
  });
}

function withoutRegistry(directory, tool, args) {
  return spawnSync(process.execPath, [tool, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), npm_config_registry: UNREACHABLE_REGISTRY },
  });
}

test("lockfile-alter ist bei leerer Basis rot und misst bei gültiger Basis", (context) => {
  const directory = lockedProbe(context);
  const empty = withoutRegistry(directory, LOCKFILE_TOOL, ["--basis", ""]);
  assert.equal(empty.status, EXIT_USAGE, empty.stdout + empty.stderr);
  assert.match(empty.stderr, MISSING_BASIS);
  const unknown = withoutRegistry(directory, LOCKFILE_TOOL, ["--basis", "nicht-vorhanden"]);
  assert.equal(unknown.status, EXIT_USAGE, unknown.stdout + unknown.stderr);
  const valid = withoutRegistry(directory, LOCKFILE_TOOL, ["--basis", "HEAD"]);
  assert.equal(valid.status, EXIT_OK, valid.stdout + valid.stderr);
  assert.match(valid.stdout, /Lockfiles unverändert/);
});

test("audit-vergleich ist bei leerer Basis rot und vergleicht bei gültiger Basis", (context) => {
  const directory = lockedProbe(context);
  const empty = withoutRegistry(directory, AUDIT_TOOL, ["--basis", ""]);
  assert.equal(empty.status, EXIT_USAGE, empty.stdout + empty.stderr);
  assert.match(empty.stderr, MISSING_BASIS);
  const unknown = withoutRegistry(directory, AUDIT_TOOL, ["--basis", "nicht-vorhanden"]);
  assert.equal(unknown.status, EXIT_USAGE, unknown.stdout + unknown.stderr);
  const valid = withoutRegistry(directory, AUDIT_TOOL, ["--basis", "HEAD"]);
  assert.equal(valid.status, EXIT_OK, valid.stdout + valid.stderr);
  assert.match(valid.stdout, /keine neuen Meldungen/);
});

test("der Prüfleiter ist bei leerer Basis rot, bevor er etwas prüft, und grün bei gültiger", (context) => {
  const directory = probeRepository(context, {
    "package.json": manifest({
      lint: `node ${JSON.stringify(ESLINT_BIN)} src`,
      "test:betroffen": `node ${JSON.stringify(AFFECTED_TESTS_TOOL)}`,
    }),
    "eslint.config.js": "export default [];\n",
    "src/wert.js": "export const wert = 1;\n",
    "test/wert.test.js": passingTest("Wert bleibt"),
  });
  const empty = runIn(directory, process.execPath, [PRUEFLEITER_TOOL, "--basis", ""]);
  assert.equal(empty.status, EXIT_USAGE, empty.stdout + empty.stderr);
  assert.match(empty.stderr, /Basis fehlt: --basis ist leer/);
  assert.doesNotMatch(empty.stdout, /Lint/);
  const valid = runIn(directory, process.execPath, [PRUEFLEITER_TOOL, "--basis", "HEAD"]);
  assert.equal(valid.status, EXIT_OK, valid.stdout + valid.stderr);
});
