import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { isolatedEnvironment, probeRepository, REPO_ROOT, writeFiles } from "./probe-repo.js";

const SCRIPT = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const CREATE = "--basis-anlegen";
const ROOT_RULES = "# Hermes\n\nErste Regel.\nZweite Regel.\n";
const FOLDER_RULES = "Regel nur für billing.\n";
const INSTRUCTIONS = {
  "CLAUDE.md": ROOT_RULES,
  "src/billing/CLAUDE.md": FOLDER_RULES,
  "src/billing/geld.js": "export const geld = 1;\n",
  "README.md": "# Liesmich\n",
  "package.json": "{}\n",
  "tools/werkzeug.mjs": "export const werkzeug = 1;\n",
};

function run(directory, args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: isolatedEnvironment(),
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function expectRun(directory, args, { status, shows }) {
  const result = run(directory, args);
  assert.equal(result.status, status, result.output);
  if (shows !== undefined) assert.ok(result.output.includes(shows), result.output);
}

function probe(context, files, tool) {
  const directory = probeRepository(context, files);
  expectRun(directory, [tool, CREATE], { status: EXIT_OK });
  return directory;
}

test("anweisungen: ein Stand ohne neue Zeile ist grün", (context) => {
  const directory = probe(context, INSTRUCTIONS, "anweisungen");
  expectRun(directory, ["anweisungen"], { status: EXIT_OK, shows: "0 neue Befunde" });
});

test("anweisungen: eine neue Zeile in CLAUDE.md ist rot", (context) => {
  const directory = probe(context, INSTRUCTIONS, "anweisungen");
  writeFiles(directory, { "CLAUDE.md": `${ROOT_RULES}Dritte Regel.\n` });
  expectRun(directory, ["anweisungen"], { status: EXIT_FINDING, shows: "CLAUDE.md:5" });
});

test("anweisungen: eine umformulierte Zeile in einer Fachordner-CLAUDE.md ist rot", (context) => {
  const directory = probe(context, INSTRUCTIONS, "anweisungen");
  writeFiles(directory, { "src/billing/CLAUDE.md": "Regel nur für den Ordner billing.\n" });
  expectRun(directory, ["anweisungen"], { status: EXIT_FINDING, shows: "src/billing/CLAUDE.md:1" });
});

test("anweisungen: eine gestrichene Zeile ist grün", (context) => {
  const directory = probe(context, INSTRUCTIONS, "anweisungen");
  writeFiles(directory, { "CLAUDE.md": "# Hermes\n\nZweite Regel.\n" });
  expectRun(directory, ["anweisungen"], { status: EXIT_OK, shows: "--basis-kuerzen" });
});

test("anweisungen: neue Dateien unter .claude/rules/ und AGENTS.md sind rot, auch ohne git add", (context) => {
  const directory = probe(context, INSTRUCTIONS, "anweisungen");
  writeFiles(directory, { ".claude/rules/neu.md": "Neue Regel.\n", "AGENTS.md": "Andere Regel.\n" });
  const result = run(directory, ["anweisungen"]);
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /\.claude\/rules\/neu\.md:1/);
  assert.match(result.output, /AGENTS\.md:1/);
});

test("anweisungen: eine neue Regeldatei in einem verschachtelten .claude/rules/ ist rot", (context) => {
  const directory = probe(context, INSTRUCTIONS, "anweisungen");
  writeFiles(directory, { "src/x/.claude/rules/a.md": "Regel nur für x.\n" });
  expectRun(directory, ["anweisungen"], { status: EXIT_FINDING, shows: "src/x/.claude/rules/a.md:1" });
});

test("anweisungen: Markdown außerhalb von .claude/rules/ ist keine Anweisungsdatei", (context) => {
  const directory = probe(context, INSTRUCTIONS, "anweisungen");
  writeFiles(directory, { "docs/rules/a.md": "Notiz.\n", "docs/claude/rules.md": "Notiz.\n" });
  expectRun(directory, ["anweisungen"], { status: EXIT_OK });
});

test("anweisungen: ein @-Import ist rot, auch wenn er beim Anlegen der Basislinie schon da war", (context) => {
  const files = { ...INSTRUCTIONS, "CLAUDE.md": `${ROOT_RULES}@docs/RUNBOOK.md\n` };
  const directory = probe(context, files, "anweisungen");
  expectRun(directory, ["anweisungen"], { status: EXIT_FINDING, shows: "CLAUDE.md:5 @-Import" });
});

