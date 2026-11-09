import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { ausgefuehrteMutanten, schutzOrte } from "../../tools/pruefen.mjs";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const ELTERNWAECHTER = resolve(import.meta.dirname, "../gemeinsam/elternwaechter.mjs");
const QUELLE = [
  "const stryMutAct_9fa48 = () => false;",
  "export function eins() {",
  '  return stryMutAct_9fa48("1") ? 0 : 1;',
  "}",
  "export function zwei() {",
  '  return stryMutAct_9fa48("2") ? 0 : 2;',
  "}",
  "",
].join("\n");
const TESTLAUF = [
  'import { appendFileSync } from "node:fs";',
  "const datei = process.argv[3];",
  'appendFileSync("ausgefuehrt.txt", datei + "\\n");',
  'const quelle = await import("../src/quelle.mjs");',
  'if (datei === "test/eins.test.js") quelle.eins();',
  'if (datei === "test/zwei.test.js") quelle.zwei();',
  'process.exitCode = datei === "test/eins.test.js" && process.env.__STRYKER_ACTIVE_MUTANT__ === "1" ? 1 : 0;',
  "",
].join("\n");

function mitOrdner(ablauf) {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-zeilen-"));
  try {
    return ablauf(ordner);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Ein Mutant gilt als ausgeführt, wenn der Test seinen Schutzaufruf erreicht, und sonst nicht", () => {
  mitOrdner((ordner) => {
    const quelle = join(ordner, "quelle.mjs");
    writeFileSync(quelle, QUELLE);
    writeFileSync(join(ordner, "test.mjs"), 'import { eins } from "./quelle.mjs";\neins();\n');
    const abdeckung = join(ordner, "abdeckung");
    const lauf = spawnSync(process.execPath, [join(ordner, "test.mjs")], { env: { ...process.env, NODE_V8_COVERAGE: abdeckung } });
    assert.equal(lauf.status, 0);
    const prozesse = readdirSync(abdeckung).map((name) => JSON.parse(readFileSync(join(abdeckung, name), "utf8")).result);
    assert.deepEqual(ausgefuehrteMutanten(prozesse, schutzOrte([quelle])), ["1"]);
  });
});

test("Eine Datei, die ein Prozess nie lädt, führt keinen Mutanten aus", () => {
  const prozesse = [[{ url: "file:///anders.mjs", functions: [{ ranges: [{ startOffset: 0, endOffset: 99, count: 1 }] }] }]];
  assert.deepEqual(ausgefuehrteMutanten(prozesse, { 1: { datei: "/quelle.mjs", offset: 5 } }), []);
});

test("Die Ausführung in irgendeinem Prozess genügt", () => {
  const skript = (count) => [{ url: "file:///quelle.mjs", functions: [{ ranges: [{ startOffset: 0, endOffset: 99, count: 1 }, { startOffset: 4, endOffset: 9, count }] }] }];
  assert.deepEqual(ausgefuehrteMutanten([skript(0), skript(1)], { 1: { datei: "/quelle.mjs", offset: 5 } }), ["1"]);
  assert.deepEqual(ausgefuehrteMutanten([skript(0)], { 1: { datei: "/quelle.mjs", offset: 5 } }), []);
});

function aufbauen(ordner) {
  mkdirSync(join(ordner, "src"));
  mkdirSync(join(ordner, "test"));
  writeFileSync(join(ordner, "src/quelle.mjs"), QUELLE);
  writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF);
  const plan = { frist: Date.now() + 600_000, tests: ["test/zwei.test.js", "test/eins.test.js", "test/keins.test.js"], dateien: ["src/quelle.mjs"], eingebettet: [], protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json"), abdeckung: join(ordner, "abdeckung") };
  mkdirSync(plan.abdeckung);
  writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
  return plan;
}

function mutantLauf(ordner, mutant) {
  spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: mutant, MUTATION_PLAN: join(ordner, "plan.json") } });
  const zeilen = readFileSync(join(ordner, "protokoll.jsonl"), "utf8").trim().split("\n");
  return JSON.parse(zeilen.at(-1));
}

