import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PRUEFEN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "pruefen.mjs");
const GRUEN = "test/bereich/gruen.test.js";
const ROT = "test/bereich/rot.test.js";
const EINTRAG = (datei) => `## Überlebende Mutanten\n\n- \`src/a.js:1/2\` wird getötet von \`${datei}\` (Grund).\n`;

function git(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid", ...args], { cwd: ordner, encoding: "utf8" }).trim();
}

function schreibe(ordner, pfad, inhalt) {
  mkdirSync(join(ordner, pfad, ".."), { recursive: true });
  writeFileSync(join(ordner, pfad), inhalt);
}

function repo({ neueTests, srcAendern }) {
  const ordner = mkdtempSync(join(tmpdir(), "pr-text-vorab-"));
  git(ordner, "init", "-q", "-b", "master");
  schreibe(ordner, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
  schreibe(ordner, "src/a.js", "export const a = 1;\n");
  git(ordner, "add", "-A");
  git(ordner, "commit", "-q", "-m", "basis");
  const basis = git(ordner, "rev-parse", "HEAD");
  if (srcAendern) schreibe(ordner, "src/a.js", "export const a = 2;\n");
  if (neueTests) {
    schreibe(ordner, GRUEN, 'import { test } from "node:test";\ntest("gruen", () => {});\n');
    schreibe(ordner, "test/bereich/helfer.js", "export const h = 1;\n");
    schreibe(ordner, ROT, 'import { test } from "node:test";\ntest("rot", () => { throw new Error("rot"); });\n');
  }
  git(ordner, "add", "-A");
  git(ordner, "commit", "-q", "-m", "zweig");
  return { ordner, basis };
}

function prTextVorab({ neueTests = true, srcAendern = true, body, prJson = true }) {
  const { ordner, basis } = repo({ neueTests, srcAendern });
  try {
    const datei = join(ordner, "pr.json");
    if (prJson) writeFileSync(datei, typeof body === "string" && body.startsWith("{") ? body : JSON.stringify({ body }));
    const ergebnis = spawnSync("node", [PRUEFEN, "pr-text", ...(prJson ? [datei] : []), "--basis", basis], { cwd: ordner, encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    return { status: ergebnis.status, ausgabe: ergebnis.stdout + ergebnis.stderr };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Eine auf master grüne neue Testdatei ohne Eintrag im PR-Text macht den Vorab-Schritt rot und nennt die Datei", () => {
  const { status, ausgabe } = prTextVorab({ body: "## Was\n\nnichts" });
  assert.equal(status, 1);
  assert.match(ausgabe, /test\/bereich\/gruen\.test\.js/);
  assert.match(ausgabe, /Überlebende Mutanten/);
  assert.doesNotMatch(ausgabe, /test\/bereich\/rot\.test\.js/);
});

test("Ein Eintrag für eine andere Datei oder außerhalb des Abschnitts genügt nicht", () => {
  assert.equal(prTextVorab({ body: EINTRAG(ROT) }).status, 1);
  assert.equal(prTextVorab({ body: `## Was\n\n- \`src/a.js:1/2\` wird getötet von \`${GRUEN}\`\n` }).status, 1);
});

test("Ein Eintrag für jede auf master grüne neue Testdatei macht den Vorab-Schritt grün", () => {
  assert.equal(prTextVorab({ body: EINTRAG(GRUEN) }).status, 0);
});

test("Ohne neue Testdatei oder ohne Änderung unter src läuft nichts und der Schritt ist grün", () => {
  const ohneTest = prTextVorab({ neueTests: false, body: "nichts" });
  assert.equal(ohneTest.status, 0);
  const ohneSrc = prTextVorab({ srcAendern: false, body: "nichts" });
  assert.equal(ohneSrc.status, 0);
  assert.match(ohneSrc.ausgabe, /nichts zu prüfen/);
});

test("Fehlende pr.json oder unlesbarer Text enden mit Exit 2", () => {
  assert.equal(prTextVorab({ prJson: false, body: "x" }).status, 2);
  assert.equal(prTextVorab({ body: "{kaputt" }).status, 2);
  assert.equal(prTextVorab({ body: '{"titel":"x"}' }).status, 2);
});
