import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const QUELLE = [
  "const stryMutAct_9fa48 = () => false;",
  "const stryCov_9fa48 = () => {};",
  "export function drei() {",
  '  if (stryMutAct_9fa48("3")) {} else {',
  '    stryCov_9fa48("3");',
  '    return "rumpf-merkmal";',
  "  }",
  "}",
  "",
].join("\n");
const TESTLAUF = (kill) => [
  'import { appendFileSync, readFileSync } from "node:fs";',
  "const datei = process.argv[3];",
  'appendFileSync("ausgefuehrt.txt", datei + "\\n");',
  'const quelle = await import("../src/quelle.mjs");',
  "quelle.drei();",
  "const mutant = process.env.__STRYKER_ACTIVE_MUTANT__;",
  'const vierteFruehereDateiGestartet = () => readFileSync("ausgefuehrt.txt", "utf8").split("\\n").filter((name) => name.startsWith("test/a")).length > 3;',
  'if (mutant && datei !== "test/z-treffer.test.js") await new Promise((bisEinUeberzaehligerLaufStartet) => { const takt = setInterval(() => vierteFruehereDateiGestartet() && (clearInterval(takt), bisEinUeberzaehligerLaufStartet()), 10); });',
  `process.exitCode = ${kill} && mutant && datei === "test/z-treffer.test.js" ? 1 : 0;`,
  "",
].join("\n");
const TESTS = [...[1, 2, 3, 4, 5].map((nummer) => `test/a${nummer}.test.js`), "test/z-treffer.test.js"];

function mitAufbau(kill, ablauf) {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-rumpf-"));
  try {
    mkdirSync(join(ordner, "src"));
    mkdirSync(join(ordner, "test"));
    writeFileSync(join(ordner, "src/quelle.mjs"), QUELLE);
    writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF(kill));
    for (const datei of TESTS) writeFileSync(join(ordner, datei), datei.includes("treffer") ? '// prüft "rumpf-merkmal"\n' : "");
    const plan = { frist: 4_102_444_800_000, tests: TESTS, dateien: ["src/quelle.mjs"], eingebettete: {}, abdeckung: {}, protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
    writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
    spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: "3", MUTATION_PLAN: join(ordner, "plan.json") } });
    const { dauer, ...urteil } = JSON.parse(readFileSync(join(ordner, "protokoll.jsonl"), "utf8").trim().split("\n").at(-1));
    assert.equal(typeof dauer, "number");
    const gelaufen = existsSync(join(ordner, "ausgefuehrt.txt")) ? readFileSync(join(ordner, "ausgefuehrt.txt"), "utf8").trim().split("\n") : [];
    return ablauf(urteil, gelaufen);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Der Text im geleerten Funktionsrumpf bestimmt die Reihenfolge: Die Datei mit „rumpf-merkmal“ läuft vor vier früheren Namen", () => {
  mitAufbau(true, (urteil, gelaufen) => {
    assert.deepEqual(urteil, { id: "3", ergebnis: "getötet", test: "test/z-treffer.test.js", laeufe: 5 });
    assert.deepEqual([...new Set(gelaufen)].filter((datei) => !["test/a1.test.js", "test/a2.test.js", "test/a3.test.js"].includes(datei)), ["test/z-treffer.test.js"]);
  });
});

test("Tötet keine erreichende Testdatei den Rumpf-Mutanten, überlebt er und alle erreichenden Dateien sind gelaufen", () => {
  mitAufbau(false, (urteil, gelaufen) => {
    assert.deepEqual(urteil, { id: "3", ergebnis: "überlebt", laeufe: 6 });
    assert.deepEqual([...new Set(gelaufen)].sort(), TESTS);
  });
});
