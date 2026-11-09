import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const GEPRUEFTE_STEUERUNG = ["MUTATION_PLAN", "MUTANTEN_ZAEHLEN", "TEIL", "TEILE"];
const TESTLAUF = [
  'import { writeFileSync } from "node:fs";',
  `const geprueft = ${JSON.stringify(GEPRUEFTE_STEUERUNG)};`,
  'writeFileSync("gesehen.json", JSON.stringify(geprueft.filter((name) => name in process.env)));',
  "process.exitCode = 0;",
  "",
].join("\n");

function mitOrdner(ablauf) {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-umgebung-"));
  try {
    return ablauf(ordner);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function aufbauen(ordner) {
  mkdirSync(join(ordner, "test"), { recursive: true });
  writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF);
  const plan = { frist: Date.now() + 600_000, tests: ["test/sonde.test.js"], dateien: [], protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
  writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
}

function mutantLaufMitFremderSteuerung(ordner) {
  spawnSync("node", [PRUEFEN, "mutant"], {
    cwd: ordner,
    env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: "1", MUTATION_PLAN: join(ordner, "plan.json") },
  });
  return JSON.parse(readFileSync(join(ordner, "gesehen.json"), "utf8"));
}

test("Die von testdateiGruen gestartete Testdatei bekommt keine der Werkzeug-Steuervariablen, auch wenn der eigene Mutantenlauf sie braucht", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner);
    assert.deepEqual(mutantLaufMitFremderSteuerung(ordner), []);
  });
});
