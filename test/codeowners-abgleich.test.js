import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = resolve(REPO_ROOT, "tools/codeowners-abgleich.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const OWNERS = "@Antonio20045 @jonas986";
const SHARED_CODEOWNERS_PATTERNS = ["eslint.config.*", "/tools/", "/package.json"];
const SHARED_EDIT_RULES = ["Edit(**/eslint.config.*)", "Edit(tools/**)", "Edit(package.json)"];
const BAU_ONLY_EDIT_RULE = "Edit(test/**)";
const TEST_ONLY_EDIT_RULE = "Edit(src/**)";

function codeowners(patterns) {
  return patterns.map((pattern) => `${pattern} ${OWNERS}\n`).join("");
}

function roleFile(editRules) {
  return JSON.stringify({ permissions: { deny: editRules } });
}

function runCheck({
  codeownersPatterns = SHARED_CODEOWNERS_PATTERNS,
  bauRules = [...SHARED_EDIT_RULES, BAU_ONLY_EDIT_RULE],
  testRules = [...SHARED_EDIT_RULES, TEST_ONLY_EDIT_RULE],
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "codeowners-abgleich-"));
  try {
    mkdirSync(join(root, ".github"));
    mkdirSync(join(root, ".claude/rollen"), { recursive: true });
    writeFileSync(join(root, ".github/CODEOWNERS"), codeowners(codeownersPatterns));
    writeFileSync(join(root, ".claude/rollen/bau.json"), roleFile(bauRules));
    writeFileSync(join(root, ".claude/rollen/test.json"), roleFile(testRules));
    const run = spawnSync(process.execPath, [SCRIPT_PATH, root], { encoding: "utf8" });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("codeowners-abgleich: ein Pfad nur in CODEOWNERS stoppt den Abgleich und wird genannt", () => {
  const result = runCheck({
    codeownersPatterns: [...SHARED_CODEOWNERS_PATTERNS, "/scripts/pruefung.mjs"],
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, /nur in \.github\/CODEOWNERS.*bau\.json: scripts\/pruefung\.mjs/);
  assert.match(result.output, /nur in \.github\/CODEOWNERS.*test\.json: scripts\/pruefung\.mjs/);
});

test("codeowners-abgleich: ein Schreibverbot nur in einer Rollendatei stoppt den Abgleich und wird genannt", () => {
  const result = runCheck({
    bauRules: [...SHARED_EDIT_RULES, BAU_ONLY_EDIT_RULE, "Edit(scripts/**)"],
  });
  assert.equal(result.status, EXIT_FINDING);
  assert.match(result.output, /nur in \.claude\/rollen\/bau\.json.*CODEOWNERS: scripts\/\*\*/);
  assert.doesNotMatch(result.output, /test\.json/);
});

test("codeowners-abgleich: gleiche Pfade in beiden Schreibweisen ergeben Exit 0 ohne Ausgabe", () => {
  const result = runCheck();
  assert.equal(result.status, EXIT_OK);
  assert.equal(result.output, "");
});
