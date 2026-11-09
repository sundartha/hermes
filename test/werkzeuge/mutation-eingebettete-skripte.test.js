import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const AUSFUEHRBAR = 0o755;
const KATALOG = [
  'export const eingebettet = new URL("./eingebettet.js", import.meta.url);',
  'export const fremd = new URL("./fremd.js", "https://beispiel.invalid/");',
  "",
].join("\n");
const BERICHT_SCHREIBER = [
  'import { readFileSync, writeFileSync } from "node:fs";',
  "const konfiguration = JSON.parse(readFileSync(process.argv[4], 'utf8'));",
  "const mutant = { id: '4', mutatorName: 'BooleanLiteral', replacement: 'false', location: { start: { line: 1 } } };",
  "writeFileSync(konfiguration.jsonReporter.fileName, JSON.stringify({ files: { 'src/ui/eingebettet.js': { mutants: [mutant] } } }));",
  "",
].join("\n");

function umgebungOhneGit(zusatz) {
  const eintraege = Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && name !== "TEIL" && name !== "TEILE");
  return { ...Object.fromEntries(eintraege), ...zusatz };
}

function imRepo(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: umgebungOhneGit({}), encoding: "utf8" }).trim();
}

function legeAn(ordner, pfad, inhalt) {
  mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
  writeFileSync(join(ordner, pfad), inhalt);
}

function programm(pfad, zeilen) {
  writeFileSync(pfad, ["#!/bin/sh", ...zeilen, ""].join("\n"));
  chmodSync(pfad, AUSFUEHRBAR);
}

function baueProbe(arbeit) {
  const ordner = join(arbeit, "repo");
  const attrappen = join(arbeit, "bin");
  mkdirSync(ordner);
  mkdirSync(attrappen);
  imRepo(ordner, "init", "-q");
  legeAn(ordner, "src/ui/katalog.js", KATALOG);
  legeAn(ordner, "src/ui/eingebettet.js", "globalThis.a = 1;\n");
  legeAn(ordner, "src/ui/fremd.js", "globalThis.b = 1;\n");
  legeAn(ordner, "test/katalog.test.js", 'import "./helfer.js";\n');
  imRepo(ordner, "add", "--", ".");
  imRepo(ordner, "commit", "-q", "-m", "basis");
  const graph = { modules: [{ source: "test/katalog.test.js", dependencies: [{ resolved: "src/ui/katalog.js" }] }], summary: { violations: [] } };
  mkdirSync(join(ordner, "node_modules/.bin"), { recursive: true });
  programm(join(ordner, "node_modules/.bin/depcruise"), [`printf '%s' '${JSON.stringify(graph)}'`]);
  writeFileSync(join(arbeit, "bericht.mjs"), BERICHT_SCHREIBER);
  programm(join(attrappen, "npx"), [`node "${join(arbeit, "bericht.mjs")}" "$@"`]);
  return { ordner, basis: imRepo(ordner, "rev-parse", "HEAD"), attrappen };
}

function mutationsLauf({ ordner, basis, attrappen }, zusatz = {}) {
  const ergebnis = spawnSync("node", [PRUEFEN, "mutation", "--basis", basis], {
    cwd: ordner,
    env: umgebungOhneGit({ PATH: `${attrappen}:${process.env.PATH}`, ...zusatz }),
    encoding: "utf8",
  });
  return { gruen: ergebnis.status === 0, text: ergebnis.stdout + ergebnis.stderr };
}

function mitProbe(ablauf) {
  const arbeit = mkdtempSync(join(tmpdir(), "mutation-einbettung-"));
  try {
    return ablauf(baueProbe(arbeit));
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
}

function aendere(probe, pfad) {
  writeFileSync(join(probe.ordner, pfad), "globalThis.geaendert = 2;\n");
}

test("Tests des Katalogs erreichen ein Skript, das er über import.meta.url einbettet", () => {
  mitProbe((probe) => {
    aendere(probe, "src/ui/eingebettet.js");
    const { text } = mutationsLauf(probe);
    assert.match(text, /src\/ui\/eingebettet\.js:1-1: 1 Testdateien erreichen den Code, zuerst test\/katalog\.test\.js/);
  });
});

test("Ein URL-Verweis ohne import.meta.url macht eine Datei nicht erreichbar", () => {
  mitProbe((probe) => {
    aendere(probe, "src/ui/fremd.js");
    const { text } = mutationsLauf(probe);
    assert.match(text, /src\/ui\/fremd\.js:1-1: 0 Testdateien erreichen den Code/);
  });
});

test("Ohne Teilangabe zählt der Lauf jeden Mutanten als ein einziger Teil", () => {
  mitProbe((probe) => {
    aendere(probe, "src/ui/eingebettet.js");
    const { text, gruen } = mutationsLauf(probe);
    assert.match(text, /### Mutation 1\/1 auf den geänderten Zeilen/);
    assert.match(text, /0 von 1 Mutanten getötet, 1 von 1 übrigen ohne Begründung/);
    assert.doesNotMatch(text, /NaN/);
    assert.equal(gruen, false);
  });
});

test("Ein Lauf ohne geänderte Zeilen meldet sich als leer und nennt keine Zählung", () => {
  mitProbe((probe) => {
    const { text, gruen } = mutationsLauf(probe);
    assert.match(text, /Leerer Lauf: keine Mutanten auf geänderten Zeilen unter src\/, nichts geprüft\./);
    assert.doesNotMatch(text, /0 von 0|NaN/);
    assert.equal(gruen, true);
  });
});

test("Ein leerer Teil nennt seine Nummer aus der CI-Angabe", () => {
  mitProbe((probe) => {
    const { text } = mutationsLauf(probe, { TEIL: "1", TEILE: "2" });
    assert.match(text, /### Mutation 2\/2 auf den geänderten Zeilen/);
  });
});
