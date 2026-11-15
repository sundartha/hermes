import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const OBERGRENZE_MS = 20_000;
const ARBEITER = 4;
const DATEIEN = Array.from({ length: ARBEITER + 2 }, (_, nummer) => `test/haengt-${nummer}.test.js`);
const TESTLAUF = [
  'import { writeFileSync } from "node:fs";',
  "const datei = process.argv[3];",
  'if (process.env.__STRYKER_ACTIVE_MUTANT__ === "1") {',
  '  writeFileSync(`pid-${datei.replaceAll("/", "_")}.txt`, String(process.pid));',
  "  setInterval(() => {}, 1000);",
  "} else {",
  "  process.exitCode = 0;",
  "}",
  "",
].join("\n");

const pidDateien = (ordner) => readdirSync(ordner).filter((name) => name.startsWith("pid-"));

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (fehler) {
    return fehler.code === "EPERM";
  }
}

test("Gibt es mehr Testdateien als Arbeiter und hängen alle, nennt der Aufruf an der Frist jede gerade laufende Datei in liefNoch", () => {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-frist-alle-"));
  try {
    mkdirSync(join(ordner, "test"));
    writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF);
    const protokoll = join(ordner, "protokoll.jsonl");
    const plan = { frist: Date.now() + 1500, tests: DATEIEN, dateien: [], eingebettete: {}, abdeckung: {}, protokoll, basisRot: join(ordner, "basis-rot.json") };
    writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
    spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, timeout: OBERGRENZE_MS, killSignal: "SIGKILL", env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: "1", MUTATION_PLAN: join(ordner, "plan.json") } });
    assert.equal(existsSync(protokoll), true, "der Aufruf endet nicht von selbst an der Frist");
    const zeilen = readFileSync(protokoll, "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile));
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0].ergebnis, "nicht geprüft (Frist)");
    assert.equal(pidDateien(ordner).length, ARBEITER, "mehr Dateien als Arbeiter: nur so viele laufen gleichzeitig");
    const genannt = zeilen[0].liefNoch.map(({ datei }) => datei);
    assert.equal(genannt.length, ARBEITER);
    assert.equal(new Set(genannt).size, ARBEITER);
    for (const datei of genannt) assert.ok(existsSync(join(ordner, `pid-${datei.replaceAll("/", "_")}.txt`)), `${datei} wurde nie gestartet`);
    for (const name of pidDateien(ordner)) assert.equal(lebt(Number(readFileSync(join(ordner, name), "utf8"))), false);
  } finally {
    for (const name of pidDateien(ordner)) {
      const pid = Number(readFileSync(join(ordner, name), "utf8"));
      if (pid > 0 && lebt(pid)) process.kill(pid, "SIGKILL");
    }
    rmSync(ordner, { recursive: true, force: true });
  }
});
