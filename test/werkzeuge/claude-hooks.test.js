import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  BLOCKING_EXIT_CODE,
  REPO_ROOT,
  outputLines,
  probeDirectory,
  probeRepository,
  runHook,
  runIn,
} from "./probe-repo.js";

const LONG_FILE_LINES = 1500;
const SHORT_FILE_LINES = 50;
const RANGE_OFFSET = 10;
const RANGE_LIMIT = 100;
const MAX_PRUEFLEITER_LINES = 60;
const RED_OUTPUT_LINES = 200;
const REPAIR_SENTENCE = "Repariere den Code, nicht die Prüfung.";
const PRUEFLEITER_LOG = "PRUEFLEITER_LOG";
const PRUEFLEITER_RED = "PRUEFLEITER_RED";
const MAIN_FILE = "src/haupt.js";
const WORKTREE_NAME = "arbeit";
const SECOND_RUN = 2;
const THIRD_RUN = 3;

function lines(count) {
  return `${Array.from({ length: count }, (unused, index) => `zeile ${index}`).join("\n")}\n`;
}

function bashInput(command) {
  return { tool_input: { command } };
}

function fileInput(file, range = {}) {
  return { tool_input: { file_path: file, ...range } };
}

function runQuietCommand(command) {
  return runHook("leise-befehle.mjs", { cwd: REPO_ROOT, input: bashInput(command) });
}

test("leise-befehle blockiert node --test direkt und nennt die leisen Befehle", () => {
  const commands = [
    "node --test test/a.test.js",
    "NODE_ENV=test node --test",
    "cd test && node --no-warnings --test",
    "echo start; node --test",
  ];
  for (const command of commands) {
    const result = runQuietCommand(command);
    assert.equal(result.status, BLOCKING_EXIT_CODE, command);
    assert.match(result.stderr, /npm test/);
    assert.match(result.stderr, /npm run pruefleiter/);
  }
});

test("leise-befehle erlaubt npm test, Pruefleiter, Skripte mit eigenem --test und zitierten Text", () => {
  const commands = [
    "npm test",
    "npm run pruefleiter",
    "node tools/skript.mjs --test",
    "git commit -m 'node --test ist blockiert'",
    'echo "start; node --test"',
  ];
  for (const command of commands) {
    assert.equal(runQuietCommand(command).status, 0, command);
  }
});

test("lesesperre blockiert eine lange Datei ohne offset und limit", (context) => {
  const directory = probeDirectory(context, { "gross.txt": lines(LONG_FILE_LINES) });
  const result = runHook("lesesperre.mjs", {
    cwd: directory,
    input: fileInput(join(directory, "gross.txt")),
  });
  assert.equal(result.status, BLOCKING_EXIT_CODE);
  assert.match(result.stderr, /offset und limit/);
});

test("lesesperre erlaubt lange Dateien mit Ausschnitt und kurze Dateien ohne", (context) => {
  const directory = probeDirectory(context, {
    "gross.txt": lines(LONG_FILE_LINES),
    "klein.txt": lines(SHORT_FILE_LINES),
  });
  const big = join(directory, "gross.txt");
  const inputs = [
    fileInput(big, { offset: RANGE_OFFSET, limit: RANGE_LIMIT }),
    fileInput(big, { limit: RANGE_LIMIT }),
    fileInput(big, { offset: 0 }),
    fileInput(join(directory, "klein.txt")),
    fileInput(join(directory, "fehlt.txt")),
  ];
  for (const input of inputs) {
    assert.equal(runHook("lesesperre.mjs", { cwd: directory, input }).status, 0);
  }
});

function lintProbe(context) {
  const directory = probeDirectory(context, {
    "eslint.config.js": 'export default [{ rules: { "no-debugger": "error" } }];\n',
    "sauber.js": "export const wert = 1;\n",
    "fehler.js": "debugger;\n",
    "notiz.md": "debugger;\n",
  });
  const eslintPackage = createRequire(join(REPO_ROOT, "package.json")).resolve("eslint/package.json");
  mkdirSync(join(directory, "node_modules"));
  symlinkSync(dirname(eslintPackage), join(directory, "node_modules/eslint"));
  return directory;
}

function runLint(directory, name) {
  return runHook("lint-datei.mjs", { cwd: directory, input: fileInput(join(directory, name)) });
}

test("lint-datei blockiert eine Datei mit Lint-Fehler und nennt Stelle und Regel", (context) => {
  const result = runLint(lintProbe(context), "fehler.js");
  assert.equal(result.status, BLOCKING_EXIT_CODE);
  assert.match(result.stderr, /fehler\.js:1:1 .*\(no-debugger\)/);
});

test("lint-datei erlaubt saubere Dateien, andere Dateitypen und fehlende Dateien", (context) => {
  const directory = lintProbe(context);
  for (const name of ["sauber.js", "notiz.md", "fehlt.js"]) {
    assert.equal(runLint(directory, name).status, 0, name);
  }
});

function worktreeProbe(context) {
  const directory = realpathSync(
    probeRepository(context, { [MAIN_FILE]: "export const a = 1;\n" }),
  );
  const worktree = join(directory, ".claude/worktrees", WORKTREE_NAME);
  const added = runIn(directory, "git", ["worktree", "add", "-q", "-b", "arbeit", worktree]);
  assert.equal(added.status, 0, added.stderr);
  return { directory, worktree };
}

function runWorktreeRule(cwd, file) {
  return runHook("worktree-pflicht.mjs", { cwd, input: fileInput(file) });
}