test("anweisungen: ein @ in einer Code-Spanne oder einer Mailadresse ist kein Import", (context) => {
  const files = { ...INSTRUCTIONS, "CLAUDE.md": `${ROOT_RULES}Paket \`@scope/name\`, Mail a@b.example.\n` };
  const directory = probe(context, files, "anweisungen");
  expectRun(directory, ["anweisungen"], { status: EXIT_OK });
});

test("anweisungen: dieselbe Zeile in zwei Anweisungsdateien ist rot, auch wenn sie schon eingefroren war", (context) => {
  const files = { ...INSTRUCTIONS, "src/billing/CLAUDE.md": `${FOLDER_RULES}Zweite Regel.\n` };
  const directory = probe(context, files, "anweisungen");
  expectRun(directory, ["anweisungen"], {
    status: EXIT_FINDING,
    shows: "src/billing/CLAUDE.md:2 doppelt, steht schon in CLAUDE.md:4",
  });
});

test("anweisungen: gleiche Überschriften und Code-Zäune in zwei Dateien sind nicht doppelt", (context) => {
  const fence = "```\nnpm test\n```\n";
  const files = {
    ...INSTRUCTIONS,
    "CLAUDE.md": `${ROOT_RULES}${fence}`,
    "src/billing/CLAUDE.md": `# Hermes\n${FOLDER_RULES}\`\`\`\nnpm run lint\n\`\`\`\n`,
  };
  const directory = probe(context, files, "anweisungen");
  expectRun(directory, ["anweisungen"], { status: EXIT_OK });
});

test("anweisungen: ein neuer Fachordner ohne CLAUDE.md ist rot, ein eingefrorener grün", (context) => {
  const files = { ...INSTRUCTIONS, "src/alt/a.js": "export const a = 1;\n" };
  const directory = probe(context, files, "anweisungen");
  expectRun(directory, ["anweisungen"], { status: EXIT_OK });
  writeFiles(directory, { "src/neu/x.js": "export const x = 1;\n" });
  expectRun(directory, ["anweisungen"], { status: EXIT_FINDING, shows: "src/neu hat keine CLAUDE.md" });
});

test("anweisungen: eine gelöschte Fachordner-CLAUDE.md ist rot", (context) => {
  const directory = probe(context, INSTRUCTIONS, "anweisungen");
  rmSync(join(directory, "src/billing/CLAUDE.md"));
  expectRun(directory, ["anweisungen"], { status: EXIT_FINDING, shows: "src/billing hat keine CLAUDE.md" });
});

test("wurzel: ein Stand ohne neuen Eintrag ist grün, ein gelöschter auch", (context) => {
  const directory = probe(context, INSTRUCTIONS, "wurzel");
  expectRun(directory, ["wurzel"], { status: EXIT_OK, shows: "0 neue Befunde" });
  rmSync(join(directory, "package.json"));
  expectRun(directory, ["wurzel"], { status: EXIT_OK, shows: "--basis-kuerzen" });
});

test("wurzel: ein neuer Eintrag im Wurzelordner ist rot", (context) => {
  const directory = probe(context, INSTRUCTIONS, "wurzel");
  writeFiles(directory, { "neu.json": "{}\n" });
  expectRun(directory, ["wurzel"], { status: EXIT_FINDING, shows: "neu.json" });
});

test("wurzel: Markdown außer README.md und CLAUDE.md ist rot, auch wenn es beim Anlegen schon da war", (context) => {
  const directory = probe(context, { ...INSTRUCTIONS, "PLAN-ALT.md": "# Plan\n" }, "wurzel");
  writeFiles(directory, { "PLAN-NEU.md": "# Plan\n" });
  const result = run(directory, ["wurzel"]);
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, /PLAN-ALT\.md gehört nicht in den Wurzelordner/);
  assert.match(result.output, /PLAN-NEU\.md gehört nicht in den Wurzelordner/);
});

test("wurzel: ein Ordner tasks ist rot", (context) => {
  const directory = probe(context, INSTRUCTIONS, "wurzel");
  writeFiles(directory, { "tasks/x.md": "# Aufgabe\n" });
  expectRun(directory, ["wurzel"], { status: EXIT_FINDING, shows: "tasks gehört nicht in den Wurzelordner" });
});
