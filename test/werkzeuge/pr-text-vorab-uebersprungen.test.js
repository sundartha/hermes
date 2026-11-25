import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PRUEFEN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "pruefen.mjs");
const KOPF = 'import { test } from "node:test";\n';
const UEBERSPRUNGEN = `${KOPF}test("db", (t) => { t.skip("ohne Datenbank"); });\n`;
const TEIL = `${KOPF}test("db", (t) => { t.skip("ohne Datenbank"); });\ntest("echt", () => {});\n`;
const RETURN = 'import { test } from "node:test";\nimport { postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";\ntest("db", () => { if (!postgresVorhanden()) return; throw new Error("braucht Datenbank"); });\ntest("echt", () => {});\n';
const GRUEN = `${KOPF}test("echt", () => {});\n`;
const ROT = `${KOPF}test("rot", () => { throw new Error("rot"); });\n`;
const DATEI = "test/bereich/neu.test.js";

function git(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", ...args], { cwd: ordner, encoding: "utf8" }).trim();
}

function schreibe(ordner, pfad, inhalt) {
  mkdirSync(join(ordner, pfad, ".."), { recursive: true });
  writeFileSync(join(ordner, pfad), inhalt);
}

function vorab(inhalt) {
  const ordner = mkdtempSync(join(tmpdir(), "pr-text-uebersprungen-"));
  try {
    git(ordner, "init", "-q", "-b", "master");
    schreibe(ordner, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    schreibe(ordner, "src/a.js", "export const a = 1;\n");
    schreibe(ordner, "test/anrufe/hermes-mit-postgres.js", "export const postgresVorhanden = () => false;\n");
    git(ordner, "add", "-A");
    git(ordner, "commit", "-q", "-m", "basis");
    const basis = git(ordner, "rev-parse", "HEAD");
    schreibe(ordner, "src/a.js", "export const a = 2;\n");
    schreibe(ordner, DATEI, inhalt);
    git(ordner, "add", "-A");
    git(ordner, "commit", "-q", "-m", "zweig");
    schreibe(ordner, "pr.json", JSON.stringify({ body: "## Was\n\nnichts" }));
    const ergebnis = spawnSync("node", [PRUEFEN, "pr-text", join(ordner, "pr.json"), "--basis", basis], { cwd: ordner, encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    return { status: ergebnis.status, ausgabe: ergebnis.stdout + ergebnis.stderr };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Eine ganz übersprungene neue Testdatei ist nicht prüfbar ohne Datenbank und braucht keinen Eintrag", () => {
  const { status, ausgabe } = vorab(UEBERSPRUNGEN);
  assert.equal(status, 0);
  assert.match(ausgabe, /test\/bereich\/neu\.test\.js.*nicht prüfbar ohne Datenbank, die CI-Rotprobe entscheidet/);
  assert.doesNotMatch(ausgabe, /ist auf master grün/);
});

test("Eine neue Testdatei ohne Überspringen, die auf der Basis grün ist, bleibt ohne Eintrag rot", () => {
  const { status, ausgabe } = vorab(GRUEN);
  assert.equal(status, 1);
  assert.match(ausgabe, /ist auf master grün/);
  assert.doesNotMatch(ausgabe, /nicht prüfbar/);
});

test("Eine auf der Basis rote neue Testdatei ist kein Befund und nicht als nicht prüfbar gemeldet", () => {
  const { status, ausgabe } = vorab(ROT);
  assert.equal(status, 0);
  assert.doesNotMatch(ausgabe, /nicht prüfbar/);
  assert.doesNotMatch(ausgabe, /ist auf master grün/);
});

test("Eine Testdatei mit teils übersprungenen, teils echt grünen Tests zählt als grün", () => {
  const { status, ausgabe } = vorab(TEIL);
  assert.equal(status, 1);
  assert.match(ausgabe, /ist auf master grün/);
  assert.doesNotMatch(ausgabe, /nicht prüfbar/);
});

test("Eine Testdatei, die bei fehlender Datenbank mit return aussteigt, ist nicht prüfbar ohne Datenbank", () => {
  const { status, ausgabe } = vorab(RETURN);
  assert.equal(status, 0);
  assert.match(ausgabe, /test\/bereich\/neu\.test\.js.*nicht prüfbar ohne Datenbank, die CI-Rotprobe entscheidet/);
  assert.doesNotMatch(ausgabe, /ist auf master grün/);
});
