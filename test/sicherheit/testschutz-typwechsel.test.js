import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { testschutzBefunde } from "../../tools/testschutz.mjs";

const ARBEITSVERZEICHNIS = process.cwd();

function gitUmgebung() {
  const umgebung = { ...process.env };
  for (const name of Object.keys(umgebung)) if (name.startsWith("GIT_")) delete umgebung[name];
  return umgebung;
}

function git(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: gitUmgebung(), encoding: "utf8" }).trim();
}

function befundeNachSymlink(datei) {
  const ordner = mkdtempSync(join(tmpdir(), "testschutz-typ-"));
  try {
    git(ordner, "init", "-q");
    git(ordner, "config", "core.symlinks", "true");
    mkdirSync(join(ordner, "test"));
    writeFileSync(join(ordner, datei), 'import x from "./a.js";\n');
    writeFileSync(join(ordner, "ziel.txt"), "ziel\n");
    git(ordner, "add", "--", ".");
    git(ordner, "commit", "-q", "-m", "basis");
    const basis = git(ordner, "rev-parse", "HEAD");
    rmSync(join(ordner, datei));
    symlinkSync("ziel.txt", join(ordner, datei));
    git(ordner, "add", "--", ".");
    git(ordner, "commit", "-q", "-m", "kopf");
    const kopf = git(ordner, "rev-parse", "HEAD");
    process.chdir(ordner);
    return testschutzBefunde(basis, kopf);
  } finally {
    process.chdir(ARBEITSVERZEICHNIS);
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("SG-21 Testschutz: Testdatei durch Symlink ersetzt ist ein Befund (Status T)", () => {
  assert.deepEqual(befundeNachSymlink("test/a.test.js"), ["test/a.test.js: bestehende Testdatei durch etwas anderes ersetzt (Status T)"]);
});
