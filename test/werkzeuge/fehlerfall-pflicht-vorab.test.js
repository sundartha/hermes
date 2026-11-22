import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PRUEFEN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "pruefen.mjs");
const GRUND = "Reiner Umbau: nur Namen und Reihenfolge geändert, jede Ausgabe bleibt gleich.";
const DATEI = "src/telephony/telnyx-adapter.ts";

function git(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", ...args], { cwd: ordner, encoding: "utf8" }).trim();
}

function schreibe(ordner, pfad, inhalt) {
  mkdirSync(join(ordner, pfad, ".."), { recursive: true });
  writeFileSync(join(ordner, pfad), inhalt);
}

function lauf(schritt, body) {
  const ordner = mkdtempSync(join(tmpdir(), "fehlerfall-vorab-"));
  try {
    git(ordner, "init", "-q", "-b", "master");
    schreibe(ordner, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    schreibe(ordner, DATEI, "export const a = 1;\n");
    git(ordner, "add", "-A");
    git(ordner, "commit", "-q", "-m", "basis");
    const basis = git(ordner, "rev-parse", "HEAD");
    schreibe(ordner, DATEI, "export const a = 2;\n");
    git(ordner, "add", "-A");
    git(ordner, "commit", "-q", "-m", "zweig");
    const pr = join(ordner, "pr.json");
    writeFileSync(pr, JSON.stringify({ body }));
    const args = schritt === "pr-text" ? [PRUEFEN, "pr-text", pr, "--basis", basis] : [PRUEFEN, "fehlerfall-pflicht", "--basis", basis];
    const ergebnis = spawnSync("node", args, { cwd: ordner, encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: undefined, PR_TEXT: body } });
    return { status: ergebnis.status, ausgabe: ergebnis.stdout + ergebnis.stderr };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

for (const schritt of ["pr-text", "fehlerfall-pflicht"]) {
  test(`${schritt}: Änderung unter src/telephony ohne neue Testdatei und ohne Begründung endet mit Exit 1 und nennt Pfad und Pflicht`, () => {
    const { status, ausgabe } = lauf(schritt, "## Was\n\nx");
    assert.equal(status, 1);
    assert.ok(ausgabe.includes(DATEI));
    assert.ok(ausgabe.includes("## Kein Fehlerfall"));
  });

  test(`${schritt}: Der Abschnitt Kein Fehlerfall mit ausreichender Begründung endet mit Exit 0`, () => {
    assert.equal(lauf(schritt, `## Kein Fehlerfall\n\n${GRUND}\n`).status, 0);
  });
}
