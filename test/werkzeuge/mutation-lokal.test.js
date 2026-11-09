import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const AUSFUEHRBAR = 0o755;
const QUELLE = "src/probe.js";
const NICHT_VERERBEN = new Set(["TEIL", "TEILE", "PR_TEXT", "GITHUB_STEP_SUMMARY"]);
const ALLE_GETOETET = ["getötet", "getötet"];
const EINER_LEBT = ["getötet", "überlebt", "getötet"];
const BILANZ = /\d+ Mutanten, \d+ getötet, \d+ überlebt/;
const TESTLAEUFE = ["a", "b", "c", "d", "e", "f"].map((name) => `test/${name}.test.js`);
const LOKAL_HOECHSTENS = 2;

const STRYKER_ATTRAPPE = [
  'import { appendFileSync, readFileSync, writeFileSync } from "node:fs";',
  'const konfiguration = JSON.parse(readFileSync(process.argv[4], "utf8"));',
  'const plan = JSON.parse(readFileSync(process.env.MUTATION_PLAN, "utf8"));',
  'const ergebnisse = JSON.parse(readFileSync(process.env.PROBE_ERGEBNISSE, "utf8"));',
  'writeFileSync(process.env.PROBE_KONFIGURATION, JSON.stringify(konfiguration));',
  'const mutants = ergebnisse.map((ergebnis, index) => ({ id: String(index), mutatorName: "BooleanLiteral", replacement: "false", location: { start: { line: index + 1 } } }));',
  'for (const [id, ergebnis] of ergebnisse.entries()) appendFileSync(plan.protokoll, JSON.stringify({ id: String(id), ergebnis }) + "\\n");',
  'writeFileSync(konfiguration.jsonReporter.fileName, JSON.stringify({ files: { "src/probe.js": { mutants } } }));',
  "",
].join("\n");

const GESCHWISTER_ZAEHLEN = [
  'import { execFileSync } from "node:child_process";',
  'import { appendFileSync } from "node:fs";',
  'const zeilen = execFileSync("ps", ["-A", "-o", "ppid="], { encoding: "utf8" }).split("\\n");',
  'const geschwister = zeilen.filter((zeile) => Number(zeile) === process.ppid).length;',
  'appendFileSync("geschwister.txt", String(geschwister) + "\\n");',
  "",
].join("\n");

function umgebung(zusatz) {
  const eintraege = Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !NICHT_VERERBEN.has(name));
  return { ...Object.fromEntries(eintraege), ...zusatz };
}

function imRepo(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: umgebung({}), encoding: "utf8" }).trim();
}

function programm(pfad, zeilen) {
  writeFileSync(pfad, ["#!/bin/sh", ...zeilen, ""].join("\n"));
  chmodSync(pfad, AUSFUEHRBAR);
}

function legeAn(ordner, pfad, inhalt) {
  mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
  writeFileSync(join(ordner, pfad), inhalt);
}

function baueProbe(arbeit) {
  const ordner = join(arbeit, "repo");
  const attrappen = join(arbeit, "bin");
  mkdirSync(ordner);
  mkdirSync(attrappen);
  imRepo(ordner, "init", "-q");
  legeAn(ordner, QUELLE, "export const eins = 1;\nexport const zwei = 2;\n");
  legeAn(ordner, "test/probe.test.js", 'import "../src/probe.js";\n');
  imRepo(ordner, "add", "--", ".");
  imRepo(ordner, "commit", "-q", "-m", "basis");
  const graph = { modules: [{ source: "test/probe.test.js", dependencies: [{ resolved: QUELLE }] }], summary: { violations: [] } };
  mkdirSync(join(ordner, "node_modules/.bin"), { recursive: true });
  programm(join(ordner, "node_modules/.bin/depcruise"), [`printf '%s' '${JSON.stringify(graph)}'`]);
  writeFileSync(join(arbeit, "stryker.mjs"), STRYKER_ATTRAPPE);
  programm(join(attrappen, "npx"), [`node "${join(arbeit, "stryker.mjs")}" "$@"`]);
  return { arbeit, ordner, attrappen, basis: imRepo(ordner, "rev-parse", "HEAD") };
}

