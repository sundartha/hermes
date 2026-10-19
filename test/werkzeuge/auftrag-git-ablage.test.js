import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { gemeinsamerOrdner } from "../../tools/auftrag/git.mjs";

import { probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const TEILE = ["auftrag-umbau", "phase-1", "a.patch"];
const GIT_ORDNER = ".git";
const ERFOLG = 0;

function hauptrepo(context) {
  return probeRepository(context, { "a.txt": "a\n" });
}

test("Gemeinsamer Ordner: aus einem Worktree zeigt der Pfad ins .git des Hauptrepos, nicht in den Worktree", (context) => {
  const repo = hauptrepo(context);
  const worktree = probeDirectory(context, {});
  const anlegen = runIn(repo, "git", ["worktree", "add", "-q", "--detach", worktree]);
  assert.equal(anlegen.status, ERFOLG, anlegen.stderr);
  assert.equal(gemeinsamerOrdner(worktree, ...TEILE), join(realpathSync(repo), GIT_ORDNER, ...TEILE));
});

test("Gemeinsamer Ordner: aus dem Hauptrepo ist der Pfad absolut und liegt im .git des Repos", (context) => {
  const repo = hauptrepo(context);
  assert.equal(gemeinsamerOrdner(repo, ...TEILE), join(repo, GIT_ORDNER, ...TEILE));
});
