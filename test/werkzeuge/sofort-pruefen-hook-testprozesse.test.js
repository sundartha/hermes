import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../../.claude/hooks/leise-befehle.mjs", import.meta.url));
const ABGEWIESEN = 2;
const ERLAUBT = 0;

function hook(command) {
  return spawnSync("node", [HOOK], { input: JSON.stringify({ tool_input: { command } }), encoding: "utf8" });
}

const ABGEWIESENE_BEFEHLE = [
  "node --test test/a.test.js",
  "TEST_X=1 node --test test/a.test.js",
  "env TEST_X=1 node --test test/a.test.js",
  "env node --test test/a.test.js",
  "command node --test test/a.test.js",
  "exec node --test test/a.test.js",
  "npx node --test test/a.test.js",
  "npm exec -- node --test test/a.test.js",
  "/usr/local/bin/node --test test/a.test.js",
  "node --import ./wachter.mjs --test test/a.test.js",
  "node --test-name-pattern=Ende --test test/a.test.js",
  "cd x && node --test --test-name-pattern='Ende: scheitert' test/a.test.js",
  "bash -c 'node --test test/a.test.js'",
  'sh -c "cd x && node --test test/a.test.js"',
  "bash -lc 'env A=1 node --test test/a.test.js'",
  "echo $(node --test test/a.test.js)",
  'echo "$(node --test test/a.test.js)"',
  "echo `node --test test/a.test.js`",
  "echo $(echo $(node --test test/a.test.js))",
  "(node --test test/a.test.js)",
  "{ node --test test/a.test.js; }",
  "nohup node --test test/a.test.js &",
  "timeout 60 node --test test/a.test.js",
  "nice node --test test/a.test.js",
  "nice -n 5 node --test test/a.test.js",
  "time node --test test/a.test.js",
  "xargs node --test < f",
  'eval "node --test x"',
  "eval 'node --test x'",
  'sh -c "echo \\"hi\\"; node --test x"',
];

const ERLAUBTE_BEFEHLE = [
  "npm test -- test/a.test.js",
  'echo "node --test"',
  'git commit -m "node --test"',
  "echo 'bash -c \"node --test\"'",
  "node script.js",
  "echo $(date)",
  "bash -c 'npm test -- test/a.test.js'",
  "(npm test -- test/a.test.js)",
  "nohup npm test -- test/a.test.js &",
  'eval "npm test -- x"',
];

for (const command of ABGEWIESENE_BEFEHLE) {
  test(`Testprozess am Wächter vorbei wird abgewiesen: ${command}`, () => {
    const lauf = hook(command);
    assert.equal(lauf.status, ABGEWIESEN);
    assert.match(lauf.stderr, /`node --test` direkt ist blockiert/);
    assert.match(lauf.stderr, /npm test -- <Testdatei>/);
  });
}

for (const command of ERLAUBTE_BEFEHLE) {
  test(`Erlaubter Befehl bleibt still: ${command}`, () => {
    const lauf = hook(command);
    assert.equal(lauf.status, ERLAUBT);
    assert.equal(lauf.stderr, "");
  });
}
