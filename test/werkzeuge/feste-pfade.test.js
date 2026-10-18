import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BASE_FILES,
  EXIT_GREEN,
  MISSING,
  WORKFLOW,
  assertRed,
  eslintConfig,
  json,
  run,
  runInNewRepo,
} from "./feste-pfade-probe.js";
import { REPO_ROOT, commitAll, probeRepository, runIn } from "./probe-repo.js";

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
  ];
  for (const [files, expected] of cases) assertRed(runInNewRepo(context, files), expected);
});

test("feste-pfade: ein Manifest-Muster mit mehr als einem Sternchen wird mit Manifest gemeldet und verdeckt keinen anderen Befund", (context) => {
  const manifest = "test/werkzeuge/rotproben/probe/pruefung.json";
  assertRed(
    runInNewRepo(context, { [manifest]: json({ pfade: ["src/**/*.js", "tools/weg.mjs"] }) }),
    `${manifest} pfade: Das Muster src/**/*.js hat mehr als ein Sternchen`,
    `${manifest} pfade: tools/weg.mjs ${MISSING}`,
  );
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
        "tools/bereiche.json": json([
          { bereich: "probe", quellen: ["^test/a\\.(test|weg)\\.js$"] },
        ]),
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

test("feste-pfade: Listen im Code, Workflow-Pfade, Abnahmeliste und Hausregel-Dateien melden ihren fehlenden Eintrag", (context) => {
  const cases = [
    [
      { "tools/auftrag/agenten.mjs": 'export const KRITISCH_OHNE_GATE_TEST = ["src/weg/"];\n' },
      `tools/auftrag/agenten.mjs KRITISCH_OHNE_GATE_TEST: src/weg/ ${MISSING}`,
    ],
    [
      { "tools/auftrag/bereiche.mjs": 'export const GEMEINSAME_ORDNER = ["src/weg/"];\n' },
      `tools/auftrag/bereiche.mjs GEMEINSAME_ORDNER: src/weg/ ${MISSING}`,
    ],
    [
      {
        "tools/auftrag/lauf.mjs":
          'export const PIN_PRUEFUNG = "scripts/weg.js";\nexport const PIN_HAKEN = ".githooks/pre-commit";\n',
      },
      `tools/auftrag/lauf.mjs PIN_PRUEFUNG: scripts/weg.js ${MISSING}`,
    ],
    [
      {
        "tools/mutationspruefung/vorlage.mjs":
          'export const KETTENANFANG = "src/a.js";\nexport const SCHEMA = "src/weg.sql";\n',
      },
      `tools/mutationspruefung/vorlage.mjs SCHEMA: src/weg.sql ${MISSING}`,
    ],
    [
      { ".github/workflows/probe.yml": WORKFLOW.replace("src/**", "lib/**") },
      `.github/workflows/probe.yml on.push.paths: lib/** ${MISSING}`,
    ],
    [
      {
        ".github/workflows/probe.yml":
          "on:\n  push:\n    paths:\n    - lib/**\n    branches:\n    - main\njobs: {}\n",
      },
      `.github/workflows/probe.yml on.push.paths: lib/** ${MISSING}`,
    ],
    [
      { ".github/workflows/probe.yml": WORKFLOW.replace('"!src/a.js"', '"!src/weg.js"') },
      `.github/workflows/probe.yml on.push.paths: src/weg.js ${MISSING}`,
    ],
    [
      { "test/abnahme-ausgewandert.json": json([{ id: "A1", file: "test/weg.test.js" }]) },
      `test/abnahme-ausgewandert.json file: test/weg.test.js ${MISSING}`,
    ],
    [
      {
        "eslint.config.js": eslintConfig(["src/a.js"]).replace(
          "eslint-rules/tests.js",
          "eslint-rules/weg.js",
        ),
      },
      `eslint.config.js TESTREGELN_DATEI: tools/eslint-rules/weg.js ${MISSING}`,
    ],
  ];
  for (const [files, expected] of cases) assertRed(runInNewRepo(context, files), expected);
});

test("feste-pfade: eine Liste im Code ohne Export, unlesbare Workflow-Pfade und allowed-Regeln sind rot", (context) => {
  const cases = [
    [
      { "tools/auftrag/agenten.mjs": 'const KRITISCH_OHNE_GATE_TEST = ["src/a.js"];\n' },
      "tools/auftrag/agenten.mjs: KRITISCH_OHNE_GATE_TEST wird dort nicht exportiert",
    ],
    [
      {
        "eslint.config.js": eslintConfig(["src/a.js"]).replace(
          "export const HERMES",
          "const HERMES",
        ),
      },
      "eslint.config.js: HERMES_REGELN_DATEI wird dort nicht exportiert",
    ],
    [
      { ".github/workflows/probe.yml": "on:\n  push:\n    paths: [src/**]\njobs: {}\n" },
      ".github/workflows/probe.yml: on.push.paths lässt sich nicht als Liste je Zeile lesen",
    ],
    [
      { ".github/workflows/probe.yml": 'on: { push: { paths: ["src/**"] } }\njobs: {}\n' },
      ".github/workflows/probe.yml: on.paths lässt sich nicht als Liste je Zeile lesen",
    ],
    [
      { ".github/workflows/probe.yml": 'on:\n  push: { paths: ["src/**"] }\njobs: {}\n' },
      ".github/workflows/probe.yml: on.push.paths lässt sich nicht als Liste je Zeile lesen",
    ],
    [
      {
        ".dependency-cruiser.cjs":
          'module.exports = { allowed: [{ from: { path: "^src/" }, to: { path: "^src/" } }] };\n',
      },
      ".dependency-cruiser.cjs allowed: die Prüfung fester Pfade prüft allowed-Regeln nicht",
    ],
  ];
  for (const [files, expected] of cases) assertRed(runInNewRepo(context, files), expected);
});

test("feste-pfade: ein fehlender Workflow-Ordner und eine fehlende Liste im Code sind rot statt übersprungen", (context) => {
  const repo = probeRepository(context, BASE_FILES);
  runIn(repo, "git", ["rm", "-q", ".github/workflows/probe.yml", "tools/auftrag/bereiche.mjs"]);
  commitAll(repo, "Listen weg");
  assertRed(run(repo), ".github/workflows/ fehlt", "tools/auftrag/bereiche.mjs fehlt");
});
