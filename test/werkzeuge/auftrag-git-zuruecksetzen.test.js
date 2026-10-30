import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dateiAm, hartZuruecksetzen } from "../../tools/auftrag/git.mjs";

import { commitAll, probeRepository, runIn } from "./probe-repo.js";

function repoMitZweiStaenden(context) {
  const repo = probeRepository(context, { "a.txt": "alt\n", ".gitignore": "ignoriert.txt\n" });
  const erster = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFileSync(join(repo, "a.txt"), "neu\n");
  writeFileSync(join(repo, "b.txt"), "b\n");
  commitAll(repo, "Zweiter Stand");
  return { repo, erster };
}

test("hartZuruecksetzen setzt Verfolgtes auf den Stand zurück und löscht Unverfolgtes samt Ordnern, Ignoriertes bleibt", (context) => {
  const { repo, erster } = repoMitZweiStaenden(context);
  writeFileSync(join(repo, "a.txt"), "lokal\n");
  writeFileSync(join(repo, "unverfolgt.txt"), "x\n");
  mkdirSync(join(repo, "ordner"));
  writeFileSync(join(repo, "ordner/x.txt"), "x\n");
  writeFileSync(join(repo, "ignoriert.txt"), "i\n");
  hartZuruecksetzen(erster, repo);
  assert.equal(runIn(repo, "git", ["show", `HEAD:a.txt`]).stdout, "alt\n");
  assert.equal(runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim(), erster);
  assert.deepEqual([existsSync(join(repo, "unverfolgt.txt")), existsSync(join(repo, "ordner")), existsSync(join(repo, "b.txt")), existsSync(join(repo, "ignoriert.txt"))], [false, false, false, true]);
});

test("hartZuruecksetzen auf HEAD verwirft Änderungen am Arbeitsstand, ohne den Commit zu verschieben", (context) => {
  const { repo } = repoMitZweiStaenden(context);
  const kopf = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFileSync(join(repo, "a.txt"), "lokal\n");
  hartZuruecksetzen("HEAD", repo);
  assert.equal(runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim(), kopf);
  assert.equal(runIn(repo, "git", ["status", "--porcelain"]).stdout, "");
});

test("dateiAm liefert den Inhalt am Stand, nicht den der Arbeitskopie, und null für eine Datei, die es dort nicht gibt", (context) => {
  const { repo, erster } = repoMitZweiStaenden(context);
  writeFileSync(join(repo, "a.txt"), "lokal\n");
  assert.equal(dateiAm("HEAD", "a.txt", repo), "neu\n");
  assert.equal(dateiAm(erster, "a.txt", repo), "alt\n");
  assert.equal(dateiAm(erster, "b.txt", repo), null);
});
