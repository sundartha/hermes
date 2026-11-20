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
  const plan = { frist: Date.now() + 15_000, testdateiFrist: 300, tests: ["test/haengt.test.js"], dateien: [], eingebettete: {}, abdeckung: {}, protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
  writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
  spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, timeout: OBERGRENZE_MS, killSignal: "SIGKILL", env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: "1", MUTATION_PLAN: join(ordner, "plan.json") } });
  const protokoll = join(ordner, "protokoll.jsonl");
  assert.equal(existsSync(protokoll), true, "der Aufruf endet nicht von selbst an der eigenen Testdatei-Frist");
  return readFileSync(protokoll, "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile));
}

test("Hängt unter dem Mutanten eine Testdatei, aber läuft sie ohne Mutant grün, gilt der Mutant als von genau dieser Datei getötet, nicht als „nicht geprüft (Frist)“", () => {
  mitOrdner((ordner) => {
    const zeilen = haengenderLauf(ordner);
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0].id, "1");
    assert.equal(zeilen[0].ergebnis, "getötet");
    assert.equal(zeilen[0].test, "test/haengt.test.js");
    assert.equal(Object.hasOwn(zeilen[0], "liefNoch"), false);
  });
});

test("Nach dem Aufruf läuft der hängende Testlauf nicht mehr", () => {
  mitOrdner((ordner) => {
    haengenderLauf(ordner);
    const pid = Number(readFileSync(join(ordner, "haengender-prozess.txt"), "utf8"));
    assert.equal(lebt(pid), false);
  });
});

const BASIS_HAENGT_TESTLAUF = [
  'import { writeFileSync } from "node:fs";',
  "const datei = process.argv[3];",
  'if (datei === "test/haengt-auch-ohne-mutant.test.js") {',
  '  writeFileSync("haengender-prozess.txt", String(process.pid));',
  "  setInterval(() => {}, 1000);",
  "} else {",
  "  process.exitCode = 0;",
  "}",
  "",
].join("\n");

function basisHaengtLauf(ordner) {
  mkdirSync(join(ordner, "test"));
  writeFileSync(join(ordner, "test/testbaenke-run.mjs"), BASIS_HAENGT_TESTLAUF);
  const plan = { frist: Date.now() + 3000, testdateiFrist: 300, tests: ["test/haengt-auch-ohne-mutant.test.js"], dateien: [], eingebettete: {}, abdeckung: {}, protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
  writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
  spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, timeout: OBERGRENZE_MS, killSignal: "SIGKILL", env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: "1", MUTATION_PLAN: join(ordner, "plan.json") } });
  const protokoll = join(ordner, "protokoll.jsonl");
  assert.equal(existsSync(protokoll), true, "der Aufruf endet nicht von selbst an der Gesamtfrist");
  return readFileSync(protokoll, "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile));
}

test("Hängt eine Testdatei auch ohne Mutant (Basis), bleibt das sichtbar „nicht geprüft (Frist)“, nennt die Datei mit ihrer Laufzeit als liefNoch und gilt nicht als getötet", () => {
  mitOrdner((ordner) => {
    const zeilen = basisHaengtLauf(ordner);
    assert.equal(zeilen.length, 1);
    assert.equal(zeilen[0].ergebnis, "nicht geprüft (Frist)");
    assert.notEqual(zeilen[0].ergebnis, "getötet");
    assert.equal(Object.hasOwn(zeilen[0], "test"), false);
    const { liefNoch } = zeilen[0];
    assert.equal(liefNoch.length, 1);
    const [{ datei, sekunden }] = liefNoch;
    assert.equal(datei, "test/haengt-auch-ohne-mutant.test.js");
    assert.equal(Number.isInteger(sekunden), true);
    assert.ok(sekunden >= 0 && sekunden <= 5);
  });
});

const LAST_TIMEOUT_TESTLAUF = [
  'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
  "const datei = process.argv[3];",
  'const zaehlerDatei = "aufrufe.json";',
  'const aufrufe = existsSync(zaehlerDatei) ? JSON.parse(readFileSync(zaehlerDatei, "utf8")) : {};',
  "aufrufe[datei] = (aufrufe[datei] ?? 0) + 1;",
  "writeFileSync(zaehlerDatei, JSON.stringify(aufrufe));",
  'if (datei === "test/haengt.test.js" && process.env.__STRYKER_ACTIVE_MUTANT__ === "1" && aufrufe[datei] === 1) {',
  '  writeFileSync("haengender-prozess.txt", String(process.pid));',
  "  setInterval(() => {}, 1000);",
  "} else {",
  "  process.exitCode = 0;",
  "}",
  "",
].join("\n");

