import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import testlaufzeitReporter from "../../tools/testlaufzeit-reporter.mjs";
import { aufteilung, tabellenZeile } from "../../tools/testlaufzeit/aufteilung.mjs";
import { REPO_ROOT, isolatedEnvironment } from "./probe-repo.js";

const REPORTER = join(REPO_ROOT, "tools/testlaufzeit-reporter.mjs");
const LAUF_FRIST_MS = 60_000;
const DATEI = resolve("test/a.test.js");
const ERSTER_TEST_MS = 10;
const ZWEITER_TEST_MS = 20.5;
const KINDPROZESS_MS = 50;
const GESAMT_MS = 80;

const ZEILE = {
  datei: "test/x.test.js",
  dauer_ms: 4200,
  ausklingen_ms: 300,
  tests_ms: 3500,
  kind_ms: 3800,
};
const KOSTEN = {
  datenbankStarts: { anzahl: 3, summe: 1234.56 },
  serverStarts: { anzahl: 1, summe: 900 },
  echtWarten: { anzahl: 2, summe: 60 },
};

test("die Aufteilung trennt Prozessstart, Tests, Datenbank, Server und Ausklingen", () => {
  assert.deepEqual(aufteilung(ZEILE, KOSTEN), {
    gesamt_ms: 4200,
    prozessstart_ms: 400,
    tests_ms: 3500,
    datenbank: { anzahl: 3, ms: 1234.6 },
    server: { anzahl: 1, ms: 900 },
    ausklingen_ms: 300,
  });
});

test("Prozessstart und Laden wird nie negativ, und ohne Kosten zählen keine Starts", () => {
  const teile = aufteilung({ ...ZEILE, kind_ms: ZEILE.dauer_ms + 1 }, undefined);
  assert.equal(teile.prozessstart_ms, 0);
  assert.deepEqual(teile.datenbank, { anzahl: 0, ms: 0 });
  assert.deepEqual(teile.server, { anzahl: 0, ms: 0 });
});

test("ohne Dauer aus test:summary bleibt Prozessstart und Laden offen", () => {
  assert.equal(aufteilung({ ...ZEILE, kind_ms: null }, KOSTEN).prozessstart_ms, null);
});

test("die Tabellenzeile zeigt alle Spalten der Aufteilung", () => {
  assert.equal(
    tabellenZeile(ZEILE, KOSTEN),
    "| test/x.test.js | 4.20 | 0.40 | 3.50 | 3 / 1.23 | 1 / 0.90 | 0.30 | 2× / 60 ms |",
  );
});

test("der Reporter schreibt die Summe der Testdauern und die Dauer des Kindprozesses", (context) => {
  const ordner = mkdtempSync(join(tmpdir(), "testlaufzeit-aufteilung-"));
  context.after(() => rmSync(ordner, { recursive: true, force: true }));
  writeFileSync(
    join(ordner, "a.test.js"),
    'import { test } from "node:test";\ntest("eins", () => {});\ntest("zwei", () => {});\n',
  );
  const ziel = join(ordner, "dateien.jsonl");
  const lauf = spawnSync(
    process.execPath,
    ["--test", `--test-reporter=${REPORTER}`, `--test-reporter-destination=${ziel}`, "a.test.js"],
    { cwd: ordner, env: isolatedEnvironment(), timeout: LAUF_FRIST_MS },
  );
  assert.equal(lauf.status, 0, String(lauf.stderr));
  const [zeile] = readFileSync(ziel, "utf8")
    .trim()
    .split("\n")
    .map((text) => JSON.parse(text));
  assert.equal(typeof zeile.tests_ms, "number");
  assert.ok(zeile.kind_ms > 0);
  assert.ok(zeile.kind_ms >= zeile.tests_ms);
  assert.ok(zeile.dauer_ms >= zeile.kind_ms);
});

const TESTS = [
  {
    type: "test:pass",
    data: { file: DATEI, name: "eins", nesting: 0, details: { duration_ms: ERSTER_TEST_MS } },
  },
  {
    type: "test:fail",
    data: { file: DATEI, name: "zwei", nesting: 0, details: { duration_ms: ZWEITER_TEST_MS } },
  },
];
const KINDPROZESS = { type: "test:summary", data: { file: DATEI, duration_ms: KINDPROZESS_MS } };
const DATEI_ENDE = {
  type: "test:complete",
  data: { file: DATEI, name: DATEI, nesting: 0, details: { duration_ms: GESAMT_MS } },
};

async function berichtZeilen(ereignisse) {
  async function* quelle() {
    yield* ereignisse;
  }
  const zeilen = [];
  for await (const text of testlaufzeitReporter(quelle())) zeilen.push(JSON.parse(text));
  return zeilen;
}

test("der Reporter rechnet Testsumme, Kindprozess und Ausklingzeit je Datei aus den Ereignissen", async () => {
  assert.deepEqual(await berichtZeilen([...TESTS, KINDPROZESS, DATEI_ENDE]), [
    {
      datei: "test/a.test.js",
      dauer_ms: GESAMT_MS,
      ausklingen_ms: KINDPROZESS_MS - ERSTER_TEST_MS - ZWEITER_TEST_MS,
      tests_ms: ERSTER_TEST_MS + ZWEITER_TEST_MS,
      kind_ms: KINDPROZESS_MS,
    },
  ]);
});

test("ohne test:summary meldet der Reporter weder Kindprozess noch Ausklingzeit", async () => {
  assert.deepEqual(await berichtZeilen([...TESTS, DATEI_ENDE]), [
    {
      datei: "test/a.test.js",
      dauer_ms: GESAMT_MS,
      ausklingen_ms: null,
      tests_ms: ERSTER_TEST_MS + ZWEITER_TEST_MS,
      kind_ms: null,
    },
  ]);
});
