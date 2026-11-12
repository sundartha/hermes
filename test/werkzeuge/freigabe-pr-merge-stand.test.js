import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ereignis, geaenderteDateien } from "../../tools/github.mjs";

const git = (ordner, ...argumente) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...argumente], { cwd: ordner, encoding: "utf8" }).trim();

function schreibe(ordner, pfad) {
  mkdirSync(join(ordner, pfad, ".."), { recursive: true });
  writeFileSync(join(ordner, pfad), pfad);
  git(ordner, "add", "-A");
  git(ordner, "commit", "-q", "-m", pfad);
}

test("Im pull_request-Lauf zeigt der Vergleich nur die Dateien des PR, nicht neuere master-Commits im Merge-Stand", () => {
  const ordner = mkdtempSync(join(tmpdir(), "pr-merge-"));
  git(ordner, "init", "-q", "-b", "master");
  schreibe(ordner, "start.txt");
  const masterAlt = git(ordner, "rev-parse", "HEAD");
  git(ordner, "checkout", "-q", "-b", "pr");
  schreibe(ordner, "apps/web/seite.js");
  const prKopf = git(ordner, "rev-parse", "HEAD");
  git(ordner, "checkout", "-q", "master");
  schreibe(ordner, "src/neu.js");
  git(ordner, "merge", "-q", "--no-ff", "-m", "merge", "pr");
  const ereignisDatei = join(ordner, "..", `ereignis-${Date.now()}.json`);
  writeFileSync(ereignisDatei, JSON.stringify({ pull_request: { number: 7, base: { sha: masterAlt } } }));
  const altCwd = process.cwd();
  const altPfad = process.env.GITHUB_EVENT_PATH;
  process.chdir(ordner);
  process.env.GITHUB_EVENT_PATH = ereignisDatei;
  try {
    const { basis, kopf, gruppenKopf } = ereignis();
    assert.equal(kopf, prKopf);
    assert.equal(gruppenKopf, undefined);
    assert.deepEqual(geaenderteDateien(basis, kopf).map(({ pfad }) => pfad), ["apps/web/seite.js"]);
  } finally {
    process.chdir(altCwd);
    process.env.GITHUB_EVENT_PATH = altPfad;
  }
});
