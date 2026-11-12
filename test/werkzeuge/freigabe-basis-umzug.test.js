import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { schrankeBefunde } from "../../tools/freigabe.mjs";

const DATEI = "tools/basis/selbstpruefung.json";
const git = (ordner, ...argumente) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...argumente], { cwd: ordner, encoding: "utf8" }).trim();

function stand(ordner, befunde) {
  mkdirSync(join(ordner, "tools/basis"), { recursive: true });
  writeFileSync(join(ordner, DATEI), JSON.stringify({ befunde }));
  git(ordner, "add", "-A");
  git(ordner, "commit", "-q", "-m", "x");
  return git(ordner, "rev-parse", "HEAD");
}

function befunde(vorher, nachher) {
  const ordner = mkdtempSync(join(tmpdir(), "umzug-"));
  git(ordner, "init", "-q");
  const basis = stand(ordner, vorher);
  const kopf = stand(ordner, nachher);
  const alt = process.cwd();
  process.chdir(ordner);
  try {
    return schrankeBefunde({ branch: "paket/1", dateien: [{ pfad: DATEI, status: "M" }], basis, kopf });
  } finally {
    process.chdir(alt);
  }
}

test("Eine Prüfregel-Bestandsdatei darf auf einem Paket-Branch nur umziehen oder schrumpfen, nie wachsen", () => {
  assert.deepEqual(befunde(["test/a.test.js|h1"], ["test/anrufe/a.test.js|h1"]), []);
  assert.deepEqual(befunde(["test/a.test.js|h1", "test/b.test.js|h2"], ["test/b.test.js|h2"]), []);
  assert.equal(befunde(["test/a.test.js|h1"], ["test/a.test.js|h1", "test/c.test.js|h3"]).length, 1);
  assert.equal(befunde(["test/a.test.js|h1"], ["test/anrufe/a.test.js|h1", "test/a.test.js|h1"]).length, 1);
});
