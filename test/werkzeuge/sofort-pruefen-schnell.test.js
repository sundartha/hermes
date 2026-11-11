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
const WEG = /So geht es richtig: \S/;
const CI_MIT_GRENZE = (grenze) => `env:\n  OBERGRENZE_BAUSYSTEM_DATEIEN: ${grenze}\n`;
const arbeitsbaeume = [];

after(() => {
  for (const ordner of arbeitsbaeume) rmSync(ordner, { recursive: true, force: true });
});

function ohneGitUmgebung() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
}

function git(ordner, ...args) {
  const lauf = spawnSync("git", ["-c", "user.name=probe", "-c", "user.email=probe@example.com", ...args], { cwd: ordner, encoding: "utf8", env: ohneGitUmgebung() });
  assert.equal(lauf.status, 0, lauf.stderr);
}

function arbeitsbaum(dateien, { zweig } = {}) {
  const ordner = mkdtempSync(join(tmpdir(), "sofort-schnell-"));
  arbeitsbaeume.push(ordner);
  writeFileSync(join(ordner, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(ordner, "eslint.config.js"), `export { default } from "${PROJEKTKONFIGURATION}";\n`);
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
  if (zweig !== undefined) {
    git(ordner, "init", "-q", "-b", zweig);
    git(ordner, "add", "-A");
    git(ordner, "commit", "-q", "-m", "basis");
    git(ordner, "update-ref", "refs/remotes/hermes/master", "HEAD");
  }
  return ordner;
}

function hook(ordner, pfad) {
  const eingabe = JSON.stringify({ cwd: ordner, tool_input: { file_path: join(ordner, pfad) } });
  return spawnSync("node", [HOOK], { input: eingabe, encoding: "utf8", timeout: FRIST_MS, env: ohneGitUmgebung() });
}

function still(lauf, name) {
  assert.equal(lauf.status, 0, name);
  assert.equal(lauf.stderr, LEER, name);
  assert.equal(lauf.stdout, LEER, name);
}

test("Syntaxfehler in src/ und scripts/ wird mit Datei, Zeile und Weg gemeldet", () => {
  const ordner = arbeitsbaum({
    "src/kaputt.js": "export const NAME = 1;\nexport const = ;\n",
    "scripts/kaputt.mjs": "const = 1;\n",
    "scripts/ganz.mjs": "export const NAME = 1;\n",
  });
  const src = hook(ordner, "src/kaputt.js");
  assert.equal(src.status, VERSTOSS_EXIT);
  assert.match(src.stderr, /^src\/kaputt\.js:2 {2}syntax {2}SyntaxError[^\n]*So geht es richtig: \S/m);
  const skripte = hook(ordner, "scripts/kaputt.mjs");
  assert.equal(skripte.status, VERSTOSS_EXIT);
  assert.match(skripte.stderr, /^scripts\/kaputt\.mjs:1 {2}syntax {2}SyntaxError[^\n]*So geht es richtig: \S/m);
  still(hook(ordner, "scripts/ganz.mjs"), "scripts/ganz.mjs");
});

test("Syntax wird nur fuer js und mjs unter src/ und scripts/ geprueft", () => {
  const ordner = arbeitsbaum({ "tools/kaputt.mjs": "const = 1;\n", "src/kaputt.ts": "const = 1;\n", "src/kaputt.json": "{\n" });
  assert.doesNotMatch(hook(ordner, "tools/kaputt.mjs").stderr, /syntax/);
  assert.doesNotMatch(hook(ordner, "src/kaputt.json").stderr, /syntax/);
  assert.doesNotMatch(hook(ordner, "src/kaputt.ts").stderr, /ENOENT|syntax {2}/);
});

function suppressions(anzahl) {
  return JSON.stringify({ "src/a.js": { "hermes/keine-kommentare": { count: anzahl } } });
}

test("ein eingefrorener Bestand, der waechst, wird gemeldet; unveraendert bleibt er still", () => {
  const ordner = arbeitsbaum({ "eslint-suppressions.json": suppressions(1) }, { zweig: "system/probe" });
  still(hook(ordner, "eslint-suppressions.json"), "unveraendert");
  writeFileSync(join(ordner, "eslint-suppressions.json"), suppressions(2));
  const lauf = hook(ordner, "eslint-suppressions.json");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /^eslint-suppressions\.json:1 {2}eingefrorene-bestaende {2}[^\n]*hermes\/keine-kommentare/m);
  assert.match(lauf.stderr, WEG);
  writeFileSync(join(ordner, "eslint-suppressions.json"), suppressions(0));
  still(hook(ordner, "eslint-suppressions.json"), "geschrumpft");
});