function lastTimeoutLauf(ordner) {
  mkdirSync(join(ordner, "test"));
  writeFileSync(join(ordner, "test/testbaenke-run.mjs"), LAST_TIMEOUT_TESTLAUF);
  const plan = { frist: Date.now() + 15_000, testdateiFrist: 300, tests: ["test/haengt.test.js"], dateien: [], eingebettete: {}, abdeckung: {}, protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
  writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
  spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, timeout: OBERGRENZE_MS, killSignal: "SIGKILL", env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: "1", MUTATION_PLAN: join(ordner, "plan.json") } });
  const protokoll = join(ordner, "protokoll.jsonl");
  assert.equal(existsSync(protokoll), true, "der Aufruf endet nicht von selbst an der Gesamtfrist");
  return readFileSync(protokoll, "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile));
}

test("Hängt eine Testdatei beim ersten Mutant-Lauf nur wegen Last, läuft derselbe Lauf bei der Bestätigung grün, gilt der Mutant nicht als von dieser Datei getötet", () => {
  mitOrdner((ordner) => {
    const zeilen = lastTimeoutLauf(ordner);
    assert.equal(zeilen.length, 1);
    assert.notEqual(zeilen[0].ergebnis, "getötet");
    assert.equal(Object.hasOwn(zeilen[0], "test"), false);
  });
});

test("Die Zusammenfassung nennt jede Testdatei aus liefNoch mit Laufzeit in der Zeile des Mutanten, und eine Begründung im PR-Text macht sie nicht grün", () => {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-haengt-urteil-"));
  const zusammenfassung = join(ordner, "zusammenfassung.md");
  const vorher = { PR_TEXT: process.env.PR_TEXT, GITHUB_STEP_SUMMARY: process.env.GITHUB_STEP_SUMMARY };
  process.env.PR_TEXT = "## Überlebende Mutanten\n\n- `src/quelle.mjs:3/1`: äquivalent, der Text ändert nur die Anzeige und kein Ergebnis\n";
  process.env.GITHUB_STEP_SUMMARY = zusammenfassung;
  try {
    const mutant = { schluessel: "src/quelle.mjs:3/1", mutation: "StringLiteral: \"\"", ergebnis: "nicht geprüft (Frist)", liefNoch: [{ datei: "test/a.test.js", sekunden: 1234 }, { datei: "test/b.test.js", sekunden: 7 }] };
    assert.equal(mutationUrteil([mutant], 1), false);
    const zeile = readFileSync(zusammenfassung, "utf8").split("\n").find((text) => text.includes("src/quelle.mjs:3/1`"));
    assert.ok(zeile.includes("| nicht geprüft (Frist), lief noch: test/a.test.js 1234 s, test/b.test.js 7 s | – |"));
    assert.equal(zeile.includes("hängt"), false);
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

const ABDECKUNG_TESTLAUF = [
  'import { writeFileSync } from "node:fs";',
  "const datei = process.argv[3];",
  'if (datei === "test/haengt.test.js") {',
  '  writeFileSync("haengender-abdeckung.txt", String(process.pid));',
  "  setInterval(() => {}, 1000);",
  "} else {",
  "  process.exitCode = 0;",
  "}",
  "",
].join("\n");

function abdeckungLauf(ordner, tests) {
  mkdirSync(join(ordner, "test"));
  writeFileSync(join(ordner, "test/testbaenke-run.mjs"), ABDECKUNG_TESTLAUF);
  const plan = { frist: Date.now() + 1500, tests, dateien: [], eingebettete: {}, abdeckung: {}, protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
  writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
  const ergebnis = spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, encoding: "utf8", timeout: OBERGRENZE_MS, killSignal: "SIGKILL", env: { ...process.env, TEIL: "0", TEILE: "1", MUTANTEN_ZAEHLEN: "1", MUTATION_ABDECKUNG: join(ordner, "abdeckung"), MUTATION_PLAN: join(ordner, "plan.json") } });
  return { ergebnis, ausgabe: `${ergebnis.stdout}${ergebnis.stderr}` };
}

test("Hängt beim Zählen der Abdeckung eine Testdatei, nennt das Protokoll sie mit Laufzeit, der Prozess endet rot und der hängende Lauf ist beendet", () => {
  mitOrdner((ordner) => {
    const { ergebnis, ausgabe } = abdeckungLauf(ordner, ["test/haengt.test.js", "test/gut.test.js"]);
    assert.equal(ergebnis.status, 1, ausgabe);
    assert.match(ausgabe, /^test\/haengt\.test\.js \d+ s$/m);
    assert.equal(ausgabe.includes("gut.test.js"), false);
    const pid = Number(readFileSync(join(ordner, "haengender-abdeckung.txt"), "utf8"));
    assert.equal(lebt(pid), false);
    assert.equal(existsSync(join(ordner, "abdeckung")), false);
  });
});

test("Ohne hängende Testdatei endet das Zählen der Abdeckung grün und schreibt die Abdeckungsdatei", () => {
  mitOrdner((ordner) => {
    const { ergebnis, ausgabe } = abdeckungLauf(ordner, ["test/gut.test.js"]);
    assert.equal(ergebnis.status, 0, ausgabe);
    assert.equal(ausgabe, "");
    assert.deepEqual(JSON.parse(readFileSync(join(ordner, "abdeckung/0.json"), "utf8")), { "test/gut.test.js": [] });
  });
});
