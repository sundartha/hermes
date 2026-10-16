import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, isolatedEnvironment, outputLines, probeDirectory } from "./werkzeuge/probe-repo.js";

const PRUEFSKRIPT = join(REPO_ROOT, "tools/openai-doku-pruefen.mjs");
const DOKU_REVIEWER = join(REPO_ROOT, "docs/OPENAI-REVIEWER-ACCESS.md");
const EXIT_BEFUND = 1;
const SKRIPT_FRIST_MS = 150_000;

test("weichen die Beispieldaten der Reviewer-Doku vom Seed ab, nennt die Pruefung Sprache und Zeile", (context) => {
  const reviewer = join(probeDirectory(context, {}), "reviewer-beispiele.md");
  copyFileSync(DOKU_REVIEWER, reviewer);
  const geaendert = readFileSync(reviewer, "utf8")
    .replace("picked up until 6 pm.", "picked up until 7 pm.")
    .replace("  - Action Item: Bring gardening gloves to the cleanup.\n", "");
  writeFileSync(reviewer, geaendert);
  const lauf = spawnSync(process.execPath, [PRUEFSKRIPT, "--doku-reviewer", reviewer], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: isolatedEnvironment(),
    timeout: SKRIPT_FRIST_MS,
  });
  const zeilen = outputLines(lauf.stdout);
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stdout + lauf.stderr);
  for (const [sprache, zeile] of [["en", 3], ["de", 7]]) {
    assert.ok(
      zeilen.some((befund) =>
        befund.startsWith(`reviewer Beispieldaten: ${sprache}: Beispieldaten weichen in Zeile ${zeile} ab`),
      ),
      lauf.stdout,
    );
  }
});
