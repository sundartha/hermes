import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { fakeGitHub } from "../../tools/pruefungen-messen.mjs";
import {
  REPO_ROOT,
  commitAll,
  isolatedEnvironment,
  probeRepository,
  runIn,
  writeFiles,
} from "./probe-repo.js";

const TOOL = join(REPO_ROOT, "tools/tests-nur-ergaenzt.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const PULL_REQUEST = "7";
const RECHNER = "src/rechner.js";
const ZUSATZ = "src/zusatz.js";
const GATE_FILE = "test/gate-text.test.js";
const ASSERT_IMPORT = 'import assert from "node:assert/strict";';
const READ_IMPORT = 'import { readFileSync } from "node:fs";';
const TEST_IMPORT = 'import { test } from "node:test";';
const SUMME_IMPORT = 'import { summe } from "../src/rechner.js";';
const RECHNER_TEXT =
  'const quelltext = readFileSync(new URL("../src/rechner.js", import.meta.url), "utf8");';
const NO_APPROVAL = /ohne Freigabe/;
const WHOLE_FILE_DELETED = "die ganze Testdatei ist gelöscht; das ist immer gesperrt.";

const execFileAsync = promisify(execFile);

function text(rows) {
  return `${rows.join("\n")}\n`;
}

const TEXT_TEST = [
  ASSERT_IMPORT,
  READ_IMPORT,
  TEST_IMPORT,
  "",
  RECHNER_TEXT,
  "",
  'test("Rechner exportiert summe", () => {',
  "  assert.match(quelltext, /summe/);",
  "});",
];

const MIXED_TEST = [
  ASSERT_IMPORT,
  READ_IMPORT,
  TEST_IMPORT,
  SUMME_IMPORT,
  "",
  RECHNER_TEXT,
  'const ART = "ganz";',
  "",
  'test("liest den Rechner", () => {',
  "  assert.match(quelltext, /summe/);",
  "});",
  "",
  'test("Gruppe", async (context) => {',
  '  await context.test("rechnet", () => {',
  "    assert.equal(summe(1, 1), 2);",
  "  });",
  "});",
  "",
  "test(`rechnet ${ART}`, () => {",
  "  assert.equal(summe(2, 2), 4);",
  "});",
];

const BEHAVIOUR_TEST = [
  ASSERT_IMPORT,
  TEST_IMPORT,
  SUMME_IMPORT,
  "",
  'test("rechnet eins plus eins", () => {',
  "  assert.equal(summe(1, 1), 2);",
  "});",
];

const IMPORT_TEST = [
  ASSERT_IMPORT,
  TEST_IMPORT,
  SUMME_IMPORT,
  "",
  'test("summiert und verdoppelt", async () => {',
  '  const { doppelt } = await import("../src/zusatz.js");',
  "  assert.equal(doppelt(summe(1, 1)), 4);",
  "});",
];

const BEFORE_TEST = [
  ASSERT_IMPORT,
  READ_IMPORT,
  'import { before, test } from "node:test";',
  "",
  "let anleitung;",
  "",
  "before(() => {",
  '  anleitung = readFileSync(new URL("../docs/anleitung.md", import.meta.url), "utf8");',
  "});",
  "",
  'test("Anleitung nennt den Start", () => {',
  "  assert.match(anleitung, /Start/);",
  "});",
  "",
  'test("Anleitung nennt das Ende", () => {',
  "  assert.match(anleitung, /Ende/);",
  "});",
];

const FUNCTION_TEST = [
  ASSERT_IMPORT,
  READ_IMPORT,
  TEST_IMPORT,
  "",
  "function quelltext() {",
  '  return readFileSync(new URL("../src/rechner.js", import.meta.url), "utf8");',
  "}",
  "",
  'test("Rechner nennt summe", () => {',
  "  assert.match(quelltext(), /summe/);",
  "});",
];

function probe(context, files) {
  const directory = probeRepository(context, {
    [RECHNER]: "export const summe = (links, rechts) => links + rechts;\n",
    [ZUSATZ]: "export const doppelt = (wert) => wert * 2;\n",
    "tools/gate-tests.json": JSON.stringify({ Denylist: { module: [], tests: [GATE_FILE] } }),
    ...files,
  });
  const basis = runIn(directory, "git", ["rev-parse", "HEAD"]).stdout.trim();
  return { directory, basis };
}

function commitFiles(directory, files) {
  writeFiles(directory, files);
  commitAll(directory, "Ändere Tests");
}

function deleteFiles(directory, files) {
  for (const file of files) rmSync(join(directory, file));
  commitAll(directory, "Lösche Tests");
}

function rename(directory, from, to) {
  const result = runIn(directory, "git", ["mv", from, to]);
  assert.equal(result.status, EXIT_OK, result.stderr);
}

async function check({ directory, basis }) {
  const server = await fakeGitHub();
  const requests = [];
  server.on("request", ({ method, url }) => requests.push(`${method} ${url}`));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  const env = {
    ...isolatedEnvironment(),
    GITHUB_TOKEN: "attrappe",
    GITHUB_REPOSITORY: "probe/hermes",
    GITHUB_API_URL: apiUrl,
    GITHUB_GRAPHQL_URL: `${apiUrl}/graphql`,
  };
  const args = [TOOL, "--basis", basis, "--pr", PULL_REQUEST];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, { cwd: directory, env });
    return { status: EXIT_OK, output: `${stdout}${stderr}`, requests };
  } catch (error) {
    return { status: error.code, output: `${error.stdout}${error.stderr}`, requests };
  } finally {
    server.close();
  }
}

