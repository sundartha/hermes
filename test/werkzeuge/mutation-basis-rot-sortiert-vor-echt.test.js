import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const OBERGRENZE = 300;
const OBERGRENZE_MS = 20_000;
const FRIST_ENDE = 4_102_444_800_000;
const TESTLAUF = [
  'import { appendFileSync } from "node:fs";',
  'appendFileSync("gelaufen.txt", `${process.argv[3]}\\n`);',
  "process.exitCode = 0;",
  "",
].join("\n");

function lesen(datei, wandeln = JSON.parse) {
  return readFileSync(datei, "utf8").trim().split("\n").map((zeile) => wandeln(zeile));
}

test("Ohne Mutant rote Testdateien, die vor den echten sortieren, belegen keinen Platz unter der Testobergrenze", () => {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-basis-rot-"));
  try {
    mkdirSync(join(ordner, "test"));
    writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF);
    const rote = Array.from({ length: OBERGRENZE }, (_, nr) => `test/a-rot-${nr}.test.js`);
    const echte = ["test/echt-a.test.js", "test/echt-b.test.js"];
    const plan = { frist: FRIST_ENDE, testdateiFrist: 300, tests: [...rote, ...echte], dateien: [], eingebettete: {}, abdeckung: {}, protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
    writeFileSync(plan.basisRot, JSON.stringify(rote));
    writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
    spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, timeout: OBERGRENZE_MS, killSignal: "SIGKILL", env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: "1", MUTATION_PLAN: join(ordner, "plan.json") } });
    assert.equal(existsSync(plan.protokoll), true);
    const zeilen = lesen(plan.protokoll);
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0].ergebnis, "überlebt");
    assert.equal(Object.hasOwn(zeilen[0], "gekuerzt"), false);
    const gelaufen = lesen(join(ordner, "gelaufen.txt"), String);
    for (const datei of echte) assert.ok(gelaufen.includes(datei), `${datei} lief nicht`);
    for (const datei of rote) assert.equal(gelaufen.includes(datei), false);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});