function mitProbe(ablauf) {
  const arbeit = mkdtempSync(join(tmpdir(), "mutation-lokal-"));
  try {
    return ablauf(baueProbe(arbeit));
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
}

function aendereQuelle({ ordner }) {
  writeFileSync(join(ordner, QUELLE), "export const eins = 1;\nexport const zwei = 3;\n");
}

function mutationsLauf({ arbeit, ordner, attrappen, basis }, ergebnisse, zusatz = {}) {
  const ablage = join(arbeit, "ergebnisse.json");
  writeFileSync(ablage, JSON.stringify(ergebnisse));
  const konfiguration = join(arbeit, "konfiguration.json");
  const lauf = spawnSync("node", [PRUEFEN, "mutation", "--basis", basis], {
    cwd: ordner,
    env: umgebung({ PATH: `${attrappen}:${process.env.PATH}`, PROBE_ERGEBNISSE: ablage, PROBE_KONFIGURATION: konfiguration, ...zusatz }),
    encoding: "utf8",
  });
  return { exit: lauf.status, text: lauf.stdout + lauf.stderr, konfiguration };
}

function letzteZeilen(text) {
  return text.trimEnd().split("\n").slice(-2);
}

function begruendungFuer(schluessel) {
  return `## Überlebende Mutanten\n\n\`${schluessel}\`: gleichwertig, weil beide Werte im Vertrag dieselbe Wirkung haben\n`;
}

function gleichzeitigeTestlaeufe({ ordner, basis }, zusatz) {
  legeAn(ordner, "test/testbaenke-run.mjs", GESCHWISTER_ZAEHLEN);
  const protokoll = join(ordner, "protokoll.jsonl");
  const plan = join(ordner, "plan.json");
  writeFileSync(plan, JSON.stringify({ frist: Date.now() + 600_000, tests: TESTLAEUFE, protokoll, basisRot: join(ordner, "basis-rot.json") }));
  const lauf = spawnSync("node", [PRUEFEN, "mutant", "--basis", basis], {
    cwd: ordner,
    env: umgebung({ __STRYKER_ACTIVE_MUTANT__: "3", MUTATION_PLAN: plan, ...zusatz }),
    encoding: "utf8",
  });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return readFileSync(join(ordner, "geschwister.txt"), "utf8").trim().split("\n").map(Number);
}

test("Lokal endet die Mutation mit Bilanz und nennt den Überlebenden mit Stelle und Mutator", () => {
  mitProbe((probe) => {
    aendereQuelle(probe);
    const { exit, text } = mutationsLauf(probe, EINER_LEBT);
    assert.deepEqual(letzteZeilen(text), ["3 Mutanten, 2 getötet, 1 überlebt", 'src/probe.js:2/1 BooleanLiteral: false → überlebt']);
    assert.doesNotMatch(text, /NaN|0 von 0/);
    assert.equal(exit, 1);
  });
});

test("Lokal ist ein Lauf mit nur getöteten Mutanten grün und meldet null Überlebende", () => {
  mitProbe((probe) => {
    aendereQuelle(probe);
    const { exit, text } = mutationsLauf(probe, ALLE_GETOETET);
    assert.match(text, /^2 Mutanten, 2 getötet, 0 überlebt$/m);
    assert.equal(exit, 0);
  });
});

test("Lokal ohne geänderte src-Zeilen meldet der Lauf, dass es nichts zu mutieren gibt", () => {
  mitProbe((probe) => {
    const { exit, text } = mutationsLauf(probe, []);
    assert.match(text, /keine geänderten src-Zeilen, nichts zu mutieren/);
    assert.doesNotMatch(text, /NaN/);
    assert.equal(exit, 0);
  });
});

test("Lokal entschuldigt eine Begründung im PR-Text keinen Überlebenden", () => {
  mitProbe((probe) => {
    aendereQuelle(probe);
    const { exit, text } = mutationsLauf(probe, EINER_LEBT, { PR_TEXT: begruendungFuer("src/probe.js:2/1") });
    assert.match(text, /^3 Mutanten, 2 getötet, 1 überlebt$/m);
    assert.equal(exit, 1);
  });
});

test("Lokal bekommt Stryker nur die geänderten Zeilen und arbeitet einzeln", () => {
  mitProbe((probe) => {
    aendereQuelle(probe);
    const { konfiguration } = mutationsLauf(probe, ALLE_GETOETET);
    const stryker = JSON.parse(readFileSync(konfiguration, "utf8"));
    assert.deepEqual(stryker.mutate, ["src/probe.js:2-2"]);
    assert.equal(stryker.concurrency, 1);
  });
});

test("Lokal laufen höchstens zwei Testprozesse gleichzeitig", () => {
  mitProbe((probe) => {
    const beobachtet = gleichzeitigeTestlaeufe(probe, {});
    assert.equal(beobachtet.length, TESTLAEUFE.length);
    assert.ok(Math.max(...beobachtet) <= LOKAL_HOECHSTENS, `gleichzeitig: ${beobachtet.join(",")}`);
  });
});

test("In der CI bleiben vier parallele Testprozesse erhalten", () => {
  mitProbe((probe) => {
    const beobachtet = gleichzeitigeTestlaeufe(probe, { TEIL: "0", TEILE: "1" });
    assert.ok(Math.max(...beobachtet) > LOKAL_HOECHSTENS, `gleichzeitig: ${beobachtet.join(",")}`);
  });
});

test("In der CI gilt die Begründung im PR-Text weiter und die lokale Bilanz fehlt", () => {
  mitProbe((probe) => {
    aendereQuelle(probe);
    const { exit, text } = mutationsLauf(probe, ["überlebt"], { TEIL: "0", TEILE: "20", PR_TEXT: begruendungFuer("src/probe.js:1/0") });
    assert.match(text, /### Mutation 1\/20 auf den geänderten Zeilen/);
    assert.doesNotMatch(text, BILANZ);
    assert.equal(exit, 0);
  });
});
