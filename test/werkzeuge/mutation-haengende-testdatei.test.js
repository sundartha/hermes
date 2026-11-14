import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { mutationUrteil } from "../../tools/pruefen.mjs";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const OBERGRENZE_MS = 20_000;
const TESTLAUF = [
  'import { writeFileSync } from "node:fs";',
  "const datei = process.argv[3];",
  'if (datei === "test/haengt.test.js" && process.env.__STRYKER_ACTIVE_MUTANT__ === "1") {',
  '  writeFileSync("haengender-prozess.txt", String(process.pid));',
  "  setInterval(() => {}, 1000);",
  "} else {",
  "  process.exitCode = 0;",
  "}",
  "",
].join("\n");

function mitOrdner(ablauf) {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-haengt-"));
  try {
    return ablauf(ordner);
  } finally {
    const pid = existsSync(join(ordner, "haengender-prozess.txt")) ? Number(readFileSync(join(ordner, "haengender-prozess.txt"), "utf8")) : 0;
    if (pid > 0 && lebt(pid)) process.kill(pid, "SIGKILL");
    rmSync(ordner, { recursive: true, force: true });
  }
}

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (fehler) {
    return fehler.code === "EPERM";
  }
}

function haengenderLauf(ordner) {
  mkdirSync(join(ordner, "test"));
  writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF);
  const plan = { frist: Date.now() + 1500, tests: ["test/haengt.test.js"], dateien: [], eingebettete: {}, abdeckung: {}, protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
  writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
  spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, timeout: OBERGRENZE_MS, killSignal: "SIGKILL", env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: "1", MUTATION_PLAN: join(ordner, "plan.json") } });
  const protokoll = join(ordner, "protokoll.jsonl");
  assert.equal(existsSync(protokoll), true, "der Aufruf endet nicht von selbst an der Frist");
  return readFileSync(protokoll, "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile));
}

test("Hängt unter dem Mutanten eine Testdatei, endet der Aufruf an der Frist mit genau einer Zeile „nicht geprüft (Frist)“, die die Datei als haengt nennt", () => {
  mitOrdner((ordner) => {
    const zeilen = haengenderLauf(ordner);
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0].id, "1");
    assert.equal(zeilen[0].ergebnis, "nicht geprüft (Frist)");
    assert.deepEqual(zeilen[0].haengt, ["test/haengt.test.js"]);
  });
});

test("Die Zeile des hängenden Mutanten hat kein Feld test, obwohl dieselbe Testdatei ohne Mutant grün ist", () => {
  mitOrdner((ordner) => {
    const [zeile] = haengenderLauf(ordner);
    assert.equal(Object.hasOwn(zeile, "test"), false);
    assert.notEqual(zeile.ergebnis, "getötet");
  });
});

test("Nach dem Aufruf läuft der hängende Testlauf nicht mehr", () => {
  mitOrdner((ordner) => {
    haengenderLauf(ordner);
    const pid = Number(readFileSync(join(ordner, "haengender-prozess.txt"), "utf8"));
    assert.equal(lebt(pid), false);
  });
});

test("Die Zusammenfassung nennt die hängende Testdatei in der Zeile des Mutanten, und eine Begründung im PR-Text macht sie nicht grün", () => {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-haengt-urteil-"));
  const zusammenfassung = join(ordner, "zusammenfassung.md");
  const vorher = { PR_TEXT: process.env.PR_TEXT, GITHUB_STEP_SUMMARY: process.env.GITHUB_STEP_SUMMARY };
  process.env.PR_TEXT = "## Überlebende Mutanten\n\n- `src/quelle.mjs:3/1`: äquivalent, der Text ändert nur die Anzeige und kein Ergebnis\n";
  process.env.GITHUB_STEP_SUMMARY = zusammenfassung;
  try {
    const mutant = { schluessel: "src/quelle.mjs:3/1", mutation: "StringLiteral: \"\"", ergebnis: "nicht geprüft (Frist)", haengt: ["test/a.test.js", "test/b.test.js"] };
    assert.equal(mutationUrteil([mutant], 1), false);
    const zeile = readFileSync(zusammenfassung, "utf8").split("\n").find((text) => text.includes("src/quelle.mjs:3/1`"));
    assert.match(zeile, /nicht geprüft \(Frist\), hängt: test\/a\.test\.js test\/b\.test\.js \|/);
  } finally {
    for (const [name, wert] of Object.entries(vorher)) {
      if (wert === undefined) delete process.env[name];
      else process.env[name] = wert;
    }
    rmSync(ordner, { recursive: true, force: true });
  }
});

test("Ohne hängende Testdatei bleibt die Zeile der Tabelle ohne Zusatz", () => {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-haengt-urteil-"));
  const zusammenfassung = join(ordner, "zusammenfassung.md");
  const vorher = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = zusammenfassung;
  try {
    mutationUrteil([{ schluessel: "src/quelle.mjs:3/1", mutation: "StringLiteral: \"\"", ergebnis: "nicht geprüft (Frist)" }], 1);
    assert.match(readFileSync(zusammenfassung, "utf8"), /\| nicht geprüft \(Frist\) \| – \|/);
  } finally {
    if (vorher === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = vorher;
    rmSync(ordner, { recursive: true, force: true });
  }
});
