import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");
const PRUEFEN = join(WURZEL, "tools/pruefen.mjs");
const LISTE = "tools/basis/echte-wartezeiten.json";

function gitUmgebung() {
  const umgebung = { ...process.env };
  for (const name of Object.keys(umgebung)) if (name.startsWith("GIT_")) delete umgebung[name];
  return umgebung;
}

function git(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: gitUmgebung(), encoding: "utf8" }).trim();
}

function schreibe(ordner, pfad, inhalt) {
  mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
  writeFileSync(join(ordner, pfad), inhalt);
}

function bestaende(vorher, nachher) {
  const ordner = mkdtempSync(join(tmpdir(), "wartezeiten-"));
  try {
    git(ordner, "init", "-q");
    schreibe(ordner, ".gitignore", "node_modules\n");
    schreibe(ordner, LISTE, `${JSON.stringify(vorher)}\n`);
    symlinkSync(join(WURZEL, "node_modules"), join(ordner, "node_modules"));
    git(ordner, "add", "--", ".");
    git(ordner, "commit", "-q", "-m", "basis");
    const basis = git(ordner, "rev-parse", "HEAD");
    schreibe(ordner, LISTE, `${JSON.stringify(nachher)}\n`);
    const ergebnis = spawnSync("node", [PRUEFEN, "bestaende", "--basis", basis], { cwd: ordner, env: gitUmgebung(), encoding: "utf8" });
    return { gruen: ergebnis.status === 0, text: ergebnis.stdout };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("echte-wartezeiten-nur-schrumpfend: ein neuer Eintrag in der Liste macht die Bestandsprüfung rot", () => {
  const ergebnis = bestaende(["test/a.test.js"], ["test/a.test.js", "test/b.test.js"]);
  assert.equal(ergebnis.gruen, false);
  assert.match(ergebnis.text, /tools\/basis\/echte-wartezeiten\.json: neu oder öfter eingefroren: .*test\/b\.test\.js/);
});

test("echte-wartezeiten-nur-schrumpfend: ein gestrichener Eintrag bleibt grün", () => {
  assert.equal(bestaende(["test/a.test.js", "test/b.test.js"], ["test/a.test.js"]).gruen, true);
});
