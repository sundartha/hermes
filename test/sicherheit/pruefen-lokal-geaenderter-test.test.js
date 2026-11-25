import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");
const PRUEFEN = join(WURZEL, "tools/pruefen.mjs");
const GEAENDERTER_TEST = "test/niemand.test.js";

function gitUmgebung() {
  const umgebung = { ...process.env };
  for (const name of Object.keys(umgebung)) if (name.startsWith("GIT_")) delete umgebung[name];
  return umgebung;
}

function git(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: gitUmgebung(), encoding: "utf8" }).trim();
}

function schreibe(ordner, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
}

function attrappe(pfad, protokoll, rest = "") {
  writeFileSync(pfad, `#!/bin/sh\necho "\${0##*/} $*" >> "${protokoll}"\n${rest}\nexit 0\n`);
  chmodSync(pfad, 0o755);
}

function aufruf(protokoll) {
  return existsSync(protokoll) ? readFileSync(protokoll, "utf8").trim().split("\n") : [];
}

function probe(arbeit) {
  const graph = { modules: [{ source: "src/a.js", dependencies: [] }], summary: { violations: [] } };
  const ordner = join(arbeit, "probe");
  mkdirSync(ordner);
  git(ordner, "init", "-q");
  schreibe(ordner, { "src/a.js": "export const a = 1;\n", "tools/katalog-pruefen.mjs": "" });
  git(ordner, "add", "--", ".");
  git(ordner, "commit", "-q", "-m", "basis");
  const basis = git(ordner, "rev-parse", "HEAD");
  schreibe(ordner, { [GEAENDERTER_TEST]: 'import { test } from "node:test";\ntest("x", () => {});\n' });
  git(ordner, "add", "--", GEAENDERTER_TEST);
  const protokoll = join(arbeit, "npm.log");
  const attrappen = join(arbeit, "attrappen");
  const kern = join(arbeit, "kern");
  mkdirSync(attrappen);
  mkdirSync(kern);
  symlinkSync(process.execPath, join(kern, "node"));
  symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(kern, "git"));
  for (const name of ["npm", "npx", "docker"]) attrappe(join(attrappen, name), join(arbeit, `${name}.log`));
  mkdirSync(join(ordner, "node_modules/.bin"), { recursive: true });
  attrappe(join(ordner, "node_modules/.bin/depcruise"), join(arbeit, "depcruise.log"), `printf '%s' '${JSON.stringify(graph)}'`);
  return { ordner, basis, protokoll, attrappen, kern };
}

test("Der Schritt tests startet eine im Paket geänderte Testdatei, auch ohne dass sie eine geänderte Quelldatei importiert", () => {
  const arbeit = mkdtempSync(join(tmpdir(), "pruefen-geaendert-"));
  try {
    const { ordner, basis, protokoll, attrappen, kern } = probe(arbeit);
    const ergebnis = spawnSync("node", [PRUEFEN, "tests", "--basis", basis], { cwd: ordner, env: { ...gitUmgebung(), PATH: `${attrappen}:${kern}` }, encoding: "utf8" });
    assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
    assert.deepEqual(aufruf(protokoll), [`npm test -- ${GEAENDERTER_TEST} -- --test-concurrency=2`]);
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
});