test("worktree-pflicht blockiert Schreiben im Haupt-Checkout, auch aus einem Worktree heraus", (context) => {
  const { directory, worktree } = worktreeProbe(context);
  for (const cwd of [directory, worktree]) {
    const result = runWorktreeRule(cwd, join(directory, MAIN_FILE));
    assert.equal(result.status, BLOCKING_EXIT_CODE, cwd);
    assert.match(result.stderr, /Worktree/);
  }
});

test("worktree-pflicht erlaubt Schreiben im Worktree und ausserhalb des Repositorys", (context) => {
  const { directory, worktree } = worktreeProbe(context);
  const outside = probeDirectory(context, {});
  const allowedFromWorktree = [
    join(worktree, "src/neu.js"),
    join(worktree, MAIN_FILE),
    join(outside, "pr-text.md"),
    "src/relativ.js",
  ];
  for (const file of allowedFromWorktree) {
    assert.equal(runWorktreeRule(worktree, file).status, 0, file);
  }
  assert.equal(runWorktreeRule(directory, join(outside, "x.md")).status, 0);
});

function pruefleiterProbe(context) {
  const logDirectory = probeDirectory(context, {});
  const directory = probeRepository(context, {
    "package.json": JSON.stringify({
      name: "pruefleiter-hook-probe",
      private: true,
      type: "module",
      scripts: { pruefleiter: "node lauf.mjs" },
    }),
    "lauf.mjs": [
      'import { appendFileSync } from "node:fs";',
      `appendFileSync(process.env.${PRUEFLEITER_LOG}, "lauf\\n");`,
      `const red = process.env.${PRUEFLEITER_RED} === "1";`,
      `if (red) for (let n = 0; n < ${RED_OUTPUT_LINES}; n += 1) console.log(\`Befund \${n}\`);`,
      "process.exitCode = red ? 1 : 0;",
      "",
    ].join("\n"),
    "src/basis.js": "export const wert = 1;\n",
  });
  return { directory, log: join(logDirectory, "laeufe.log") };
}

function runStop(probe, red = false) {
  return runHook("pruefleiter.mjs", {
    cwd: probe.directory,
    input: { hook_event_name: "Stop" },
    environment: { [PRUEFLEITER_LOG]: probe.log, [PRUEFLEITER_RED]: red ? "1" : "0" },
  });
}

function runCount(probe) {
  try {
    return outputLines(readFileSync(probe.log, "utf8")).length;
  } catch {
    return 0;
  }
}

test("pruefleiter-Hook blockiert bei Rot mit hoechstens 60 Zeilen und dem Reparatur-Satz", (context) => {
  const result = runStop(pruefleiterProbe(context), true);
  assert.equal(result.status, BLOCKING_EXIT_CODE);
  const shown = outputLines(result.stderr);
  assert.ok(shown.length <= MAX_PRUEFLEITER_LINES, `${shown.length} Zeilen`);
  assert.equal(shown.at(-1), REPAIR_SENTENCE);
  assert.equal(shown[0], "Befund 0");
});

test("pruefleiter-Hook laeuft bei gleichem Stand nicht erneut, bei geaendertem Stand schon", (context) => {
  const probe = pruefleiterProbe(context);
  assert.equal(runStop(probe).status, 0);
  assert.equal(runCount(probe), 1);

  assert.equal(runStop(probe).status, 0);
  assert.equal(runCount(probe), 1, "gleicher Stand: kein zweiter Lauf");

  appendFileSync(join(probe.directory, "src/basis.js"), "export const zwei = 2;\n");
  assert.equal(runStop(probe).status, 0);
  assert.equal(runCount(probe), SECOND_RUN, "geaenderte Datei: neuer Lauf");

  writeFileSync(join(probe.directory, "src/neu.js"), "export const drei = 3;\n");
  assert.equal(runStop(probe).status, 0);
  assert.equal(runCount(probe), THIRD_RUN, "neue ungetrackte Datei: neuer Lauf");
});

test("pruefleiter-Hook merkt sich ein Rot nicht als Gruen", (context) => {
  const probe = pruefleiterProbe(context);
  assert.equal(runStop(probe, true).status, BLOCKING_EXIT_CODE);
  assert.equal(runStop(probe, true).status, BLOCKING_EXIT_CODE);
  assert.equal(runCount(probe), SECOND_RUN);
});

function revision(directory, ref) {
  return runIn(directory, "git", ["rev-parse", ref]).stdout.trim();
}

function runSessionStart(directory) {
  return runHook("auto-sync-master.sh", {
    cwd: directory,
    input: {},
    environment: { CLAUDE_PROJECT_DIR: directory },
  });
}

test("SessionStart-Hook holt upstream und laesst Branch und Arbeitsverzeichnis unveraendert", (context) => {
  const upstream = probeRepository(context, { "a.txt": "1\n" });
  const clone = probeRepository(context, { "b.txt": "1\n" });
  runIn(clone, "git", ["remote", "add", "upstream", upstream]);
  const headBefore = revision(clone, "HEAD");
  const branch = runIn(upstream, "git", ["symbolic-ref", "--short", "HEAD"]).stdout.trim();

  assert.equal(runSessionStart(clone).status, 0);

  assert.equal(revision(clone, `upstream/${branch}`), revision(upstream, "HEAD"));
  assert.equal(revision(clone, "HEAD"), headBefore);
  assert.equal(runIn(clone, "git", ["status", "--porcelain"]).stdout, "");
});

test("SessionStart-Hook bleibt ohne upstream still und erfolgreich", (context) => {
  const directory = probeRepository(context, { "a.txt": "1\n" });
  const headBefore = revision(directory, "HEAD");
  const result = runSessionStart(directory);
  assert.equal(result.status, 0);
  assert.equal(revision(directory, "HEAD"), headBefore);
});