function assertPassedWithoutGitHub(result) {
  assert.equal(result.status, EXIT_OK, result.output);
  assert.deepEqual(result.requests, []);
}

function assertStopped(result) {
  assert.equal(result.status, EXIT_FINDING, result.output);
  assert.match(result.output, NO_APPROVAL);
}

test("Testschutz-Ausnahme: nur entfernte Kommentare gehen ohne Frage an GitHub durch", async (context) => {
  const file = "test/kommentar.test.js";
  const body = ["  assert.equal(1 + 1, 2);", "  assert.equal(2n ** 3n, 8n);", "});"];
  const repo = probe(context, {
    [file]: text([
      ASSERT_IMPORT,
      TEST_IMPORT,
      "",
      "// Grundrechnung",
      'test("rechnet", () => {  // zwei',
      ...body,
    ]),
  });
  commitFiles(repo.directory, {
    [file]: text([ASSERT_IMPORT, TEST_IMPORT, "", 'test("rechnet", () => {', ...body]),
  });
  const result = await check(repo);
  assertPassedWithoutGitHub(result);
  assert.match(
    result.output,
    /Testschutz: test\/kommentar\.test\.js: nur Kommentare oder Leerraum geändert \(Syntaxbaum gleich\)\./,
  );
  assert.match(result.output, /Testschutz: sonst keine bestehende Testzeile geändert/);
});

test("Testschutz-Ausnahme: ein entfernter Kommentar tarnt keine geänderte Erwartung", async (context) => {
  const file = "test/getarnt.test.js";
  const lines = (expectation) => [
    ASSERT_IMPORT,
    TEST_IMPORT,
    "",
    'test("rechnet", () => {',
    expectation,
    "});",
  ];
  const repo = probe(context, { [file]: text(lines("  assert.equal(1 + 1, 2); // zwei")) });
  commitFiles(repo.directory, { [file]: text(lines("  assert.equal(1 + 1, 3);")) });
  assertStopped(await check(repo));
});

test("Testschutz-Ausnahme: eine Zeichenkette, die wie ein Kommentar aussieht, zählt als Code", async (context) => {
  const file = "test/zeichenkette.test.js";
  const lines = (pattern) => [
    ASSERT_IMPORT,
    TEST_IMPORT,
    "",
    'test("prüft das Muster", () => {',
    `  assert.equal(${pattern}.length >= 0, true);`,
    "});",
  ];
  const repo = probe(context, { [file]: text(lines('"// a"')) });
  commitFiles(repo.directory, { [file]: text(lines('"// b"')) });
  assertStopped(await check(repo));
});

test("Testschutz-Ausnahme: eine gelöschte Datei mit nur einem Texttest geht ohne GitHub durch", async (context) => {
  const file = "test/text.test.js";
  const repo = probe(context, { [file]: text(TEXT_TEST) });
  deleteFiles(repo.directory, [file]);
  const result = await check(repo);
  assertPassedWithoutGitHub(result);
  assert.match(
    result.output,
    /test\/text\.test\.js: gelöscht, nur Tests, die Quelltext oder Dokumente als Text lesen \(Regel 31\)\./,
  );
});

function readingTest(imports, checks) {
  return [
    ASSERT_IMPORT,
    READ_IMPORT,
    TEST_IMPORT,
    ...imports,
    "",
    RECHNER_TEXT,
    "",
    'test("Rechner nennt summe", async () => {',
    "  assert.match(quelltext, /summe/);",
    ...checks,
    "});",
  ];
}

async function deletedExecutingFile(context, file, rows) {
  const repo = probe(context, { [file]: text(rows) });
  deleteFiles(repo.directory, [file]);
  const result = await check(repo);
  assertStopped(result);
  return result.output;
}

