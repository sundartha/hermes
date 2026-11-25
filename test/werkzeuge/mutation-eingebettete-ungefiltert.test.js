import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const AUSFUEHRBAR = 0o755;
const MUTANT = "4";
const KATALOG = 'export const eingebettet = new URL("./eingebettet.js", import.meta.url);\n';
const STRYKER_ATTRAPPE = [
  'import { spawnSync } from "node:child_process";',
  'import { readFileSync, writeFileSync } from "node:fs";',
  "const konfiguration = JSON.parse(readFileSync(process.argv[4], 'utf8'));",
  "const dateien = [...new Set(konfiguration.mutate.map((eintrag) => eintrag.replace(/:\\d+-\\d+$/, '')))];",
  "const [befehl, ...argumente] = konfiguration.commandRunner.command.split(' ');",
  'const lauf = spawnSync(befehl, argumente.map((teil) => (teil === "tools/pruefen.mjs" ? process.env.PRUEFEN_PFAD : teil)), { stdio: "inherit" });',
  "writeFileSync(konfiguration.jsonReporter.fileName, JSON.stringify({ files: Object.fromEntries(dateien.map((datei) => [datei, { mutants: [] }])) }));",
  "process.exitCode = lauf.status;",
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

function messe(arbeit) {
  const ordner = join(arbeit, "repo");
  const attrappen = join(arbeit, "bin");
  mkdirSync(ordner);
  mkdirSync(attrappen);
  imRepo(ordner, "init", "-q");
  legeAn(ordner, "src/ui/katalog.js", KATALOG);
  legeAn(ordner, "src/ui/eingebettet.js", "globalThis.a = 1;\n");
  legeAn(ordner, "test/unbeteiligt.test.js", "export default 1;\n");
  legeAn(ordner, "test/anderer.test.js", "export default 2;\n");
  legeAn(ordner, "test/testbaenke-run.mjs", "");
  imRepo(ordner, "add", "--", ".");
  imRepo(ordner, "commit", "-q", "-m", "basis");
  const basis = imRepo(ordner, "rev-parse", "HEAD");
  legeAn(ordner, "src/ui/eingebettet.js", `globalThis.a = 1;\nvoid stryMutAct_9fa48("${MUTANT}");\n`);
  mkdirSync(join(ordner, "node_modules/.bin"), { recursive: true });
  programm(join(ordner, "node_modules/.bin/depcruise"), ["echo depcruise darf nicht laufen >&2", "exit 1"]);
  writeFileSync(join(arbeit, "stryker.mjs"), STRYKER_ATTRAPPE);
  programm(join(attrappen, "npx"), [`node "${join(arbeit, "stryker.mjs")}" "$@"`]);
  const umgebung = umgebungOhneGit({
    PATH: `${attrappen}:${process.env.PATH}`,
    TEIL: "0",
    TEILE: "1",
    MUTATION_ABDECKUNG: join(arbeit, "abdeckung"),
    PRUEFEN_PFAD: PRUEFEN,
  });
  delete umgebung.__STRYKER_ACTIVE_MUTANT__;
  const lauf = spawnSync("node", [PRUEFEN, "mutation", "--zaehlen", "--basis", basis], { cwd: ordner, env: umgebung, encoding: "utf8" });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  return JSON.parse(readFileSync(join(arbeit, "abdeckung/0.json"), "utf8"));
}

test("Ein Mutant in einem eingebetteten Skript ist Kandidat jeder Testdatei, auch ohne depcruise", () => {
  const arbeit = mkdtempSync(join(tmpdir(), "mutation-ungefiltert-"));
  try {
    assert.deepEqual(messe(arbeit), { "test/anderer.test.js": [MUTANT], "test/unbeteiligt.test.js": [MUTANT] });
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
});
