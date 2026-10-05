import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ZWEITER_LAUF, testlaeufer, wegwerfRepo } from "./warteschlange/hilfen.mjs";

const WACKEL_DATEI = "test/wackel.test.js";
const WACKEL_NAME = "wackelt beim ersten Lauf";
const ZWEITER_PROTOKOLL = ".pruefung/regression-zweiter-lauf.log";
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const SHA_LAENGE = 40;
const IM_CI = {
  GITHUB_SHA: "c".repeat(SHA_LAENGE),
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "sundartha/hermes",
  GITHUB_RUN_ID: "4711",
};

function wackelTest(name) {
  return [
    'import assert from "node:assert/strict";',
    'import { appendFileSync, existsSync, writeFileSync } from "node:fs";',
    'import { test } from "node:test";',
    `test(${JSON.stringify(name)}, () => {`,
    '  const merker = new URL("../merker.txt", import.meta.url);',
    "  const schonEinmal = existsSync(merker);",
    '  writeFileSync(merker, "gelaufen");',
    '  if (process.env.TESTKOSTEN_DATEI) appendFileSync(process.env.TESTKOSTEN_DATEI, "lauf\\n");',
    "  assert.equal(schonEinmal, true);",
    "});",
    "",
  ].join("\n");
}

function immerRot(name) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    `test(${JSON.stringify(name)}, () => assert.equal(1, 2));`,
    "",
  ].join("\n");
}

function lauf(context, dateien, umgebung = ZWEITER_LAUF) {
  const repo = wegwerfRepo(context, dateien);
  const ergebnis = testlaeufer(repo.ordner, umgebung);
  const zweiterLief = existsSync(join(repo.ordner, ZWEITER_PROTOKOLL));
  return { ...ergebnis, repo, zweiterLief, kopf: repo.git(["rev-parse", "HEAD"]) };
}

function bestanden(repo) {
  return JSON.parse(readFileSync(join(repo.ordner, ".pruefung/regression.json"), "utf8")).bestanden;
}

test("ein Test, der im ersten Lauf rot und im zweiten grün ist, hält den Lauf nicht auf und wird festgehalten", (context) => {
  const ergebnis = lauf(context, { [WACKEL_DATEI]: wackelTest(WACKEL_NAME) });
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  assert.deepEqual(ergebnis.wackelig, {
    format: 1,
    commit: ergebnis.kopf,
    lauf: null,
    wackelig: [{ datei: WACKEL_DATEI, test: WACKEL_NAME }],
    rot: [],
  });
  assert.ok(
    ergebnis.ausgabe.includes(`Wackelig (im zweiten Lauf grün): ${WACKEL_DATEI} › ${WACKEL_NAME}`),
    ergebnis.ausgabe,
  );
  assert.equal(bestanden(ergebnis.repo), 1);
});

test("im CI nennt wackelig.json Commit und Lauf, und der zweite Lauf schreibt keine Testkosten", (context) => {
  const repo = wegwerfRepo(context, { [WACKEL_DATEI]: wackelTest(WACKEL_NAME) });
  const kosten = join(repo.ordner, "testkosten.jsonl");
  const ergebnis = testlaeufer(repo.ordner, { ...ZWEITER_LAUF, ...IM_CI, TESTKOSTEN_DATEI: kosten });
  assert.equal(ergebnis.status, EXIT_GRUEN, ergebnis.ausgabe);
  assert.equal(ergebnis.wackelig.commit, IM_CI.GITHUB_SHA);
  assert.equal(ergebnis.wackelig.lauf, "https://github.com/sundartha/hermes/actions/runs/4711");
  assert.equal(readFileSync(kosten, "utf8"), "lauf\n");
});

test("ohne TESTS_ZWEITER_LAUF bleibt ein wackeliger Test rot wie bisher", (context) => {
  const ergebnis = lauf(context, { [WACKEL_DATEI]: wackelTest(WACKEL_NAME) }, {});
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.equal(ergebnis.wackelig, null);
  assert.equal(ergebnis.zweiterLief, false);
});

test("ein Test, der zweimal rot ist, bleibt rot und steht unter rot", (context) => {
  const ergebnis = lauf(context, { "test/rot.test.js": immerRot("immer rot") });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.deepEqual(ergebnis.wackelig.wackelig, []);
  assert.deepEqual(ergebnis.wackelig.rot, [
    { datei: "test/rot.test.js", test: "immer rot", grund: "zweimal rot" },
  ]);
  assert.equal(ergebnis.zweiterLief, true);
});