const HELPER_FILE = "test/helpers.js";
const HELPER_MODULE = 'export { summe } from "../src/rechner.js";\n';

async function deletedWithHelper(context, file, rows) {
  const repo = probe(context, { [HELPER_FILE]: HELPER_MODULE, [file]: text(rows) });
  deleteFiles(repo.directory, [file]);
  const result = await check(repo);
  assertStopped(result);
  return result.output;
}

test("Testschutz-Ausnahme: ein Texttest, der zugleich Code aus src/ prüft, bleibt gesperrt", async (context) => {
  const file = "test/text-und-verhalten.test.js";
  const rows = readingTest([SUMME_IMPORT], ["  assert.equal(summe(1, 1), 2);"]);
  const output = await deletedExecutingFile(context, file, rows);
  assert.ok(
    output.includes(
      `${file}: ${WHOLE_FILE_DELETED} Die Datei kann Code ausführen: bindet ../src/rechner.js ein.`,
    ),
    output,
  );
});

test("Testschutz-Ausnahme: eine gelöschte Texttest-Datei mit vm bleibt gesperrt", async (context) => {
  const rows = readingTest(
    ['import vm from "node:vm";'],
    ['  assert.equal(vm.runInNewContext("1 + 1"), 2);'],
  );
  const output = await deletedExecutingFile(context, "test/vm-text.test.js", rows);
  assert.match(output, /Die Datei kann Code ausführen: bindet node:vm ein\./);
});

test("Testschutz-Ausnahme: eine gelöschte CommonJS-Texttest-Datei mit require bleibt gesperrt", async (context) => {
  const rows = [
    'const assert = require("node:assert/strict");',
    'const { readFileSync } = require("node:fs");',
    'const { join } = require("node:path");',
    'const { spawnSync } = require("child_process");',
    'const { test } = require("node:test");',
    "",
    'const quelltext = readFileSync(join(__dirname, "../src/rechner.js"), "utf8");',
    "",
    'test("Rechner nennt summe", () => {',
    "  assert.match(quelltext, /summe/);",
    '  assert.equal(spawnSync("true").status, 0);',
    "});",
  ];
  const output = await deletedExecutingFile(context, "test/prozess-text.test.cjs", rows);
  assert.match(output, /Die Datei kann Code ausführen: nennt require\./);
});

test("Testschutz-Ausnahme: eine gelöschte Texttest-Datei mit eval und new Function bleibt gesperrt", async (context) => {
  const rows = readingTest(
    [],
    ['  assert.equal(eval("1 + 1"), 2);', '  assert.equal(new Function("return 2")(), 2);'],
  );
  const output = await deletedExecutingFile(context, "test/eval-text.test.js", rows);
  assert.match(output, /Die Datei kann Code ausführen: nennt eval, nennt Function\./);
});

test("Testschutz-Ausnahme: Function ohne new und eval über globalThis sperren die Löschung", async (context) => {
  const rows = readingTest(
    [],
    [
      '  assert.equal(Function("return 2")(), 2);',
      '  assert.equal(globalThis["eval"]("1 + 1"), 2);',
    ],
  );
  const output = await deletedExecutingFile(context, "test/function-text.test.js", rows);
  assert.match(output, /Die Datei kann Code ausführen: nennt Function, nennt eval\./);
});

test("Testschutz-Ausnahme: ein dynamischer Import mit fester Quelle sperrt die Löschung", async (context) => {
  const rows = readingTest([], ['  await import("node:path");']);
  const output = await deletedExecutingFile(context, "test/dynamisch-text.test.js", rows);
  assert.match(output, /Die Datei kann Code ausführen: lädt Code mit import\(\) nach\./);
});

test("Testschutz-Ausnahme: ein dynamischer Import über new URL sperrt die Löschung", async (context) => {
  const rows = readingTest(
    [],
    [
      '  const { summe } = await import(new URL("../src/rechner.js", import.meta.url).href);',
      "  assert.equal(summe(1, 1), 2);",
    ],
  );
  const output = await deletedExecutingFile(context, "test/url-import-text.test.js", rows);
  assert.match(output, /Die Datei kann Code ausführen: lädt Code mit import\(\) nach\./);
});

test("Testschutz-Ausnahme: ein dynamischer Import mit Vorlage sperrt die Löschung", async (context) => {
  const rows = readingTest(
    [],
    ["  const { summe } = await import(`../src/rechner.js`);", "  assert.equal(summe(1, 1), 2);"],
  );
  const output = await deletedExecutingFile(context, "test/vorlage-import-text.test.js", rows);
  assert.match(output, /Die Datei kann Code ausführen: lädt Code mit import\(\) nach\./);
});