function ausgefuehrt(ordner) {
  const zaehler = {};
  for (const datei of readFileSync(join(ordner, "ausgefuehrt.txt"), "utf8").trim().split("\n")) zaehler[datei] = (zaehler[datei] ?? 0) + 1;
  return zaehler;
}

test("Ein Mutant in einer Zeile, die nur eine Testdatei ausführt, wird von genau dieser getötet", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner);
    assert.deepEqual(mutantLauf(ordner, "1"), { id: "1", ergebnis: "getötet", test: "test/eins.test.js" });
    assert.equal(ausgefuehrt(ordner)["test/zwei.test.js"], 1);
  });
});

test("Ein Mutant, den die Testdatei mit seiner Zeile nicht tötet, überlebt; die anderen Dateien laufen nur einmal ohne ihn", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner);
    assert.deepEqual(mutantLauf(ordner, "2"), { id: "2", ergebnis: "überlebt" });
    assert.deepEqual(ausgefuehrt(ordner), { "test/zwei.test.js": 2, "test/eins.test.js": 1, "test/keins.test.js": 1 });
  });
});

test("Eine Zeile, die keine Testdatei ausführt, überlebt, ohne dass eine Testdatei mit dem Mutanten läuft", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner);
    assert.deepEqual(mutantLauf(ordner, "9"), { id: "9", ergebnis: "überlebt" });
    assert.deepEqual(ausgefuehrt(ordner), { "test/zwei.test.js": 1, "test/eins.test.js": 1, "test/keins.test.js": 1 });
  });
});

test("Die Abdeckung einer Testdatei wird für den nächsten Mutanten wiederverwendet", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner);
    mutantLauf(ordner, "2");
    mutantLauf(ordner, "9");
    assert.deepEqual(ausgefuehrt(ordner), { "test/zwei.test.js": 2, "test/eins.test.js": 1, "test/keins.test.js": 1 });
  });
});

test("Ein Import mit Query oder Hash zählt als dieselbe Datei", () => {
  const skript = (url) => [{ url, functions: [{ ranges: [{ startOffset: 0, endOffset: 99, count: 1 }] }] }];
  const orte = { 1: { datei: "/quelle.mjs", offset: 5 } };
  for (const url of ["file:///quelle.mjs?x", "file:///quelle.mjs#y", "file:///quelle.mjs?x=1#y"]) assert.deepEqual(ausgefuehrteMutanten([skript(url)], orte), ["1"]);
  assert.deepEqual(ausgefuehrteMutanten([skript("file:///quelle.mjs2?x")], orte), []);
});

test("Eine Zeile, die nur ein vom Elternwächter sanft beendeter Kindprozess mit frischer Umgebung ausführt, zählt als ausgeführt", async () => {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-zeilen-"));
  try {
    const quelle = join(ordner, "quelle.mjs");
    writeFileSync(quelle, QUELLE);
    const eintrag = join(ordner, "kind.mjs");
    writeFileSync(eintrag, [`import { starteElternwaechter } from ${JSON.stringify(ELTERNWAECHTER)};`, "starteElternwaechter({ sanft: true });", 'const { eins } = await import("./quelle.mjs?x");', "eins();", 'process.stdout.write("bereit");', "setInterval(() => {}, 1000);", ""].join("\n"));
    const abdeckung = join(ordner, "abdeckung");
    const kind = spawn(process.execPath, [eintrag], { env: { PATH: process.env.PATH, NODE_V8_COVERAGE: abdeckung }, stdio: ["pipe", "pipe", "ignore"] });
    kind.stdout.once("data", () => kind.stdin.end());
    const [code, signal] = await once(kind, "exit");
    assert.equal(signal, null);
    assert.equal(code, 143);
    const prozesse = readdirSync(abdeckung).map((name) => JSON.parse(readFileSync(join(abdeckung, name), "utf8")).result);
    assert.deepEqual(ausgefuehrteMutanten(prozesse, schutzOrte([quelle])), ["1"]);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});
