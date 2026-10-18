import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/feste-pfade.mjs");
export const EXIT_GREEN = 0;
const EXIT_RED = 1;
export const MISSING = "trifft keine versionierte Datei";

export function json(value) {
  return `${JSON.stringify(value)}\n`;
}

const RULE_FILES = [
  'export const HERMES_REGELN_DATEI = new URL("./tools/eslint-rules/index.js", import.meta.url);',
  'export const TESTREGELN_DATEI = new URL("./tools/eslint-rules/tests.js", import.meta.url);',
].join("\n");

export function eslintConfig(files, options = []) {
  return `export default [{ ignores: ["coverage/**"] }, { name: "probe", files: ${JSON.stringify(files)}, rules: { "no-console": ["error", ...${JSON.stringify(options)}] } }];\n${RULE_FILES}\n`;
}

export const WORKFLOW = 'on:\n  push:\n    paths:\n      - src/**\n      - "!src/a.js"\njobs: {}\n';

export const BASE_FILES = {
  "package.json": json({ type: "module" }),
  "src/a.js": "export const eins = 1;\n",
  "test/a.test.js": "export const probe = 1;\n",
  ".claude/hooks/h.mjs": "export const haken = 1;\n",
  "tools/gate-tests.json": json({
    Probe: { module: ["src/a.js#eins"], tests: ["test/a.test.js"] },
  }),
  "tools/ziele/geschuetzt.json": json({
    gates: "tools/gate-tests.json",
    gruppe: ["src/a.js", "src/"],
  }),
  "tools/auftrag/musterdateien.json": json({
    regel: "Muster",
    bau: [{ art: "Modul", praefix: "src/", datei: "src/a.js" }],
  }),
  ".github/CODEOWNERS": "/tools/ @probe\n/src/db/migrations/rueckbau/ @probe\n",
  ".claude/rollen/bau.json": json({
    permissions: { deny: ["Edit(tools/**)", "Read(data/**)", "Read(.env*)"] },
    hooks: {
      PreToolUse: [
        {
          hooks: [
            { type: "command", command: 'node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/h.mjs"' },
          ],
        },
      ],
    },
  }),
  ".claude/settings.json": json({ permissions: { allow: ["Bash(node:*)"] } }),
  "eslint.config.js": eslintConfig(
    ["src/a.{js,ts}", "{src,test}/**/*.{ts,mts}"],
    [{ nurIn: ["src/a.js"] }],
  ),
  ".dependency-cruiser.cjs": `module.exports = { forbidden: [{ name: "probe", from: { path: "^src/", pathNot: "^src/weg\\\\.js$" }, to: { path: "^(src|test)/" } }], required: [{ name: "pflicht", module: { path: "^src/a\\\\.js$" }, to: { path: "^src/" } }] };\n`,
  "tools/bereiche.json": json([
    { bereich: "probe", quellen: ["^src/a\\.(js|ts)$"], eingaenge: [] },
  ]),
  "test/werkzeuge/rotproben/probe/pruefung.json": json({
    pfade: ["tools/", "src/*.js"],
    probe: { mitnehmen: ["tools/gate-tests.json"] },
  }),
  "tools/eslint-rules/index.js": "export default {};\n",
  "tools/eslint-rules/tests.js": "export default {};\n",
  "tools/auftrag/agenten.mjs": 'export const KRITISCH_OHNE_GATE_TEST = ["src/a.js", "src/"];\n',
  "tools/auftrag/bereiche.mjs": 'export const GEMEINSAME_ORDNER = ["src/"];\n',
  "tools/auftrag/lauf.mjs":
    'export const PIN_PRUEFUNG = "scripts/pin.js";\nexport const PIN_HAKEN = ".githooks/pre-commit";\n',
  "scripts/pin.js": "export const pin = 1;\n",
  ".githooks/pre-commit": "#!/bin/sh\n",
  "tools/mutationspruefung/vorlage.mjs":
    'export const KETTENANFANG = "src/a.js";\nexport const SCHEMA = "src/schema.sql";\n',
  "src/schema.sql": "select 1;\n",
  ".github/workflows/probe.yml": WORKFLOW,
  "test/abnahme-ausgewandert.json": json([{ id: "A1", file: "test/a.test.js" }]),
};

export function run(repo, ...args) {
  const result = runIn(repo, process.execPath, [TOOL, ...args]);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

export function runInNewRepo(context, files) {
  return run(probeRepository(context, { ...BASE_FILES, ...files }));
}

export function assertRed(result, ...expected) {
  assert.equal(result.status, EXIT_RED, result.output);
  for (const text of expected) assert.ok(result.output.includes(text), result.output);
}

export const LOST = "aber nicht";
export const BACK = "src/b.js → src/b.ts";
export const MOVED = "src/geheim/d.js → src/d.js";

export const RENAMED_FILES = {
  ".gitignore": "node_modules\n",
  "src/b.js": "export const zwei = 2;\n",
  "src/geheim/c.js": "export const drei = 3;\n",
  "src/geheim/d.js": "export const vier = 4;\n",
  "eslint.config.js": eslintConfig(["src/a.{js,ts}", "{src,test}/**/*.{ts,mts}"]),
};

export function renamedRepo(context, { files, renames, after = {} }) {
  const repo = probeRepository(context, { ...BASE_FILES, ...RENAMED_FILES, ...files });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(repo, "node_modules"));
  for (const [from, to] of renames) runIn(repo, "git", ["mv", from, to]);
  writeFiles(repo, after);
  commitAll(repo, "umbenannt");
  return repo;
}

export function runRenamed(context, files, { renames = [["src/b.js", "src/b.ts"]], after } = {}) {
  return run(renamedRepo(context, { files, renames, after }), "--basis", "HEAD~1");
}

export const MANIFEST_BOTH = {
  "test/werkzeuge/rotproben/probe/pruefung.json": json({
    pfade: ["tools/", "src/*.js", "src/*.ts"],
    probe: { mitnehmen: ["tools/gate-tests.json"] },
  }),
};

export function eslintBlocks(blocks) {
  return `${blocks}\n${RULE_FILES}\n`;
}