test("Testschutz-Ausnahme: ein Hilfsmodul aus test/ sperrt die Löschung", async (context) => {
  const rows = readingTest(
    ['import { summe } from "./helpers.js";'],
    ["  assert.equal(summe(1, 1), 2);"],
  );
  const output = await deletedWithHelper(context, "test/helfer-text.test.js", rows);
  assert.match(output, /Die Datei kann Code ausführen: bindet \.\/helpers\.js ein\./);
});

test("Testschutz-Ausnahme: ein Verhaltenstest mit void auf die Lesefunktion bleibt gesperrt", async (context) => {
  const rows = [
    ASSERT_IMPORT,
    READ_IMPORT,
    TEST_IMPORT,
    'import { summe } from "./helpers.js";',
    "",
    "function readRepoFile() {",
    '  return readFileSync(new URL("../src/rechner.js", import.meta.url), "utf8");',
    "}",
    "",
    'test("rechnet eins plus eins", () => {',
    "  void readRepoFile;",
    "  assert.equal(summe(1, 1), 2);",
    "});",
  ];
  const output = await deletedWithHelper(context, "test/void-lesen.test.js", rows);
  assert.match(output, /Die Datei kann Code ausführen: bindet \.\/helpers\.js ein\./);
});

test("Testschutz-Ausnahme: ein Texttest nur mit fs, path und url ohne node: geht ohne GitHub durch", async (context) => {
  const file = "test/ohne-praefix.test.js";
  const rows = [
    'import assert from "assert/strict";',
    'import { readFileSync } from "fs";',
    'import { dirname, join } from "path";',
    'import { test } from "node:test";',
    'import { fileURLToPath } from "url";',
    "",
    "const ordner = dirname(fileURLToPath(import.meta.url));",
    'const quelltext = readFileSync(join(ordner, "../src/rechner.js"), "utf8");',
    "",
    'test("Rechner nennt summe", () => {',
    "  assert.match(quelltext, /summe/);",
    "});",
  ];
  const repo = probe(context, { [file]: text(rows) });
  deleteFiles(repo.directory, [file]);
  const result = await check(repo);
  assertPassedWithoutGitHub(result);
  assert.match(result.output, /test\/ohne-praefix\.test\.js: gelöscht, nur Tests/);
});

test("Testschutz-Ausnahme: eine gelöschte gemischte Datei nennt die Verhaltenstests", async (context) => {
  const file = "test/gemischt.test.js";
  const repo = probe(context, { [file]: text(MIXED_TEST) });
  deleteFiles(repo.directory, [file]);
  const result = await check(repo);
  assertStopped(result);
  const dynamicLine = MIXED_TEST.indexOf("test(`rechnet ${ART}`, () => {") + 1;
  assert.match(
    result.output,
    new RegExp(`${WHOLE_FILE_DELETED} Ohne Lesestelle sind: „rechnet“, „Zeile ${dynamicLine}“\\.`),
  );
  assert.doesNotMatch(result.output, /„Gruppe“|„liest den Rechner“/);
});

test("Testschutz-Ausnahme: eine gelöschte Datei ohne Lesestelle bleibt gesperrt", async (context) => {
  const file = "test/verhalten.test.js";
  const repo = probe(context, { [file]: text(BEHAVIOUR_TEST) });
  deleteFiles(repo.directory, [file]);
  const result = await check(repo);
  assertStopped(result);
  assert.ok(
    result.output.includes(`test/verhalten.test.js: ${WHOLE_FILE_DELETED}\n`),
    result.output,
  );
});

test("Testschutz-Ausnahme: eine gelöschte Texttest-Datei aus gate-tests.json bleibt gesperrt", async (context) => {
  const repo = probe(context, { [GATE_FILE]: text(TEXT_TEST) });
  deleteFiles(repo.directory, [GATE_FILE]);
  const result = await check(repo);
  assertStopped(result);
  assert.ok(result.output.includes(`${GATE_FILE}: ${WHOLE_FILE_DELETED}\n`), result.output);
});