test("ein Test aus tools/gate-tests.json bekommt keinen zweiten Lauf", (context) => {
  const ergebnis = lauf(context, {
    [WACKEL_DATEI]: wackelTest(WACKEL_NAME),
    "tools/gate-tests.json": JSON.stringify({ Probe: { module: [], tests: [WACKEL_DATEI] } }),
  });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.deepEqual(ergebnis.wackelig.rot, [
    { datei: WACKEL_DATEI, test: WACKEL_NAME, grund: "Safety-Gate-Test, kein zweiter Lauf" },
  ]);
  assert.equal(ergebnis.zweiterLief, false);
});

test("ein Test des Bedrohungskatalogs bekommt keinen zweiten Lauf", (context) => {
  const name = "SG-99 wackelt beim ersten Lauf";
  const ergebnis = lauf(context, { [WACKEL_DATEI]: wackelTest(name) });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.deepEqual(ergebnis.wackelig.rot, [
    { datei: WACKEL_DATEI, test: name, grund: "Bedrohungskatalog, kein zweiter Lauf" },
  ]);
  assert.equal(ergebnis.zweiterLief, false);
});

test("ein anders benannter Test in einer Datei mit SG-Test bekommt keinen zweiten Lauf", (context) => {
  const katalogtest = 'test("SG-98 bleibt grün", () => {});\n';
  const ergebnis = lauf(context, { [WACKEL_DATEI]: `${wackelTest(WACKEL_NAME)}${katalogtest}` });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.deepEqual(ergebnis.wackelig.rot, [
    { datei: WACKEL_DATEI, test: WACKEL_NAME, grund: "Bedrohungskatalog, kein zweiter Lauf" },
  ]);
  assert.equal(ergebnis.zweiterLief, false);
});

test("eine Testdatei, die beim Laden wirft, bekommt keinen zweiten Lauf", (context) => {
  const ergebnis = lauf(context, { "test/laden.test.js": 'throw new Error("kaputt");\n' });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.deepEqual(ergebnis.wackelig.rot, [
    { datei: null, test: "test/laden.test.js", grund: "ohne Fundstelle" },
  ]);
  assert.equal(ergebnis.zweiterLief, false);
});

test("ein gesperrter roter Test verhindert den zweiten Lauf auch für einen wackeligen", (context) => {
  const ergebnis = lauf(context, {
    [WACKEL_DATEI]: wackelTest(WACKEL_NAME),
    "test/laden.test.js": 'throw new Error("kaputt");\n',
  });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.deepEqual(ergebnis.wackelig.wackelig, []);
  const gruende = ergebnis.wackelig.rot.map(({ grund }) => grund);
  assert.deepEqual(gruende.sort(), [
    "kein zweiter Lauf wegen eines anderen roten Tests",
    "ohne Fundstelle",
  ]);
  assert.equal(ergebnis.zweiterLief, false);
});

test("ein Lauf, der ohne erkennbaren roten Test abbricht, bleibt rot ohne zweiten Lauf", (context) => {
  const ergebnis = lauf(context, {
    [WACKEL_DATEI]: wackelTest(WACKEL_NAME),
    "test/abbruch.test.js": [
      'import { test } from "node:test";',
      'test("bricht den Testlauf ab", () => process.kill(process.ppid, "SIGKILL"));',
      "",
    ].join("\n"),
  });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.deepEqual(ergebnis.wackelig.wackelig, []);
  assert.deepEqual(ergebnis.wackelig.rot[0], {
    datei: null,
    test: null,
    grund: "rot ohne erkennbaren Test",
  });
  assert.equal(ergebnis.zweiterLief, false);
});

test("ein PR, der seine Datei aus tools/gate-tests.json streicht, bekommt trotzdem keinen zweiten Lauf", (context) => {
  const repo = wegwerfRepo(context, {
    [WACKEL_DATEI]: wackelTest(WACKEL_NAME),
    "tools/gate-tests.json": JSON.stringify({ Probe: { module: [], tests: [WACKEL_DATEI] } }),
  });
  repo.committe({ "tools/gate-tests.json": "{}\n" }, "Streiche den Gate-Test");
  const ergebnis = testlaeufer(repo.ordner, ZWEITER_LAUF);
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.deepEqual(ergebnis.wackelig.rot, [
    { datei: WACKEL_DATEI, test: WACKEL_NAME, grund: "Safety-Gate-Test, kein zweiter Lauf" },
  ]);
});
