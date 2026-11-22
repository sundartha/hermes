import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const WERKZEUG = resolve("tools/pruefen.mjs");
const GRUND = "Reiner Umbau: nur Ort geändert, jede Ausgabe bleibt gleich und nichts ändert sich.";
const INHALT = Array.from({ length: 20 }, (_, i) => `export const wert${i} = ${i};`).join("\n");

function git(ordner, ...args) {
  const ergebnis = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: ordner, encoding: "utf8" });
  assert.equal(ergebnis.status, 0, ergebnis.stderr);
  return ergebnis.stdout.trim();
}

function schreiben(ordner, datei, text) {
  mkdirSync(dirname(join(ordner, datei)), { recursive: true });
  writeFileSync(join(ordner, datei), text);
}

function verschieben(von, nach, { prText, neueTestdatei }) {
  const ordner = mkdtempSync(join(tmpdir(), "fehlerfall-umbenennung-"));
  try {
    git(ordner, "init", "-q");
    schreiben(ordner, von, INHALT);
    git(ordner, "add", "-A");
    git(ordner, "commit", "-q", "-m", "basis");
    const basis = git(ordner, "rev-parse", "HEAD");
    mkdirSync(dirname(join(ordner, nach)), { recursive: true });
    renameSync(join(ordner, von), join(ordner, nach));
    writeFileSync(join(ordner, nach), `${INHALT}\nexport const neu = 1;`);
    if (neueTestdatei) schreiben(ordner, "test/x/neu.test.js", "x");
    git(ordner, "add", "-A");
    git(ordner, "commit", "-q", "-m", "verschoben");
    const lauf = spawnSync("node", [WERKZEUG, "fehlerfall-pflicht", "--basis", basis], { cwd: ordner, encoding: "utf8", env: { ...process.env, PR_TEXT: prText } });
    return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

for (const ordner of ["src/telephony", "src/elevenlabs", "src/conversation", "src/store/zustand"]) {
  test(`Verschieben aus ${ordner} nach src/anderswo ohne Testdatei und Begründung ist rot und nennt den alten Pfad`, () => {
    const { status, ausgabe } = verschieben(`${ordner}/x.ts`, "src/anderswo/x.ts", { prText: "## Was\n\nx", neueTestdatei: false });
    assert.notEqual(status, 0);
    assert.ok(ausgabe.includes(`${ordner}/x.ts`), ausgabe);
  });
}

test("Dieselbe Verschiebung mit neuer Testdatei ist grün", () => {
  assert.equal(verschieben("src/telephony/x.ts", "src/anderswo/x.ts", { prText: "## Was\n\nx", neueTestdatei: true }).status, 0);
});

test("Dieselbe Verschiebung mit Abschnitt Kein Fehlerfall ist grün", () => {
  assert.equal(verschieben("src/telephony/x.ts", "src/anderswo/x.ts", { prText: `## Kein Fehlerfall\n\n${GRUND}`, neueTestdatei: false }).status, 0);
});

test("Verschieben zwischen ungeschützten Pfaden ist grün", () => {
  assert.equal(verschieben("src/utils/x.ts", "src/anderswo/x.ts", { prText: "## Was\n\nx", neueTestdatei: false }).status, 0);
});
