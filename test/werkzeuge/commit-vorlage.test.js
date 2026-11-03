import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { PROBE_AUTHOR, REPO_ROOT, gitAusgabe, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const HOOKS = join(REPO_ROOT, ".githooks");
const VORLAGE_URL = pathToFileURL(join(REPO_ROOT, "tools/commit-vorlage.mjs")).href;
const PAKET_BRANCH = "paket/XYZ-probe-zweig";

function repoAufBranch(context, branch) {
  const verzeichnis = probeRepository(context, { "a.txt": "a\n" });
  runIn(verzeichnis, "git", ["switch", "-q", "-c", branch]);
  return verzeichnis;
}

function committeMitVorlage(verzeichnis, nachricht) {
  writeFiles(verzeichnis, { "a.txt": `${nachricht.length}\n` });
  runIn(verzeichnis, "git", ["add", "-A"]);
  const args = [...PROBE_AUTHOR, "-c", `core.hooksPath=${HOOKS}`, "-c", "commit.gpgsign=false"];
  const lauf = runIn(verzeichnis, "git", [...args, "commit", "-q", "--no-verify", "-m", nachricht]);
  assert.equal(lauf.status, 0, lauf.stderr);
  return gitAusgabe(verzeichnis, "log", "-1", "--format=%B");
}

test("commit-vorlage: ein Handcommit auf einem Paket-Branch bekommt Warum-Absatz und Paket-Zeile", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  const nachricht = committeMitVorlage(verzeichnis, "Lösche x\n\nDie Prüfung misst x doppelt.");
  assert.equal(nachricht, "Lösche x\n\nWarum: Die Prüfung misst x doppelt.\n\nPaket: XYZ");
});

test("commit-vorlage: eine vollständige Nachricht bleibt, wie sie ist", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  const vorgabe = "Lösche x\n\nUrsache: x war kaputt.\n\nAuftrag: p1/A1";
  assert.equal(committeMitVorlage(verzeichnis, vorgabe), vorgabe);
});

test("commit-vorlage: die Paket-Zeile steht vor einem abschließenden Co-Authored-By", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  const nachricht = committeMitVorlage(verzeichnis, "Lösche x\n\nWarum: doppelt.\n\nCo-Authored-By: Probe <probe@example.invalid>");
  assert.equal(nachricht, "Lösche x\n\nWarum: doppelt.\n\nPaket: XYZ\n\nCo-Authored-By: Probe <probe@example.invalid>");
});

test("commit-vorlage: ohne Paket-Branch und ohne Rumpf setzt die Vorlage nichts", (context) => {
  const verzeichnis = repoAufBranch(context, "anderer-zweig");
  assert.equal(committeMitVorlage(verzeichnis, "Lösche x"), "Lösche x");
});

test("commit-vorlage: ein fixup!-Commit bleibt unberührt, damit er beim Falten nichts verdoppelt", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  assert.equal(committeMitVorlage(verzeichnis, "fixup! Lösche x\n\nNachtrag."), "fixup! Lösche x\n\nNachtrag.");
});

test("commit-vorlage: eine Rumpfzeile mit # am Anfang bleibt Teil des Warum-Absatzes", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  const nachricht = committeMitVorlage(verzeichnis, "Lösche x\n\n#605 misst x doppelt.\nDeshalb weg.");
  assert.equal(nachricht, "Lösche x\n\nWarum: #605 misst x doppelt.\nDeshalb weg.\n\nPaket: XYZ");
});

test("commit-vorlage: ein einzeiliger Rumpf mit #-Nummer am Anfang wird der Warum-Absatz", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  const nachricht = committeMitVorlage(verzeichnis, "Lösche x\n\n#605 misst x doppelt.");
  assert.equal(nachricht, "Lösche x\n\nWarum: #605 misst x doppelt.\n\nPaket: XYZ");
});

test("commit-vorlage: bei git commit -e -v steht die Paket-Zeile vor der Scheren-Zeile mit dem Diff", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  writeFiles(verzeichnis, { "a.txt": "geaendert\n" });
  runIn(verzeichnis, "git", ["add", "-A"]);
  const args = [...PROBE_AUTHOR, "-c", `core.hooksPath=${HOOKS}`, "-c", "commit.gpgsign=false", "-c", "core.editor=true"];
  const lauf = runIn(verzeichnis, "git", [...args, "commit", "-q", "--no-verify", "-e", "-v", "-m", "Lösche x\n\nDoppelt."]);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.equal(gitAusgabe(verzeichnis, "log", "-1", "--format=%B"), "Lösche x\n\nWarum: Doppelt.\n\nPaket: XYZ");
});

