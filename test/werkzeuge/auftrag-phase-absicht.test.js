import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { issueAbsichtBefunde } from "../../tools/auftrag/planung/absicht.mjs";
import { funktion } from "./auftrag-lauf-hilfen.js";
import { BASIS, EXIT_ROT } from "./auftrag-lauf-probe.js";
import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const AUSFUEHRBAR = 0o755;
const ISSUE = 7;
const ABSICHT = "Die Zahl soll verdoppelt werden, ohne Sonderfall für die Testeingabe.";

function starteMitIssue(context, ghSkript) {
  const repo = probeRepository(context, BASIS);
  const werkzeug = probeDirectory(context, {});
  const phase = { phase: "probe-absicht", issue: ISSUE, absicht: ABSICHT, entwurf: { "src/rechnen.js": "Entwurf." }, auftraege: [funktion("2 !== 4")] };
  writeFileSync(join(werkzeug, "phase.json"), JSON.stringify(phase));
  writeFileSync(join(werkzeug, "gh.mjs"), `#!/usr/bin/env node\n${ghSkript}\n`);
  chmodSync(join(werkzeug, "gh.mjs"), AUSFUEHRBAR);
  const lauf = spawnSync(process.execPath, [EINSTIEG, "phase", join(werkzeug, "phase.json")], {
    cwd: repo,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), HOME: werkzeug, HERMES_GH: join(werkzeug, "gh.mjs") },
  });
  return { lauf, repo };
}

test("phase mit Feld absicht startet nicht, wenn das Issue den Abschnitt „Absicht“ nicht wörtlich hat, und legt keinen Worktree an", (context) => {
  const { lauf, repo } = starteMitIssue(context, `console.log(${JSON.stringify(`## Absicht\n\n${ABSICHT.slice(0, -1)}\n\n## Ziel\n`)});`);
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  assert.match(lauf.stderr, /Issue #7: der Abschnitt „## Absicht“ fehlt oder weicht von absicht in phase\.json ab/);
  assert.equal(existsSync(join(repo, ".claude/worktrees")), false);
});

test("phase mit Feld absicht startet nicht, wenn das Issue nicht lesbar ist", (context) => {
  const { lauf } = starteMitIssue(context, "process.exit(1);");
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  assert.match(lauf.stderr, /Issue #7 nicht lesbar; ohne seinen Abschnitt „## Absicht“ startet die Phase nicht/);
});

test("ein Issue mit wörtlich gleicher Absicht ist kein Befund, eine Phase ohne Feld fragt das Issue gar nicht", () => {
  const phase = { issue: ISSUE, absicht: ABSICHT };
  assert.deepEqual(issueAbsichtBefunde(phase, `## Absicht\n\n${ABSICHT}\n\n## Ziel\n\nZahl\n`), []);
  assert.deepEqual(issueAbsichtBefunde({ issue: ISSUE }, null), []);
});
