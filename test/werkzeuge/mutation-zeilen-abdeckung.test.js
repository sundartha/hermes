import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { ausgefuehrteMutanten, offsetVon } from "../../tools/pruefen.mjs";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const QUELLE = ["export function genutzt() {", "  return 1;", "}", "export function ungenutzt() {", "  return 2;", "}", ""].join("\n");
const SCHNELL = 50;

function mitOrdner(ablauf) {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-zeilen-"));
  try {
    return ablauf(ordner);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Ein Mutant gilt als ausgeführt, wenn der Test seine Zeile ausführt, und sonst nicht", () => {
  mitOrdner((ordner) => {
    const quelle = join(ordner, "quelle.mjs");
    writeFileSync(quelle, QUELLE);
    writeFileSync(join(ordner, "test.mjs"), 'import { genutzt } from "./quelle.mjs";\ngenutzt();\n');
    const abdeckung = join(ordner, "abdeckung");
    const lauf = spawnSync(process.execPath, [join(ordner, "test.mjs")], { env: { ...process.env, NODE_V8_COVERAGE: abdeckung } });
    assert.equal(lauf.status, 0);
    const prozesse = readdirSync(abdeckung).map((name) => JSON.parse(readFileSync(join(abdeckung, name), "utf8")).result);
    const mutanten = { 1: { datei: quelle, offset: offsetVon(QUELLE, { line: 2, column: 10 }) }, 2: { datei: quelle, offset: offsetVon(QUELLE, { line: 5, column: 10 }) } };
    assert.deepEqual(ausgefuehrteMutanten(prozesse, mutanten), ["1"]);
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

test("offsetVon zählt Zeilen und Spalten ab 1", () => {
  assert.equal(offsetVon("ab\ncd\n", { line: 1, column: 1 }), 0);
  assert.equal(offsetVon("ab\ncd\n", { line: 2, column: 2 }), 4);
  assert.equal(offsetVon("ab\ncd\n", { line: 2 }), 3);
});

function mutantLauf(ordner, plan, mutant) {
  mkdirSync(join(ordner, "test"), { recursive: true });
  writeFileSync(join(ordner, "test/testbaenke-run.mjs"), 'import { appendFileSync } from "node:fs";\nappendFileSync("ausgefuehrt.txt", process.argv[3] + "\\n");\nprocess.exitCode = process.argv[3] === "test/killer.test.js" && process.env.__STRYKER_ACTIVE_MUTANT__ ? 1 : 0;\n');
  const planDatei = join(ordner, "plan.json");
  const protokoll = join(ordner, "protokoll.jsonl");
  writeFileSync(planDatei, JSON.stringify({ frist: Date.now() + 600_000, protokoll, basisRot: join(ordner, "basis-rot.json"), ...plan }));
  spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, env: { ...process.env, __STRYKER_ACTIVE_MUTANT__: mutant, MUTATION_PLAN: planDatei }, encoding: "utf8" });
  const ausgefuehrt = readdirSync(ordner).includes("ausgefuehrt.txt") ? readFileSync(join(ordner, "ausgefuehrt.txt"), "utf8").trim().split("\n") : [];
  return { ergebnis: JSON.parse(readFileSync(protokoll, "utf8").trim().split("\n").at(-1)), ausgefuehrt };
}

const VIELE = Array.from({ length: SCHNELL + 10 }, (_, nummer) => `test/f${String(nummer).padStart(3, "0")}.test.js`);
const TESTS = ["test/zuerst.test.js", ...VIELE.slice(0, SCHNELL - 1), "test/killer.test.js", "test/danach.test.js", ...VIELE.slice(SCHNELL)];
const ALLE_ABDECKUNG = Object.fromEntries(TESTS.slice(SCHNELL).map((datei) => [datei, []]));

test("Im zweiten Schritt läuft nur die Testdatei, die die Zeile des Mutanten ausführt, und tötet ihn", () => {
  mitOrdner((ordner) => {
    const plan = { tests: TESTS, offen: ["7"], abdeckung: { ...ALLE_ABDECKUNG, "test/killer.test.js": ["7"] }, mutanten: { 7: { datei: "/x.js", offset: 0, alle: false } } };
    const { ergebnis, ausgefuehrt } = mutantLauf(ordner, plan, "7");
    assert.deepEqual(ergebnis, { id: "7", ergebnis: "getötet", test: "test/killer.test.js" });
    assert.deepEqual([...new Set(ausgefuehrt)], ["test/killer.test.js"]);
  });
});

test("Eine Zeile, die keine Testdatei ausführt, überlebt sofort ohne einen Testlauf", () => {
  mitOrdner((ordner) => {
    const plan = { tests: TESTS, offen: ["8"], abdeckung: ALLE_ABDECKUNG, mutanten: { 8: { datei: "/x.js", offset: 0, alle: false } } };
    const { ergebnis, ausgefuehrt } = mutantLauf(ordner, plan, "8");
    assert.deepEqual(ergebnis, { id: "8", ergebnis: "überlebt" });
    assert.deepEqual(ausgefuehrt, []);
  });
});

test("Im ersten Schritt läuft nur der schnelle Anfang; ein Überlebender bleibt offen für den zweiten Schritt", () => {
  mitOrdner((ordner) => {
    const { ergebnis, ausgefuehrt } = mutantLauf(ordner, { tests: TESTS }, "9");
    assert.deepEqual(ergebnis, { id: "9", ergebnis: "offen" });
    assert.equal(new Set(ausgefuehrt).size, SCHNELL);
  });
});

test("Ohne Abdeckung wegen abgelaufener Frist bleibt der Mutant nicht geprüft", () => {
  mitOrdner((ordner) => {
    const plan = { tests: TESTS, offen: ["9"], abdeckung: null, mutanten: {} };
    assert.deepEqual(mutantLauf(ordner, plan, "9").ergebnis, { id: "9", ergebnis: "nicht geprüft (Frist)" });
  });
});