test("commit-vorlage: eine Nachricht nur aus der Betreffzeile bleibt auch auf einem Paket-Branch unverändert", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  assert.equal(committeMitVorlage(verzeichnis, "Lösche x"), "Lösche x");
});

test("commit-vorlage: die Paket-Zeile steht vor jedem abschließenden Trailer wie Reviewed-by", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  const nachricht = committeMitVorlage(verzeichnis, "Lösche x\n\nWarum: doppelt.\n\nReviewed-by: Probe <probe@example.invalid>");
  assert.equal(nachricht, "Lösche x\n\nWarum: doppelt.\n\nPaket: XYZ\n\nReviewed-by: Probe <probe@example.invalid>");
});

test("commit-vorlage: über einen Symlink aufgerufen schreibt die Vorlage die Nachricht trotzdem", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  symlinkSync(join(REPO_ROOT, "tools/commit-vorlage.mjs"), join(verzeichnis, "vorlage-link.mjs"));
  writeFiles(verzeichnis, { "nachricht.txt": "Lösche x\n\nDoppelt.\n" });
  const lauf = runIn(verzeichnis, process.execPath, [join(verzeichnis, "vorlage-link.mjs"), "nachricht.txt", "message"]);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.equal(readFileSync(join(verzeichnis, "nachricht.txt"), "utf8"), "Lösche x\n\nWarum: Doppelt.\n\nPaket: XYZ\n");
});

test("commit-vorlage: eine Merge-Nachricht von git bleibt ohne Paket-Zeile", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  runIn(verzeichnis, "git", ["switch", "-q", "-c", "seitenzweig"]);
  committeMitVorlage(verzeichnis, "Seite\n\nWarum: probe.\n\nPaket: XYZ");
  runIn(verzeichnis, "git", ["switch", "-q", PAKET_BRANCH]);
  writeFiles(verzeichnis, { "b.txt": "b\n" });
  committeMitVorlage(verzeichnis, "Haupt\n\nWarum: probe.\n\nPaket: XYZ");
  const args = [...PROBE_AUTHOR, "-c", `core.hooksPath=${HOOKS}`, "-c", "commit.gpgsign=false"];
  const lauf = runIn(verzeichnis, "git", [...args, "merge", "-q", "--no-ff", "--no-verify", "--no-edit", "seitenzweig"]);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.equal(gitAusgabe(verzeichnis, "log", "-1", "--format=%B"), "Merge branch 'seitenzweig' into paket/XYZ-probe-zweig");
});

test("commit-vorlage: ein abschließender Kommentarblock bleibt hinter der Paket-Zeile", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  const nachricht = committeMitVorlage(verzeichnis, "Lösche x\n\nDoppelt.\n\n# Kommentar von git");
  assert.equal(nachricht, "Lösche x\n\nWarum: Doppelt.\n\nPaket: XYZ\n\n# Kommentar von git");
});

test("commit-vorlage: ein Rumpf nur aus Co-Authored-By wird kein Warum-Absatz", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  const nachricht = committeMitVorlage(verzeichnis, "Lösche x\n\nCo-Authored-By: Probe <probe@example.invalid>");
  assert.equal(nachricht, "Lösche x\n\nPaket: XYZ\n\nCo-Authored-By: Probe <probe@example.invalid>");
});

test("commit-vorlage: ein Rumpf nur aus der Herkunft wird kein Warum-Absatz", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  assert.equal(committeMitVorlage(verzeichnis, "Lösche x\n\nPaket: ABC"), "Lösche x\n\nPaket: ABC");
});

