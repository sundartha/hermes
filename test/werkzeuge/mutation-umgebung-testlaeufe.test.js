import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");

const TESTLAUF = [
  'import { existsSync, writeFileSync } from "node:fs";',
  'import { spawnSync } from "node:child_process";',
  "const datei = process.argv[3];",
  `const PRUEFEN = ${JSON.stringify(PRUEFEN)};`,
  'if (datei === "test/startet-pruefen.test.js") {',
  '  writeFileSync("innerer-plan.json", JSON.stringify({ frist: Date.now() + 600_000, tests: [], dateien: [], protokoll: "inneres-protokoll.jsonl", basisRot: "innere-basis-rot.json" }));',
  '  spawnSync("node", [PRUEFEN, "mutant"], { env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: "1", MUTATION_PLAN: "innerer-plan.json" } });',
  '  process.exitCode = existsSync("inneres-protokoll.jsonl") ? 0 : 1;',
  '} else if (datei === "test/echt-rot.test.js") {',
  "  process.exitCode = 1;",
  "} else {",
  "  process.exitCode = 0;",
  "}",
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

function aufbauen(ordner, tests) {
  mkdirSync(join(ordner, "test"), { recursive: true });
  writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF);
  writeFileSync(join(ordner, "plan.json"), JSON.stringify({ dateien: [], tests, eingebettete: {} }));
}

function abdeckungLauf(ordner) {
  const abdeckung = join(ordner, "abdeckung");
  spawnSync("node", [PRUEFEN, "mutant"], {
    cwd: ordner,
    env: { ...process.env, TEIL: "0", TEILE: "1", MUTATION_ABDECKUNG: abdeckung, MUTATION_PLAN: join(ordner, "plan.json"), MUTANTEN_ZAEHLEN: "1" },
  });
  return JSON.parse(readFileSync(join(abdeckung, "0.json"), "utf8"));
}

test("Eine Testdatei, die selbst tools/pruefen.mjs startet, bekommt in der Abdeckungsmessung kein null durch geerbte Werkzeug-Steuervariablen", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner, ["test/startet-pruefen.test.js"]);
    const abdeckung = abdeckungLauf(ordner);
    assert.notEqual(abdeckung["test/startet-pruefen.test.js"], null);
  });
});

test("Eine wirklich rote Testdatei bekommt in der Abdeckungsmessung weiterhin null", () => {
  mitOrdner((ordner) => {
    aufbauen(ordner, ["test/echt-rot.test.js"]);
    const abdeckung = abdeckungLauf(ordner);
    assert.equal(abdeckung["test/echt-rot.test.js"], null);
  });
});
