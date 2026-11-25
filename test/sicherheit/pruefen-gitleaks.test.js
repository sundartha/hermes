import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");
const PRUEFEN = join(WURZEL, "tools/pruefen.mjs");
const CI = readFileSync(join(WURZEL, ".github/workflows/ci.yml"), "utf8");
const ERWARTETE_FASSUNG = CI.match(/^\s*GITLEAKS_VERSION:\s*(\S+)\s*$/m)[1];
const EXIT_ROT = 1;
const EXIT_ANDERS = 2;

function gitUmgebung() {
  const umgebung = { ...process.env };
  for (const name of Object.keys(umgebung)) if (name.startsWith("GIT_")) delete umgebung[name];
  return umgebung;
}

function git(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: gitUmgebung(), encoding: "utf8" }).trim();
}

function attrappe(pfad, { protokoll, fassung, exitCode }) {
  writeFileSync(pfad, `#!/bin/sh\nif [ "$1" = version ]; then echo ${fassung}; exit 0; fi\necho "$*" >> "${protokoll}"\nexit ${exitCode}\n`);
  chmodSync(pfad, 0o755);
}

function aufrufe(protokoll) {
  return existsSync(protokoll) ? readFileSync(protokoll, "utf8").trim().split("\n") : [];
}

function inProbe({ fassung = ERWARTETE_FASSUNG, exitCode = 0, vorhanden = true, ci = false }, pruefung) {
  const arbeit = mkdtempSync(join(tmpdir(), "pruefen-gitleaks-"));
  try {
    const ordner = join(arbeit, "probe");
    const attrappen = join(arbeit, "attrappen");
    const kern = join(arbeit, "kern");
    const protokoll = join(arbeit, "gitleaks.log");
    for (const pfad of [ordner, attrappen, kern]) mkdirSync(pfad);
    symlinkSync(process.execPath, join(kern, "node"));
    symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(kern, "git"));
    if (vorhanden) attrappe(join(attrappen, "gitleaks"), { protokoll, fassung, exitCode });
    git(ordner, "init", "-q");
    writeFileSync(join(ordner, "a.txt"), "a\n");
    git(ordner, "add", "--", ".");
    git(ordner, "commit", "-q", "-m", "basis");
    const basis = git(ordner, "rev-parse", "HEAD");
    const umgebung = { ...gitUmgebung(), PATH: `${attrappen}:${kern}` };
    if (ci) umgebung.GITHUB_ACTIONS = "true";
    const ergebnis = spawnSync("node", [PRUEFEN, "gitleaks", "--basis", basis], { cwd: ordner, env: umgebung, encoding: "utf8" });
    pruefung({ status: ergebnis.status, text: ergebnis.stdout + ergebnis.stderr, aufrufe: aufrufe(protokoll), basis });
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
}

test("A1 gitleaks wird mit den Argumenten der CI aufgerufen, Exit 0 ist grün", () => {
  inProbe({}, ({ status, aufrufe: liste, basis }) => {
    assert.equal(status, 0);
    assert.deepEqual(liste, [`git --config gitleaks.toml --redact --no-banner --exit-code 1 --log-opts=${basis}..HEAD .`]);
  });
});

test("A1 Exit 1 von gitleaks ist rot", () => {
  inProbe({ exitCode: 1 }, ({ status, aufrufe: liste }) => {
    assert.equal(status, EXIT_ROT);
    assert.equal(liste.length, 1);
  });
});

test("A1 jeder andere Exit-Code von gitleaks ist rot", () => {
  inProbe({ exitCode: EXIT_ANDERS }, ({ status }) => {
    assert.equal(status, EXIT_ROT);
  });
});

test("A2 abweichende Fassung ist rot ohne Scan und nennt die Fassung aus ci.yml", () => {
  inProbe({ fassung: "8.0.0" }, ({ status, text, aufrufe: liste }) => {
    assert.equal(status, EXIT_ROT);
    assert.deepEqual(liste, []);
    assert.ok(text.includes(`erwartet ${ERWARTETE_FASSUNG}`), text);
    assert.ok(text.includes("gefunden 8.0.0"), text);
  });
});

test("A3 ohne gitleaks ist der Schritt in der CI rot", () => {
  inProbe({ vorhanden: false, ci: true }, ({ status, text }) => {
    assert.equal(status, EXIT_ROT);
    assert.match(text, /gitleaks nicht installiert/);
  });
});

test("A3 ohne gitleaks ist der Schritt lokal grün und meldet die Übersprungung", () => {
  inProbe({ vorhanden: false }, ({ status, text }) => {
    assert.equal(status, 0);
    assert.match(text, /Gitleaks übersprungen: gitleaks nicht installiert; die CI prüft es\./);
  });
});

test("A4 der CI-Schritt ruft den Schritt von pruefen.mjs auf und gitleaks nicht mehr selbst", () => {
  const schritt = CI.slice(CI.indexOf("- name: Secret-Scan (gitleaks)"), CI.indexOf("- name: Lint"));
  assert.ok(schritt.includes('PATH="$RUNNER_TEMP:$PATH" node tools/pruefen.mjs gitleaks --basis "$BASIS"'));
  assert.ok(!schritt.includes('"$RUNNER_TEMP/gitleaks" git'));
  assert.match(schritt, /GITLEAKS_VERSION: \S+/);
  assert.match(schritt, /GITLEAKS_SHA256: [0-9a-f]{64}/);
  assert.ok(schritt.includes("sha256sum -c"));
});

test("A5 der Standardlauf enthält gitleaks nicht", () => {
  const quelle = readFileSync(PRUEFEN, "utf8");
  const zeile = quelle.match(/^const LOKALE_SCHRITTE = (\[.*\]);$/m)[1];
  assert.deepEqual(JSON.parse(zeile), ["lint", "bestaende", "typen", "architektur", "katalog", "testschutz", "tests"]);
});
