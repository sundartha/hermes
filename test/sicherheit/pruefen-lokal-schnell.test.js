import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");
const PRUEFEN = join(WURZEL, "tools/pruefen.mjs");
const DIREKTE_TESTS = 22;
const LOKALE_HOECHSTZAHL = 20;
const SCHNELLE_SCHRITTE = ["lint", "bestaende", "typen", "architektur", "katalog", "testschutz", "tests"];

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
  const testName = (nummer) => `test/t${String(nummer).padStart(2, "0")}.test.js`;
  const direkte = Array.from({ length: DIREKTE_TESTS }, (leer, index) => testName(index + 1));
  const module = [
    ...direkte.map((pfad) => ({ source: pfad, dependencies: [{ resolved: "src/a.js" }] })),
    { source: "src/b.js", dependencies: [{ resolved: "src/a.js" }] },
    { source: "test/indirekt.test.js", dependencies: [{ resolved: "src/b.js" }] },
  ];
  const ordner = join(arbeit, "probe");
  mkdirSync(ordner);
  git(ordner, "init", "-q");
  schreibe(ordner, { "src/a.js": "export const a = 1;\n", "tools/katalog-pruefen.mjs": "" });
  git(ordner, "add", "--", ".");
  git(ordner, "commit", "-q", "-m", "basis");
  const basis = git(ordner, "rev-parse", "HEAD");
  writeFileSync(join(ordner, "src/a.js"), "export const a = 2;\n");
  const protokolle = Object.fromEntries(["npm", "npx", "semgrep", "docker", "depcruise"].map((name) => [name, join(arbeit, `${name}.log`)]));
  const attrappen = join(arbeit, "attrappen");
  const kern = join(arbeit, "kern");
  mkdirSync(attrappen);
  mkdirSync(kern);
  symlinkSync(process.execPath, join(kern, "node"));
  symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(kern, "git"));
  for (const name of ["npm", "npx", "docker"]) attrappe(join(attrappen, name), protokolle[name]);
  mkdirSync(join(ordner, "node_modules/.bin"), { recursive: true });
  attrappe(join(ordner, "node_modules/.bin/depcruise"), protokolle.depcruise, `printf '%s' '${JSON.stringify({ modules: module, summary: { violations: [] } })}'`);
  return { ordner, basis, protokolle, attrappen, kern, direkte };
}

function pruefen(umgebung, args, mitSemgrep = false) {
  const { ordner, basis, protokolle, attrappen, kern } = umgebung;
  if (mitSemgrep) attrappe(join(attrappen, "semgrep"), protokolle.semgrep);
  const ergebnis = spawnSync("node", [PRUEFEN, ...args, "--basis", basis], { cwd: ordner, env: { ...gitUmgebung(), PATH: `${attrappen}:${kern}` }, encoding: "utf8" });
  return { gruen: ergebnis.status === 0, text: ergebnis.stdout + ergebnis.stderr };
}

function inProbe(pruefung) {
  const arbeit = mkdtempSync(join(tmpdir(), "pruefen-schnell-"));
  try {
    return pruefung(probe(arbeit));
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
}

test("npm run pruefen ohne Schritt fährt nur den schnellen Teilsatz mit Architektur, aber ohne Semgrep", () => {
  inProbe((umgebung) => {
    const ergebnis = pruefen(umgebung, [], true);
    assert.deepEqual([...ergebnis.text.matchAll(/^# (\S+)$/gm)].map(([, schritt]) => schritt), SCHNELLE_SCHRITTE);
    assert.equal(ergebnis.gruen, true);
    assert.deepEqual(aufruf(umgebung.protokolle.semgrep), []);
    assert.equal(aufruf(umgebung.protokolle.depcruise).length, 4);
  });
});

test("Der Schritt tests startet nur direkte Tests, höchstens 20, mit 2 Prozessen, und nennt die übrigen", () => {
  inProbe((umgebung) => {
    const ergebnis = pruefen(umgebung, []);
    const erwartet = `npm test -- ${umgebung.direkte.slice(0, LOKALE_HOECHSTZAHL).join(" ")} -- --test-concurrency=2`;
    assert.deepEqual(aufruf(umgebung.protokolle.npm), [erwartet]);
    assert.match(ergebnis.text, /3 weitere betroffene Tests laufen nur in der CI\./);
  });
});

test("Semgrep ohne Binary wird übersprungen und startet kein Docker", () => {
  inProbe((umgebung) => {
    const ergebnis = pruefen(umgebung, ["semgrep"]);
    assert.match(ergebnis.text, /Semgrep übersprungen: semgrep nicht installiert; die CI prüft es\./);
    assert.equal(ergebnis.gruen, true);
    assert.deepEqual(aufruf(umgebung.protokolle.docker), []);
  });
});