test("commit-vorlage: wer die Muster nur importiert (wie ziele-pruefen.test.js), ändert keine Datei aus den Argumenten", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  writeFiles(verzeichnis, { "nachricht.txt": "Lösche x\n\nDoppelt.\n" });
  const lauf = runIn(verzeichnis, process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(VORLAGE_URL)});`, "anderes-skript.mjs", "nachricht.txt"]);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.equal(readFileSync(join(verzeichnis, "nachricht.txt"), "utf8"), "Lösche x\n\nDoppelt.\n");
});

function hooksMitVorlage(verzeichnis) {
  const wurzel = join(verzeichnis, ".probe-hooks");
  mkdirSync(join(wurzel, "hooks"), { recursive: true });
  mkdirSync(join(wurzel, "tools"));
  for (const hook of ["prepare-commit-msg", "commit-msg"]) copyFileSync(join(HOOKS, hook), join(wurzel, "hooks", hook));
  symlinkSync(join(REPO_ROOT, "tools/commit-vorlage.mjs"), join(wurzel, "tools/commit-vorlage.mjs"));
  const editor = join(wurzel, "editor.sh");
  writeFiles(wurzel, { "editor.sh": "#!/bin/sh\nprintf 'Lösche x\\n\\nDoppelt.\\n' > \"$1\"\n" });
  chmodSync(editor, 0o755);
  return { hooks: join(wurzel, "hooks"), editor };
}

test("commit-vorlage: eine erst im Editor geschriebene Nachricht bekommt nach dem Editor Warum-Absatz und Paket-Zeile", (context) => {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  const { hooks, editor } = hooksMitVorlage(verzeichnis);
  writeFiles(verzeichnis, { "a.txt": "im editor\n" });
  runIn(verzeichnis, "git", ["add", "a.txt"]);
  const args = [...PROBE_AUTHOR, "-c", `core.hooksPath=${hooks}`, "-c", "commit.gpgsign=false", "-c", `core.editor=${editor}`];
  const lauf = runIn(verzeichnis, "git", [...args, "commit", "-q"]);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.equal(gitAusgabe(verzeichnis, "log", "-1", "--format=%B"), "Lösche x\n\nWarum: Doppelt.\n\nPaket: XYZ");
});

function repoMitSeitenzweig(context, weitereArgs = []) {
  const verzeichnis = repoAufBranch(context, PAKET_BRANCH);
  const { hooks } = hooksMitVorlage(verzeichnis);
  const args = [...PROBE_AUTHOR, "-c", `core.hooksPath=${hooks}`, "-c", "commit.gpgsign=false", ...weitereArgs];
  runIn(verzeichnis, "git", ["switch", "-q", "-c", "seitenzweig"]);
  writeFiles(verzeichnis, { "b.txt": "b\n" });
  runIn(verzeichnis, "git", ["add", "b.txt"]);
  assert.equal(runIn(verzeichnis, "git", [...args, "commit", "-q", "-m", "Seite\n\nWarum: probe.\n\nPaket: XYZ"]).status, 0);
  runIn(verzeichnis, "git", ["switch", "-q", PAKET_BRANCH]);
  return { verzeichnis, args };
}

test("commit-vorlage: ein Squash-Commit nach git merge --squash bleibt auch im Hook commit-msg unberührt", (context) => {
  const { verzeichnis, args } = repoMitSeitenzweig(context, ["-c", "core.editor=true"]);
  assert.equal(runIn(verzeichnis, "git", [...args, "merge", "-q", "--squash", "seitenzweig"]).status, 0);
  const lauf = runIn(verzeichnis, "git", [...args, "commit", "-q"]);
  assert.equal(lauf.status, 0, lauf.stderr);
  const nachricht = gitAusgabe(verzeichnis, "log", "-1", "--format=%B");
  assert.match(nachricht, /^Squashed commit of the following:/);
  assert.doesNotMatch(nachricht, /^Warum: /m);
  assert.doesNotMatch(nachricht, /^Paket: XYZ$/m);
});

test("commit-vorlage: eine Merge-Nachricht mit Rumpf bleibt auch im Hook commit-msg unberührt", (context) => {
  const { verzeichnis, args } = repoMitSeitenzweig(context);
  const lauf = runIn(verzeichnis, "git", [...args, "merge", "-q", "--no-ff", "-m", "Führe seitenzweig zusammen\n\nNach Abstimmung.", "seitenzweig"]);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.equal(gitAusgabe(verzeichnis, "log", "-1", "--format=%B"), "Führe seitenzweig zusammen\n\nNach Abstimmung.");
});
