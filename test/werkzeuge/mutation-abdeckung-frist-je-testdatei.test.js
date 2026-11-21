import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const TESTLAUF = [
  'import { writeFileSync } from "node:fs";',
  "const datei = process.argv[3];",
  'if (datei === "test/haengt.test.js") {',
  '  writeFileSync("haengender-prozess.txt", String(process.pid));',
  "  setInterval(() => {}, 1000);",
  "} else {",
  "  process.exitCode = 0;",
  "}",
  "",
].join("\n");

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (fehler) {
    return fehler.code === "EPERM";
  }
}

test("Hängt beim Zählen der Abdeckung eine Testdatei, bricht ihre eigene Frist sie ab, sie gilt als ohne Abdeckung und die übrigen werden gemessen", () => {
  const ordner = mkdtempSync(join(tmpdir(), "abdeckung-frist-"));
  try {
    mkdirSync(join(ordner, "test"));
    writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF);
    const plan = { frist: 4_102_444_800_000, testdateiFrist: 300, tests: ["test/haengt.test.js", "test/gut.test.js"], dateien: [], eingebettete: {}, abdeckung: {}, protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
    writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
    const ergebnis = spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL", env: { ...process.env, TEIL: "0", TEILE: "1", MUTANTEN_ZAEHLEN: "1", MUTATION_ABDECKUNG: join(ordner, "abdeckung"), MUTATION_PLAN: join(ordner, "plan.json") } });
    const ausgabe = `${ergebnis.stdout}${ergebnis.stderr}`;
    assert.equal(ergebnis.status, 0, ausgabe);
    assert.match(ergebnis.stderr, /^test\/haengt\.test\.js \d+ s$/m);
    assert.equal(ergebnis.stderr.includes("gut.test.js"), false);
    assert.deepEqual(JSON.parse(readFileSync(join(ordner, "abdeckung/0.json"), "utf8")), { "test/haengt.test.js": null, "test/gut.test.js": [] });
    assert.equal(lebt(Number(readFileSync(join(ordner, "haengender-prozess.txt"), "utf8"))), false);
    assert.equal(existsSync(join(ordner, "abdeckung/0.json")), true);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
});
