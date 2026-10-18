import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeRepository, runIn } from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/feste-pfade.mjs");
const EXIT_GREEN = 0;
const EXIT_RED = 1;
const MISSING = "trifft keine versionierte Datei";

function json(value) {
  return `${JSON.stringify(value)}\n`;
}

function eslintConfig(files, options = []) {
  return `export default [{ ignores: ["coverage/**"] }, { name: "probe", files: ${JSON.stringify(files)}, rules: { "no-console": ["error", ...${JSON.stringify(options)}] } }];\n`;
}

const BASE_FILES = {
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
};

function run(repo) {
  const result = runIn(repo, process.execPath, [TOOL]);
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function runInNewRepo(context, files) {
  return run(probeRepository(context, { ...BASE_FILES, ...files }));
}

function assertRed(result, ...expected) {
  assert.equal(result.status, EXIT_RED, result.output);
  for (const text of expected) assert.ok(result.output.includes(text), result.output);
}

test("feste-pfade: der echte Stand endet grün", () => {
  const result = run(REPO_ROOT);
  assert.equal(result.status, EXIT_GREEN, result.output);
});

test("feste-pfade: eine Probe mit allen Listen und vorhandenen Pfaden endet grün und still", (context) => {
  const result = runInNewRepo(context, {});
  assert.equal(result.status, EXIT_GREEN, result.output);
  assert.equal(result.output, "");
});

test("feste-pfade: eine Umbenennung ohne Nachziehen der Gate-Liste ist rot und nennt Liste und Pfad", (context) => {
  const repo = probeRepository(context, BASE_FILES);
  runIn(repo, "git", ["mv", "src/a.js", "src/a.ts"]);
  commitAll(repo, "umbenannt");
  assertRed(run(repo), `tools/gate-tests.json Probe.module: src/a.js#eins ${MISSING}`);
});

test("feste-pfade: jede Liste meldet ihren fehlenden Eintrag", (context) => {
  const cases = [
    [
      {
        "tools/gate-tests.json": json({
          Probe: { module: ["src/a.js"], tests: ["test/weg.test.js"] },
        }),
      },
      `tools/gate-tests.json Probe.tests: test/weg.test.js ${MISSING}`,
    ],
    [
      { "tools/gate-tests.json": json({ Probe: { module: ["src/a.js#zwei"], tests: [] } }) },
      "src/a.js#zwei: zwei ist dort nicht deklariert",
    ],
    [
      {
        "tools/ziele/geschuetzt.json": json({
          gates: "tools/gate-tests.json",
          gruppe: ["src/weg/"],
        }),
      },
      `tools/ziele/geschuetzt.json gruppe: src/weg/ ${MISSING}`,
    ],
    [
      {
        "tools/auftrag/musterdateien.json": json({ bau: [{ praefix: "lib/", datei: "src/a.js" }] }),
      },
      `tools/auftrag/musterdateien.json bau: lib/ ${MISSING}`,
    ],
    [{ ".github/CODEOWNERS": "/docs/ @probe\n" }, `.github/CODEOWNERS /docs/: docs/** ${MISSING}`],
    [
      { ".claude/rollen/test.json": json({ permissions: { deny: ["Edit(src/weg/**)"] } }) },
      `.claude/rollen/test.json permissions: src/weg/** ${MISSING}`,
    ],
    [
      {
        ".claude/settings.json": json({
          hooks: { Stop: [{ hooks: [{ command: "node .claude/hooks/weg.mjs" }] }] },
        }),
      },
      `.claude/settings.json hooks: .claude/hooks/weg.mjs ${MISSING}`,
    ],
    [
      {
        ".claude/settings.json": json({
          hooks: { Stop: [{ hooks: [{ command: "node hooks/weg.mjs" }] }] },
        }),
      },
      `.claude/settings.json hooks: hooks/weg.mjs ${MISSING}`,
    ],
    [
      { "eslint.config.js": eslintConfig(["src/b.{js,ts}"]) },
      `eslint.config.js probe files: src/b.{js,ts} ${MISSING}`,
    ],
    [
      { "eslint.config.js": eslintConfig(["src/a.js"], [{ nurIn: ["src/weg.js"] }]) },
      `eslint.config.js probe rules: src/weg.js ${MISSING}`,
    ],
    [
      {
        ".dependency-cruiser.cjs":
          'module.exports = { required: [{ name: "pflicht", module: { path: "^src/server\\\\.js$" }, to: { path: "^src/" } }] };\n',
      },
      "pflicht module.path: ^src/server\\.js$ trifft keine versionierte Datei",
    ],
    [
      { "tools/bereiche.json": json([{ bereich: "probe", quellen: ["^src/(a|weg)\\.js$"] }]) },
      "die Alternative weg trifft keine versionierte Datei",
    ],
    [
      { "test/werkzeuge/rotproben/probe/pruefung.json": json({ pfade: ["tools/weg.mjs"] }) },
      `test/werkzeuge/rotproben/probe/pruefung.json pfade: tools/weg.mjs ${MISSING}`,
    ],
    [
      { "test/werkzeuge/rotproben/probe/pruefung.json": json({ pfade: ["src/a.{js,ts}"] }) },
      `test/werkzeuge/rotproben/probe/pruefung.json pfade: src/a.{js,ts} ${MISSING}`,
    ],
    [
      { "test/werkzeuge/rotproben/probe/pruefung.json": json({ pfade: ["src/**/*.js"] }) },
      "mehr als ein Sternchen",
    ],
  ];
  for (const [files, expected] of cases) assertRed(runInNewRepo(context, files), expected);
});

test("feste-pfade: jede Alternative eines Musters braucht ihre Datei, nur Endungs-Alternativen zählen zusammen", (context) => {
  assertRed(
    runInNewRepo(context, { "eslint.config.js": eslintConfig(["{src,lib}/a.js"]) }),
    `{src,lib}/a.js (Alternative lib/a.js) ${MISSING}`,
  );
  assertRed(
    runInNewRepo(context, {
      ".dependency-cruiser.cjs":
        'module.exports = { forbidden: [{ name: "probe", from: { path: "^(src|lib)/" } }] };\n',
    }),
    "die Alternative lib trifft keine versionierte Datei",
  );
});

const GLOB_FILES = {
  "src/deep/er/b.js": "export const tief = 1;\n",
  "src/a.b.js": "export const punkt = 1;\n",
  "src/abc.js": "export const lang = 1;\n",
  "src/(x)+.js": "export const klammer = 1;\n",
  "docs/x.md": "# x\n",
};

test("feste-pfade: Platzhalter in Mustern treffen genau die Dateien, die ESLint ihnen zuordnet", (context) => {
  const matching = [
    "src/*.js",
    "src/**/*.js",
    "src/**",
    "src/deep/**",
    "**/b.js",
    "src/?.js",
    "src/a?js",
    "src/a.{js,mjs}",
    "src/*/*/b.js",
    "src/(x)+.js",
    "docs/x.md",
  ];
  const result = runInNewRepo(context, {
    ...GLOB_FILES,
    "eslint.config.js": eslintConfig(matching),
  });
  assert.equal(result.status, EXIT_GREEN, result.output);
  assert.equal(result.output, "");
});

test("feste-pfade: ein Platzhalter überschreitet keine Ordnergrenze, ein Muster gilt für den ganzen Pfad und /** verlangt etwas darunter", (context) => {
  const missingPatterns = [
    "src/*/b.js",
    "src/de**/b.js",
    "**/c.js",
    "src/deep/*",
    "src/??.js",
    "src?a.js",
    "src/de/**",
    "src/a.js/**",
    "src/a.j",
    "rc/a.js",
    "docs/**/*.js",
    "src/a.{ts,mts}",
    "src/x.js",
  ];
  const result = runInNewRepo(context, {
    ...GLOB_FILES,
    "eslint.config.js": eslintConfig(missingPatterns),
  });
  assertRed(result, ...missingPatterns.map((pattern) => `${pattern} ${MISSING}`));
});

test("feste-pfade: ein Anker gilt als deklariert, wenn ihn function, class, const, let, var oder eine Export-Liste einführt", (context) => {
  const declared = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
  const undeclared = ["alph", "alphabet", "iota", "as", "eingerueckt", "aufgerufen", "kommentiert"];
  const source = [
    "export const alpha = 1;",
    "export async function beta() {}",
    "function* gamma() {}",
    "export class delta {}",
    "let epsilon;",
    "var zeta;",
    "export {",
    "  eta,",
    "  iota as theta,",
    "};",
    "  const eingerueckt = 1;",
    "aufrufen(aufgerufen);",
    "// const kommentiert = 1;",
    "",
  ].join("\n");
  const gates = (anchors) =>
    json({
      Probe: { module: anchors.map((anchor) => `src/a.js#${anchor}`), tests: ["test/a.test.js"] },
    });
  const green = runInNewRepo(context, {
    "src/a.js": source,
    "tools/gate-tests.json": gates(declared),
  });
  assert.equal(green.status, EXIT_GREEN, green.output);
  assertRed(
    runInNewRepo(context, { "src/a.js": source, "tools/gate-tests.json": gates(undeclared) }),
    ...undeclared.map((anchor) => `src/a.js#${anchor}: ${anchor} ist dort nicht deklariert`),
  );
});

test("feste-pfade: nur ein TypeScript-Muster unter einem geprüften Ordner darf ohne Datei sein, jedes andere Typmuster ist ohne Datei rot", (context) => {
  assertRed(
    runInNewRepo(context, { "eslint.config.js": eslintConfig(["src/**/*.mjs"]) }),
    `src/**/*.mjs ${MISSING}`,
  );
  assertRed(
    runInNewRepo(context, { "eslint.config.js": eslintConfig(["**/*.ts"]) }),
    `**/*.ts ${MISSING}`,
  );
  assertRed(
    runInNewRepo(context, { "eslint.config.js": eslintConfig(["lib/**/*.ts"]) }),
    `lib/**/*.ts ${MISSING}`,
  );
  for (const pattern of ["src/*.ts", "src/*.d.ts"]) {
    assertRed(
      runInNewRepo(context, { "eslint.config.js": eslintConfig([pattern]) }),
      `${pattern} ${MISSING}`,
    );
  }
});

test("feste-pfade: der Rückbau-Ordner gilt nur in CODEOWNERS und Rollen-Sperren als Vorab-Schutz", (context) => {
  assertRed(
    runInNewRepo(context, { "eslint.config.js": eslintConfig(["src/db/migrations/rueckbau/**"]) }),
    `src/db/migrations/rueckbau/** ${MISSING}`,
  );
  assertRed(
    runInNewRepo(context, {
      ".claude/settings.json": json({
        permissions: { allow: ["Edit(src/db/migrations/rueckbau/**)"] },
      }),
    }),
    `.claude/settings.json permissions: src/db/migrations/rueckbau/** ${MISSING}`,
  );
});

test("feste-pfade: Ausnahmen eines Blocks, nicht prüfbare Ausdrücke und Ordner statt Dateien sind rot", (context) => {
  const cases = [
    [
      {
        "eslint.config.js": `export default [{ files: ["src/**"], ignores: ["src/weg.js"], rules: { "no-console": "off" } }];\n`,
      },
      `ignores: src/weg.js ${MISSING}`,
    ],
    [
      { "tools/bereiche.json": json([{ bereich: "probe", quellen: ["^src/a\\.js$|^weg$"] }]) },
      "lässt sich nicht jede Alternative einzeln prüfen",
    ],
    [
      { "tools/bereiche.json": json([{ bereich: "probe", quellen: ["^src/(weg|tot)?a\\.js$"] }]) },
      "lässt sich nicht jede Alternative einzeln prüfen",
    ],
    [
      { "tools/bereiche.json": json([{ bereich: "probe", quellen: ["^src/(?!weg|tot)a\\.js$"] }]) },
      "lässt sich nicht jede Alternative einzeln prüfen",
    ],
    [
      {
        "tools/bereiche.json": json([{ bereich: "probe", quellen: ["^test/a\\.(test|weg)\\.js$"] }]),
      },
      "die Alternative weg trifft keine versionierte Datei",
    ],
    [
      { "tools/gate-tests.json": json({ Probe: { module: ["src/a.js"], tests: ["test/"] } }) },
      `Probe.tests: test/ ${MISSING}`,
    ],
    [
      { ".claude/rollen/bau.json": json({ permissions: { deny: ["Edit(weg.json)"] } }) },
      `permissions: **/weg.json ${MISSING}`,
    ],
    [
      {
        ".claude/settings.json": json({
          hooks: { Stop: [{ hooks: [{ command: "node ./.claude/hooks/weg.mjs" }] }] },
        }),
      },
      `hooks: .claude/hooks/weg.mjs ${MISSING}`,
    ],
  ];
  for (const [files, expected] of cases) assertRed(runInNewRepo(context, files), expected);
});

test("feste-pfade: eine fehlende Liste ist rot statt übersprungen", (context) => {
  const repo = probeRepository(context, BASE_FILES);
  runIn(repo, "git", ["rm", "-q", "tools/ziele/geschuetzt.json"]);
  commitAll(repo, "Liste weg");
  assertRed(run(repo), "tools/ziele/geschuetzt.json fehlt");
});