test("ein neuer Eintrag in einem Bestand unter tools/basis wird gemeldet", () => {
  const ordner = arbeitsbaum({ "tools/basis/zeitglieder-bestand.json": "{}\n" }, { zweig: "system/probe" });
  writeFileSync(join(ordner, "tools/basis/zeitglieder-bestand.json"), JSON.stringify({ "test/a.test.js": 1 }));
  const lauf = hook(ordner, "tools/basis/zeitglieder-bestand.json");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /^tools\/basis\/zeitglieder-bestand\.json:1 {2}eingefrorene-bestaende/m);
});

test("Wachstumsbremse meldet eine Datei zu viel unter tools/ und bleibt sonst still", () => {
  const dateien = { "tools/a.mjs": "export const A = 1;\n", "tools/b.mjs": "export const B = 1;\n" };
  const zuViel = arbeitsbaum({ ...dateien, ".github/workflows/ci.yml": CI_MIT_GRENZE(2) }, { zweig: "system/probe" });
  const lauf = hook(zuViel, "tools/b.mjs");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /^tools\/b\.mjs:1 {2}wachstumsbremse {2}[^\n]*3[^\n]*2[^\n]*So geht es richtig: \S/m);
  const genug = arbeitsbaum({ ...dateien, ".github/workflows/ci.yml": CI_MIT_GRENZE(3) }, { zweig: "system/probe" });
  still(hook(genug, "tools/b.mjs"), "an der Grenze");
});

test("Wachstumsbremse zaehlt auch nicht eingecheckte neue Dateien", () => {
  const ordner = arbeitsbaum({ "tools/a.mjs": "export const A = 1;\n", ".github/workflows/ci.yml": CI_MIT_GRENZE(1) }, { zweig: "system/probe" });
  mkdirSync(join(ordner, ".claude/hooks"), { recursive: true });
  writeFileSync(join(ordner, ".claude/hooks/neu.mjs"), "export const NEU = 1;\n");
  const lauf = hook(ordner, ".claude/hooks/neu.mjs");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /wachstumsbremse/);
});

const SCHRANKE = [
  ["gitleaks.toml", "paket/1-x", true],
  ["eslint.config.js", "paket/1-x", true],
  [".claude/hooks/lib.mjs", "paket/1-x", true],
  ["tools/eslint-rules/index.js", "paket/1-x", true],
  ["CLAUDE.md", "paket/1-x", true],
  ["gitleaks.toml", "system/3477-x", false],
  ["gitleaks.toml", "dependabot/npm/x", false],
  ["tools/andere.mjs", "paket/1-x", false],
  ["docs/x.md", "paket/1-x", false],
];

for (const [pfad, zweig, gemeldet] of SCHRANKE) {
  test(`Freigabe-Schranke: ${pfad} auf ${zweig} ${gemeldet ? "wird gemeldet" : "bleibt still"}`, () => {
    const ordner = arbeitsbaum({ [pfad]: "x\n" }, { zweig });
    const lauf = hook(ordner, pfad);
    if (!gemeldet) return still(lauf, pfad);
    assert.equal(lauf.status, VERSTOSS_EXIT);
    assert.match(lauf.stderr, new RegExp(`^${pfad.replaceAll(".", "\\.")}:1 {2}freigabe-schranke {2}[^\\n]*Prüfregel[^\\n]*${zweig.replace("/", "\\/")}`, "m"));
    assert.match(lauf.stderr, WEG);
    assert.match(lauf.stderr, /nie umbenennen/);
  });
}
