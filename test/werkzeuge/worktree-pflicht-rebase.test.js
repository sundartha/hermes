import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BLOCKING_EXIT_CODE, PROBE_AUTHOR, PROBE_COMMIT_SETTINGS, commitAll, probeRepository, runHook, runIn, writeFiles } from "./probe-repo.js";

const KONFLIKTDATEI = "src/app.js";
const SAUBERE_DATEI = "src/sauber.js";
const NEUE_DATEI = "src/neu.js";
const GRUNDTEXT = "eins\nzwei\ndrei\n";
const GIT_PROBE = [...PROBE_AUTHOR, ...PROBE_COMMIT_SETTINGS];

function gitIn(verzeichnis, ...argumente) {
  return runIn(verzeichnis, "git", [...GIT_PROBE, ...argumente]);
}

function arbeitskopieImRebaseKonflikt(context, rebaseArgumente = []) {
  const haupt = realpathSync(probeRepository(context, { [KONFLIKTDATEI]: GRUNDTEXT, [SAUBERE_DATEI]: GRUNDTEXT }));
  const arbeit = join(haupt, ".claude/worktrees/arbeit");
  const daneben = join(haupt, ".claude/worktrees/daneben");
  assert.equal(gitIn(haupt, "worktree", "add", "-q", "-b", "arbeit", arbeit).status, 0);
  writeFiles(arbeit, { [KONFLIKTDATEI]: "eins\nPaket\ndrei\n", [SAUBERE_DATEI]: "eins\nzwei\ndrei\nvier\n" });
  commitAll(arbeit, "Paket");
  writeFiles(haupt, { [KONFLIKTDATEI]: "eins\nMaster\ndrei\n" });
  commitAll(haupt, "Master");
  const master = gitIn(haupt, "rev-parse", "HEAD").stdout.trim();
  assert.equal(gitIn(haupt, "worktree", "add", "-q", "-b", "daneben", daneben, "HEAD~1").status, 0);
  const rebase = gitIn(arbeit, "rebase", ...rebaseArgumente, master);
  assert.notEqual(rebase.status, 0, "der Rebase muss am Konflikt anhalten");
  return { arbeit, daneben, master };
}

function schreibVersuch(verzeichnis, datei, umgebung = {}) {
  return runHook("worktree-pflicht.mjs", {
    cwd: verzeichnis,
    input: { cwd: verzeichnis, tool_input: { file_path: datei } },
    environment: { HERMES_ROLLE: undefined, ...umgebung },
  });
}

test("Während eines Rebase darf die Sitzung die nicht zusammengeführte src-Datei bearbeiten", (context) => {
  const { arbeit } = arbeitskopieImRebaseKonflikt(context);
  assert.equal(schreibVersuch(arbeit, join(arbeit, KONFLIKTDATEI)).status, 0);
  assert.equal(schreibVersuch(arbeit, KONFLIKTDATEI).status, 0);
});

test("Während eines Rebase bleibt jede andere src-Datei gesperrt, auch die schon sauber zusammengeführte", (context) => {
  const { arbeit } = arbeitskopieImRebaseKonflikt(context);
  for (const datei of [SAUBERE_DATEI, NEUE_DATEI, "src/tief/neu.js", "SRC/app.js"]) {
    const lauf = schreibVersuch(arbeit, join(arbeit, datei));
    assert.equal(lauf.status, BLOCKING_EXIT_CODE, datei);
    assert.match(lauf.stderr, /lauf/);
  }
});

test("Ohne laufenden Rebase bleibt auch die zuvor konfliktbehaftete src-Datei gesperrt", (context) => {
  const { arbeit } = arbeitskopieImRebaseKonflikt(context);
  assert.equal(gitIn(arbeit, "rebase", "--abort").status, 0);
  for (const datei of [KONFLIKTDATEI, SAUBERE_DATEI, NEUE_DATEI]) {
    assert.equal(schreibVersuch(arbeit, join(arbeit, datei)).status, BLOCKING_EXIT_CODE, datei);
  }
});

test("Der Rebase einer Arbeitskopie öffnet dieselbe Datei in einer anderen Arbeitskopie nicht", (context) => {
  const { daneben } = arbeitskopieImRebaseKonflikt(context);
  assert.equal(schreibVersuch(daneben, join(daneben, KONFLIKTDATEI)).status, BLOCKING_EXIT_CODE);
});

test("Ein Merge mit Konflikt ist kein Rebase und öffnet die nicht zusammengeführte src-Datei nicht", (context) => {
  const { arbeit, master } = arbeitskopieImRebaseKonflikt(context);
  assert.equal(gitIn(arbeit, "rebase", "--abort").status, 0);
  assert.notEqual(gitIn(arbeit, "merge", "--no-edit", master).status, 0, "der Merge muss am Konflikt anhalten");
  assert.equal(schreibVersuch(arbeit, join(arbeit, KONFLIKTDATEI)).status, BLOCKING_EXIT_CODE);
});

test("Auch ein Rebase im Apply-Modus öffnet genau die nicht zusammengeführte src-Datei", (context) => {
  const { arbeit } = arbeitskopieImRebaseKonflikt(context, ["--apply"]);
  assert.equal(schreibVersuch(arbeit, join(arbeit, KONFLIKTDATEI)).status, 0);
  assert.equal(schreibVersuch(arbeit, join(arbeit, SAUBERE_DATEI)).status, BLOCKING_EXIT_CODE);
});
