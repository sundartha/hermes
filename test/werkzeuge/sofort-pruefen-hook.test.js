import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOK = fileURLToPath(new URL("../../.claude/hooks/sofort-pruefen.mjs", import.meta.url));
const PROJEKTKONFIGURATION = pathToFileURL(fileURLToPath(new URL("../../eslint.config.js", import.meta.url))).href;
const FRIST_MS = 60_000;
const VERSTOSS_EXIT = 2;
const LEER = "";
const arbeitsbaeume = [];

after(() => {
  for (const ordner of arbeitsbaeume) rmSync(ordner, { recursive: true, force: true });
});

function arbeitsbaum(dateien) {
  const ordner = mkdtempSync(join(tmpdir(), "sofort-pruefen-"));
  arbeitsbaeume.push(ordner);
  writeFileSync(join(ordner, "eslint.config.js"), `export { default } from "${PROJEKTKONFIGURATION}";\n`);
  for (const [pfad, inhalt] of Object.entries({ "src/store.js": "export const speichern = 1;\n", ...dateien })) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
  return ordner;
}

function hook(ordner, pfad) {
  const eingabe = JSON.stringify({ cwd: ordner, tool_input: { file_path: join(ordner, pfad) } });
  return spawnSync("node", [HOOK], { input: eingabe, encoding: "utf8", timeout: FRIST_MS });
}

test("Kommentar in einer Datei unter src/ wird sofort mit Datei, Zeile und Regel gemeldet", () => {
  const ordner = arbeitsbaum({ "src/probe.js": "export const NAME = 1;\n// erklaert nichts\n" });
  const lauf = hook(ordner, "src/probe.js");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /src\/probe\.js:2\s+hermes\/keine-kommentare\s+\S/);
});

test("Verstoss in einer Datei unter test/ wird ebenfalls gemeldet", () => {
  const ordner = arbeitsbaum({ "test/probe.test.js": "// erklaert nichts\nexport const NAME = 1;\n" });
  const lauf = hook(ordner, "test/probe.test.js");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /test\/probe\.test\.js:1\s+hermes\/keine-kommentare/);
});

test("sauberer Code unter src/ bleibt still", () => {
  const ordner = arbeitsbaum({ "src/sauber.js": "export const NAME = 1;\n" });
  const lauf = hook(ordner, "src/sauber.js");
  assert.equal(lauf.status, 0);
  assert.equal(lauf.stderr, LEER);
  assert.equal(lauf.stdout, LEER);
});

test("Dateien ausserhalb von src/ und test/ werden nicht geprueft", () => {
  const ordner = arbeitsbaum({
    "docs/x.md": "// kein Code\n",
    "package.json": "{}\n",
    "tools/werkzeug.js": "// Kommentar\nexport const NAME = 1;\n",
  });
  for (const pfad of ["docs/x.md", "package.json", "tools/werkzeug.js"]) {
    const lauf = hook(ordner, pfad);
    assert.equal(lauf.status, 0, pfad);
    assert.equal(lauf.stderr, LEER, pfad);
  }
});

test("Dateien unter src/ ohne Code-Endung werden nicht geprueft", () => {
  const ordner = arbeitsbaum({ "src/daten.json": "{}\n", "src/text.md": "// x\n" });
  for (const pfad of ["src/daten.json", "src/text.md"]) {
    const lauf = hook(ordner, pfad);
    assert.equal(lauf.status, 0, pfad);
    assert.equal(lauf.stderr, LEER, pfad);
  }
});

test("eine Datei, die es nicht gibt, blockiert die Arbeit nicht", () => {
  const ordner = arbeitsbaum({});
  assert.equal(hook(ordner, "src/fehlt.js").status, 0);
});

test("ein Fehler im Hook blockiert die Arbeit nicht und nennt sich in einer Zeile", () => {
  const ordner = arbeitsbaum({ "src/probe.js": "export const NAME = 1;\n" });
  writeFileSync(join(ordner, "eslint.config.js"), "export default [{ rules: { gibt_es_nicht: 2 } }];\n");
  const lauf = hook(ordner, "src/probe.js");
  assert.equal(lauf.status, 0);
  assert.match(lauf.stderr, /^sofort-pruefen[^\n]*\n$/);
});

function einfrieren(ordner, pfad, anzahl) {
  const bestand = { [pfad]: { "hermes/keine-kommentare": { count: anzahl } } };
  writeFileSync(join(ordner, "eslint-suppressions.json"), JSON.stringify(bestand));
}

test("ein in eslint-suppressions.json eingefrorener Verstoss bleibt still", () => {
  const ordner = arbeitsbaum({ "src/alt.js": "export const NAME = 1;\n// alte Last\n" });
  einfrieren(ordner, "src/alt.js", 1);
  const lauf = hook(ordner, "src/alt.js");
  assert.equal(lauf.status, 0);
  assert.equal(lauf.stderr, LEER);
  assert.equal(lauf.stdout, LEER);
});

test("ein Verstoss ueber die eingefrorene Anzahl hinaus wird mit Regel gemeldet", () => {
  const ordner = arbeitsbaum({ "src/alt.js": "export const NAME = 1;\n// alte Last\n// neue Last\n" });
  einfrieren(ordner, "src/alt.js", 1);
  const lauf = hook(ordner, "src/alt.js");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /src\/alt\.js:\d+\s+hermes\/keine-kommentare/);
});