test("Testschutz-Ausnahme: Importpfade, die umbenannten Modulen folgen, gehen ohne GitHub durch", async (context) => {
  const file = "test/import.test.js";
  const repo = probe(context, { [file]: text(IMPORT_TEST) });
  rename(repo.directory, RECHNER, "src/rechnen.js");
  rename(repo.directory, ZUSATZ, "src/verdoppeln.js");
  const moved = text(IMPORT_TEST)
    .replace("../src/rechner.js", "../src/rechnen.js")
    .replace("../src/zusatz.js", "../src/verdoppeln.js");
  commitFiles(repo.directory, { [file]: moved });
  const result = await check(repo);
  assertPassedWithoutGitHub(result);
  assert.match(
    result.output,
    /test\/import\.test\.js: Importpfad folgt der Umbenennung von src\/rechner\.js nach src\/rechnen\.js, von src\/zusatz\.js nach src\/verdoppeln\.js\./,
  );
});

test("Testschutz-Ausnahme: ein Importpfad auf ein anderes Modul braucht die Freigabe", async (context) => {
  const file = "test/import.test.js";
  const repo = probe(context, { [file]: text(IMPORT_TEST) });
  commitFiles(repo.directory, {
    "src/anders.js": "export const summe = (links, rechts) => links - rechts;\n",
    [file]: text(IMPORT_TEST).replace("../src/rechner.js", "../src/anders.js"),
  });
  assertStopped(await check(repo));
});

test("Testschutz-Ausnahme: ein anders geschriebener Pfad zum selben Modul braucht die Freigabe", async (context) => {
  const file = "test/import.test.js";
  const repo = probe(context, { [file]: text(IMPORT_TEST) });
  commitFiles(repo.directory, {
    [file]: text(IMPORT_TEST).replace("../src/rechner.js", "../src/../src/rechner.js"),
  });
  assertStopped(await check(repo));
});

test("Testschutz-Ausnahme: Umbenennung und geänderte Erwartung brauchen die Freigabe", async (context) => {
  const file = "test/import.test.js";
  const repo = probe(context, { [file]: text(IMPORT_TEST) });
  rename(repo.directory, RECHNER, "src/rechnen.js");
  const moved = text(IMPORT_TEST)
    .replace("../src/rechner.js", "../src/rechnen.js")
    .replace("doppelt(summe(1, 1)), 4", "doppelt(summe(1, 1)), 5");
  commitFiles(repo.directory, { [file]: moved });
  assertStopped(await check(repo));
});

test("Testschutz-Ausnahme: eine Lesestelle in before speist alle Tests der gelöschten Datei", async (context) => {
  const file = "test/anleitung.test.js";
  const repo = probe(context, { [file]: text(BEFORE_TEST) });
  deleteFiles(repo.directory, [file]);
  const result = await check(repo);
  assertPassedWithoutGitHub(result);
  assert.match(result.output, /test\/anleitung\.test\.js: gelöscht, nur Tests/);
});

test("Testschutz-Ausnahme: eine lesende Funktionsdeklaration speist den Test der gelöschten Datei", async (context) => {
  const file = "test/funktion.test.js";
  const repo = probe(context, { [file]: text(FUNCTION_TEST) });
  deleteFiles(repo.directory, [file]);
  assertPassedWithoutGitHub(await check(repo));
});

test("Testschutz-Ausnahme: eine gelöschte lesende Hilfsdatei ohne Tests bleibt gesperrt", async (context) => {
  const file = "test/lese-helfer.js";
  const repo = probe(context, { [file]: text([READ_IMPORT, "", `export ${RECHNER_TEXT}`]) });
  deleteFiles(repo.directory, [file]);
  assertStopped(await check(repo));
});

const MARKUP_TEST = [
  READ_IMPORT,
  TEST_IMPORT,
  RECHNER_TEXT,
  'test("zeigt", () => <div>{quelltext}</div>);',
];

test("Testschutz-Ausnahme: eine nicht lesbare geänderte Testdatei braucht die Freigabe", async (context) => {
  const file = "test/jsx-geaendert.test.js";
  const repo = probe(context, { [file]: text([...MARKUP_TEST, "// Ende"]) });
  commitFiles(repo.directory, { [file]: text(MARKUP_TEST) });
  assertStopped(await check(repo));
});

test("Testschutz-Ausnahme: eine nicht lesbare gelöschte Testdatei bleibt gesperrt", async (context) => {
  const file = "test/jsx-geloescht.test.js";
  const repo = probe(context, { [file]: text(MARKUP_TEST) });
  deleteFiles(repo.directory, [file]);
  assertStopped(await check(repo));
});

test("Testschutz-Ausnahme: eine geänderte Nicht-JavaScript-Datei braucht die Freigabe", async (context) => {
  const file = "test/fixtures/werte.txt";
  const repo = probe(context, { [file]: text(["1 + 1 // zwei"]) });
  commitFiles(repo.directory, { [file]: text(["1 + 1"]) });
  assertStopped(await check(repo));
});
