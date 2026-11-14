import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import * as github from "../../tools/github.mjs";
import { testschutzBefunde } from "../../tools/testschutz.mjs";

const ARBEITSVERZEICHNIS = process.cwd();

function git(ordner, ...args) {
  const umgebung = { ...process.env };
  for (const name of Object.keys(umgebung)) if (name.startsWith("GIT_")) delete umgebung[name];
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: umgebung, encoding: "utf8" }).trim();
}

function schreibe(ordner, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
}

function befunde(vorher, nachher, entfernt) {
  const ordner = mkdtempSync(join(tmpdir(), "testschutz-muster-"));
  try {
    git(ordner, "init", "-q");
    schreibe(ordner, vorher);
    git(ordner, "add", "--", ".");
    git(ordner, "commit", "-q", "-m", "basis");
    const basis = git(ordner, "rev-parse", "HEAD");
    for (const pfad of entfernt) rmSync(join(ordner, pfad));
    schreibe(ordner, nachher);
    git(ordner, "add", "--", ".");
    git(ordner, "commit", "-q", "-m", "kopf");
    process.chdir(ordner);
    return testschutzBefunde(basis, git(ordner, "rev-parse", "HEAD"));
  } finally {
    process.chdir(ARBEITSVERZEICHNIS);
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("SG-21 Testschutz: die Quelldatei-Erkennung kommt einmal aus github.mjs", () => {
  assert.equal(github.QUELLDATEI.source, "\\.(?:js|mjs|cjs|ts)$");
  assert.equal(github.QUELLDATEI.test("a.test.mjs"), true);
  assert.equal(github.QUELLDATEI.test("a.md"), false);
});

test("SG-21 Testschutz: der Importpräfix mit Anführungszeichen kommt einmal aus github.mjs", () => {
  const muster = new RegExp(github.IMPORT_PRAEFIX, "g");
  assert.deepEqual([...'import x from "./a.js"; require(\'./b.js\')'.matchAll(muster)].map((t) => [t[1], t[2]]), [["from ", '"'], ["require(", "'"]]);
});

test("SG-21 Testschutz: Import mit Abfrage-Suffix gilt in Endungswechsel und Verschiebung gleich", () => {
  const alt = 'import x from "./a.js?v=1#h";\n';
  assert.deepEqual(befunde({ "test/a.test.js": alt }, { "test/a.test.js": 'import x from "./a.ts?v=1#h";\n' }, []), []);
  assert.deepEqual(befunde({ "test/x.test.js": alt }, { "test/a/x.test.js": 'import x from "../a.js?v=1#h";\n' }, ["test/x.test.js"]), []);
});
