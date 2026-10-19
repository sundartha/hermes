import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BACK,
  BASE_FILES,
  EXIT_GREEN,
  LOST,
  MANIFEST_BOTH,
  MISSING,
  MOVED,
  RENAMED_FILES,
  WORKFLOW,
  assertRed,
  eslintBlocks,
  json,
  renamedRepo,
  run,
  runRenamed,
} from "./feste-pfade-probe.js";
import { commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

test("feste-pfade: mit --basis endet eine Umbenennung mit nachgezogenen Listen grün, ohne Nachziehen ist sie rot", (context) => {
  const green = runRenamed(context, MANIFEST_BOTH);
  assert.equal(green.status, EXIT_GREEN, green.output);
  assertRed(
    runRenamed(context, {}),
    `${BACK}: test/werkzeuge/rotproben/probe/pruefung.json pfade trifft src/b.js, ${LOST} src/b.ts`,
  );
  const unchanged = run(probeRepository(context, BASE_FILES), "--basis", "HEAD");
  assert.equal(unchanged.status, EXIT_GREEN, unchanged.output);
  assert.equal(unchanged.output, "");
});

test("feste-pfade: eine von mehreren Dateien eines Musters umbenannt verliert je Quelle ihren Schutz und ist rot", (context) => {
  const renamed = [
    [
      {
        "eslint.config.js": eslintBlocks(
          'export default [{ name: "probe", files: ["src/*.js"], rules: { "no-console": "error" } }];',
        ),
      },
      `${BACK}: eslint.config.js Regel no-console gilt für src/b.js, für src/b.ts nicht`,
    ],
    [
      { ".github/CODEOWNERS": "/tools/ @probe\n/src/*.js @wache\n" },
      `${BACK}: .github/CODEOWNERS Besitzer @wache trifft src/b.js, ${LOST} src/b.ts`,
    ],
    [
      { ".claude/rollen/test.json": json({ permissions: { deny: ["Edit(src/*.js)"] } }) },
      `${BACK}: .claude/rollen/test.json deny Edit trifft src/b.js, ${LOST} src/b.ts`,
    ],
    [
      { ".claude/settings.json": json({ permissions: { allow: ["Write(src/*.ts)"] } }) },
      `${BACK}: .claude/settings.json allow Write trifft src/b.ts, ${LOST} src/b.js`,
    ],
    [
      { "tools/bereiche.json": json([{ bereich: "probe", quellen: ["^src/[ab]\\.js$"] }]) },
      `${BACK}: tools/bereiche.json probe.quellen trifft src/b.js, ${LOST} src/b.ts`,
    ],
    [
      {
        ".dependency-cruiser.cjs":
          'module.exports = { forbidden: [{ name: "probe", from: { path: "^src/[ab]\\\\.js$" }, to: { path: "^src/" } }] };\n',
      },
      `${BACK}: .dependency-cruiser.cjs probe from trifft src/b.js, ${LOST} src/b.ts`,
    ],
    [
      { ".github/workflows/probe.yml": WORKFLOW.replace("src/**", "src/*.js") },
      `${BACK}: .github/workflows/probe.yml on.push.paths trifft src/b.js, ${LOST} src/b.ts`,
    ],
  ];
  for (const [files, expected] of renamed) assertRed(runRenamed(context, files), expected);
});

test("feste-pfade: eine Verschiebung aus einem Präfix verliert je Präfix-Liste ihren Schutz und ist rot", (context) => {
  const moved = [
    [
      {
        "tools/ziele/geschuetzt.json": json({
          gates: "tools/gate-tests.json",
          gruppe: ["src/a.js", "src/geheim/"],
        }),
      },
      `${MOVED}: tools/ziele/geschuetzt.json gruppe trifft src/geheim/d.js, ${LOST} src/d.js`,
    ],
    [
      {
        "tools/auftrag/musterdateien.json": json({
          bau: [{ art: "Geheim", praefix: "src/geheim/", datei: "src/geheim/c.js" }],
        }),
      },
      `${MOVED}: tools/auftrag/musterdateien.json bau Geheim trifft src/geheim/d.js, ${LOST} src/d.js`,
    ],
    [
      { "tools/auftrag/agenten.mjs": 'export const KRITISCH_OHNE_GATE_TEST = ["src/geheim/"];\n' },
      `${MOVED}: tools/auftrag/agenten.mjs KRITISCH_OHNE_GATE_TEST trifft src/geheim/d.js, ${LOST} src/d.js`,
    ],
    [
      { "tools/auftrag/bereiche.mjs": 'export const GEMEINSAME_ORDNER = ["src/geheim/"];\n' },
      `${MOVED}: tools/auftrag/bereiche.mjs GEMEINSAME_ORDNER trifft src/geheim/d.js, ${LOST} src/d.js`,
    ],
  ];
  for (const [files, expected] of moved)
    assertRed(runRenamed(context, files, { renames: [["src/geheim/d.js", "src/d.js"]] }), expected);
});

test("feste-pfade: Regeln, die der Compiler oder eine Erweiterungsregel übernimmt, bleiben gleichwertig, eine schwächere Erweiterung nicht", (context) => {
  const unusedOptions = JSON.stringify({
    vars: "all",
    args: "after-used",
    ignoreRestSiblings: false,
    caughtErrors: "all",
    ignoreClassWithStaticInitBlock: false,
    ignoreUsingDeclarations: false,
    reportUsedIgnorePattern: false,
  });
  const config = (extension) =>
    eslintBlocks(
      [
        'import tseslint from "typescript-eslint";',
        "export default [",
        '  { name: "js", files: ["src/*.js"], rules: { "no-dupe-keys": "error", "no-unused-vars": "error" } },',
        `  { name: "ts", files: ["src/*.ts"], plugins: { "@typescript-eslint": tseslint.plugin }, rules: { "@typescript-eslint/no-unused-vars": ${extension} } },`,
        "];",
      ].join("\n"),
    );
  const green = runRenamed(context, {
    ...MANIFEST_BOTH,
    "eslint.config.js": config(`["error", ${unusedOptions}]`),
  });
  assert.equal(green.status, EXIT_GREEN, green.output);
  for (const extension of [`["warn", ${unusedOptions}]`, '"error"'])
    assertRed(
      runRenamed(context, { ...MANIFEST_BOTH, "eslint.config.js": config(extension) }),
      `${BACK}: eslint.config.js Regel no-unused-vars gilt für src/b.js`,
    );
});

test("feste-pfade: ein ungültiges --basis, eine im Basis-Stand fehlende Liste und eine Liste ohne Export sind rot", (context) => {
  assertRed(
    run(probeRepository(context, BASE_FILES), "--basis", "gibt-es-nicht"),
    '--basis "gibt-es-nicht" ist kein lesbarer Commit',
  );
  const workflow = ".github/workflows/probe.yml";
  const repo = probeRepository(context, { ...BASE_FILES, ...RENAMED_FILES });
  runIn(repo, "git", ["rm", "-q", workflow]);
  commitAll(repo, "ohne Workflow");
  writeFiles(repo, { [workflow]: WORKFLOW, ...MANIFEST_BOTH });
  runIn(repo, "git", ["mv", "src/b.js", "src/b.ts"]);
  commitAll(repo, "umbenannt");
  assertRed(
    run(repo, "--basis", "HEAD~1"),
    "Basis-Stand: .github/workflows/ fehlt; ohne die Liste",
  );
  assertRed(
    runRenamed(
      context,
      {
        ...MANIFEST_BOTH,
        "tools/auftrag/agenten.mjs": 'const KRITISCH_OHNE_GATE_TEST = ["src/"];\n',
      },
      { after: { "tools/auftrag/agenten.mjs": BASE_FILES["tools/auftrag/agenten.mjs"] } },
    ),
    "Basis-Stand: tools/auftrag/agenten.mjs: KRITISCH_OHNE_GATE_TEST wird dort nicht exportiert",
  );
});

function pathRuleConfig(nurIn) {
  return eslintBlocks(
    [
      "const probe = { rules: { pfad: { meta: { schema: false }, create: () => ({}) } } };",
      `export default [{ name: "probe", files: ["src/**/*.{js,ts}"], plugins: { probe }, rules: { "probe/pfad": ["error", { nurIn: ${JSON.stringify(nurIn)} }] } }];`,
    ].join("\n"),
  );
}

test("feste-pfade: ein Pfad in einer Regeloption, der mit der Umbenennung nachgezogen ist, gilt als gleich und reißt keine andere Umbenennung mit", (context) => {
  const renames = [
    ["src/b.js", "src/b.ts"],
    ["src/geheim/c.js", "src/geheim/c.ts"],
  ];
  const files = { ...MANIFEST_BOTH, "eslint.config.js": pathRuleConfig(["src/b.js"]) };
  const after = { "eslint.config.js": pathRuleConfig(["src/b.ts"]) };
  const green = runRenamed(context, files, { renames, after });
  assert.equal(green.status, EXIT_GREEN, green.output);
  assertRed(runRenamed(context, files, { renames }), `probe rules: src/b.js ${MISSING}`);
  assertRed(
    runRenamed(context, files, {
      renames,
      after: { "eslint.config.js": pathRuleConfig(["src/a.js"]) },
    }),
    `${BACK}: eslint.config.js Regel probe/pfad gilt für src/b.js`,
  );
});

test("feste-pfade: eine Verschiebung mit ergänzten Typen und ein Wechsel nach .mts bekommen über den Dateistamm ein Paar, mehrere Kandidaten werden alle verglichen", (context) => {
  const typed = "export const vier: number = 4;\n";
  const group = {
    "tools/ziele/geschuetzt.json": json({
      gates: "tools/gate-tests.json",
      gruppe: ["src/a.js", "src/geheim/"],
    }),
  };
  assertRed(
    runRenamed(context, group, {
      renames: [["src/geheim/d.js", "src/d.ts"]],
      after: { "src/d.ts": typed },
    }),
    `src/geheim/d.js → src/d.ts: tools/ziele/geschuetzt.json gruppe trifft src/geheim/d.js, ${LOST} src/d.ts`,
  );
  const area = {
    "tools/bereiche.json": json([{ bereich: "probe", quellen: ["^src/geheim/[cd]\\.js$"] }]),
  };
  assertRed(
    runRenamed(context, area, {
      renames: [["src/geheim/d.js", "src/geheim/d.mts"]],
      after: { "src/geheim/d.mts": typed },
    }),
    `src/geheim/d.js → src/geheim/d.mts: tools/bereiche.json probe.quellen trifft src/geheim/d.js, ${LOST} src/geheim/d.mts`,
  );
  assertRed(
    runRenamed(context, group, {
      renames: [["src/geheim/d.js", "src/geheim/d.ts"]],
      after: { "src/geheim/d.ts": typed, "src/d.ts": typed },
    }),
    `src/geheim/d.js → src/d.ts: tools/ziele/geschuetzt.json gruppe trifft src/geheim/d.js, ${LOST} src/d.ts`,
  );
});

test("feste-pfade: als vom Compiler geprüft gilt nur eine TypeScript-Datei unter einem geprüften Ordner, keine Deklarationsdatei", (context) => {
  const config = eslintBlocks(
    [
      "export default [",
      '  { name: "js", files: ["src/*.js", "lib/*.js"], rules: { "no-dupe-keys": "error" } },',
      '  { name: "ts", files: ["src/*.ts"], rules: {} },',
      "];",
    ].join("\n"),
  );
  const files = {
    ...MANIFEST_BOTH,
    "eslint.config.js": config,
    "lib/x.js": "export const x = 1;\n",
  };
  const green = runRenamed(context, files);
  assert.equal(green.status, EXIT_GREEN, green.output);
  for (const [from, to] of [
    ["src/b.js", "src/b.d.ts"],
    ["lib/x.js", "lib/x.ts"],
  ])
    assertRed(
      runRenamed(context, files, { renames: [[from, to]] }),
      `${from} → ${to}: eslint.config.js Regel no-dupe-keys gilt für ${from}`,
    );
});
test("feste-pfade: auch eine Deklarationsdatei mit Zwischenendung oder großem D gilt nicht als vom Compiler geprüft", (context) => {
  const config = eslintBlocks(
    [
      "export default [",
      '  { name: "js", files: ["src/*.js"], rules: { "no-dupe-keys": "error" } },',
      '  { name: "ts", files: ["src/*.ts"], rules: {} },',
      "];",
    ].join("\n"),
  );
  const files = { ...MANIFEST_BOTH, "eslint.config.js": config };
  for (const to of ["src/b.d.css.ts", "src/b.d.x.y.ts", "src/b.D.ts"])
    assertRed(
      runRenamed(context, files, { renames: [["src/b.js", to]] }),
      `src/b.js → ${to}: eslint.config.js Regel no-dupe-keys gilt für src/b.js`,
    );
});

test("feste-pfade: mit --nur-neue bleibt ein schon im Basis-Stand vorhandener Befund still, jeder neue Befund und jeder Schutzverlust ist rot", (context) => {
  const stale = {
    "tools/gate-tests.json": json({ Probe: { module: ["src/a.js"], tests: ["test/weg.test.js"] } }),
  };
  const known = probeRepository(context, { ...BASE_FILES, ...stale });
  assertRed(run(known, "--basis", "HEAD"), `test/weg.test.js ${MISSING}`);
  const quiet = run(known, "--basis", "HEAD", "--nur-neue");
  assert.equal(quiet.status, EXIT_GREEN, quiet.output);
  const repo = probeRepository(context, BASE_FILES);
  writeFiles(repo, stale);
  commitAll(repo, "Gate-Test ins Leere");
  assertRed(run(repo, "--basis", "HEAD~1", "--nur-neue"), `test/weg.test.js ${MISSING}`);
  assertRed(
    run(
      renamedRepo(context, { files: {}, renames: [["src/b.js", "src/b.ts"]] }),
      "--basis",
      "HEAD~1",
      "--nur-neue",
    ),
    `${BACK}: test/werkzeuge/rotproben/probe/pruefung.json pfade trifft src/b.js, ${LOST} src/b.ts`,
  );
  const bare = probeRepository(context, {
    "package.json": json({ type: "module" }),
    "src/b.js": "export const zwei = 2;\n",
  });
  runIn(bare, "git", ["mv", "src/b.js", "src/b.ts"]);
  commitAll(bare, "umbenannt");
  assertRed(
    run(bare, "--basis", "HEAD~1", "--nur-neue"),
    "Basis-Stand: eslint.config.js fehlt; ohne die Liste",
  );
  assertRed(run(bare, "--nur-neue"), "--nur-neue braucht --basis");
});

function cruiserOptions(options) {
  return {
    ".dependency-cruiser.cjs": `module.exports = { options: ${JSON.stringify(options)} };\n`,
  };
}

test("feste-pfade: ein includeOnly, das die umbenannte Datei nicht mehr erfasst, und ein exclude, das sie neu ausnimmt, sind rot", (context) => {
  const options = `${BACK}: .dependency-cruiser.cjs options`;
  const included = `${options}.includeOnly trifft src/b.js, ${LOST} src/b.ts`;
  const excluded = `${options}.exclude trifft src/b.ts, ${LOST} src/b.js`;
  const narrowed = [
    [{ includeOnly: { path: "^src/.*\\.js$" } }, included],
    [{ includeOnly: "^src/.*\\.js$" }, included],
    [{ exclude: { path: "^src/.*\\.ts$" } }, excluded],
    [{ exclude: "^src/.*\\.ts$" }, excluded],
  ];
  for (const [config, expected] of narrowed)
    assertRed(runRenamed(context, cruiserOptions(config)), expected);
  for (const config of [{ includeOnly: "^src/" }, { exclude: { path: "^src/" } }]) {
    const green = runRenamed(context, { ...MANIFEST_BOTH, ...cruiserOptions(config) });
    assert.equal(green.status, EXIT_GREEN, green.output);
  }
});

test("feste-pfade: ein Rückverweis in einem Pfad der Abhängigkeitsprüfung lässt sich je Datei nicht prüfen und ist rot", (context) => {
  const config = [
    "module.exports = { forbidden: [",
    '  { name: "eins", from: { path: "^src/(.+)/" }, to: { path: "^lib/$1/" } },',
    '  { name: "zwei", from: { pathNot: "^(src)/$1$" }, to: {} },',
    "] };",
  ].join("\n");
  assertRed(
    runRenamed(context, { ".dependency-cruiser.cjs": `${config}\n` }),
    ".dependency-cruiser.cjs eins to: ein Rückverweis ($1) lässt sich je Datei nicht prüfen",
    ".dependency-cruiser.cjs zwei from: ein Rückverweis ($1) lässt sich je Datei nicht prüfen",
  );
});

test("feste-pfade: ein paths-ignore, das die umbenannte Datei neu ausnimmt, ist rot", (context) => {
  const ignoring = (pattern) => ({
    ".github/workflows/probe.yml": `on:\n  push:\n    paths-ignore:\n      - ${pattern}\njobs: {}\n`,
  });
  assertRed(
    runRenamed(context, ignoring("src/*.ts")),
    `${BACK}: .github/workflows/probe.yml on.push.paths-ignore trifft src/b.ts, ${LOST} src/b.js`,
  );
  const green = runRenamed(context, { ...MANIFEST_BOTH, ...ignoring("src/**") });
  assert.equal(green.status, EXIT_GREEN, green.output);
});

test("feste-pfade: eine ask-Sperre, die die umbenannte Datei nicht mehr trifft, ist rot", (context) => {
  const asking = (tool, pattern) => json({ permissions: { ask: [`${tool}(${pattern})`] } });
  assertRed(
    runRenamed(context, { ".claude/rollen/test.json": asking("Edit", "src/*.js") }),
    `${BACK}: .claude/rollen/test.json ask Edit trifft src/b.js, ${LOST} src/b.ts`,
  );
  assertRed(
    runRenamed(context, { ".claude/settings.json": asking("Write", "src/*.js") }),
    `${BACK}: .claude/settings.json ask Write trifft src/b.js, ${LOST} src/b.ts`,
  );
  const green = runRenamed(context, {
    ...MANIFEST_BOTH,
    ".claude/rollen/test.json": asking("Edit", "src/**"),
  });
  assert.equal(green.status, EXIT_GREEN, green.output);
});
