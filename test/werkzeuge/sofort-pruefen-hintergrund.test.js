import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../../.claude/hooks/sofort-pruefen.mjs", import.meta.url));
const EINSTELLUNGEN = fileURLToPath(new URL("../../.claude/settings.json", import.meta.url));
const FRIST_MS = 120_000;
const VERSTOSS_EXIT = 2;
const LEER = "";
const HINTERGRUND = "--hintergrund";
const EXPECTED_FRIST_S = 120;
const aufzuraeumen = [];

const SEMGREP_STUB = `#!/bin/sh
for a; do ziel=$a; done
awk 'BEGIN{printf "{\\"results\\":["} /eval\\(/ {printf "%s{\\"check_id\\":\\"stub.eval-nutzen\\",\\"start\\":{\\"line\\":%d},\\"extra\\":{\\"message\\":\\"eval fuehrt Text als Code aus.\\"}}", (n++?",":""), NR} END{print "]}"}' "$ziel"
`;
const SEMGREP_NETZFEHLER = "#!/bin/sh\necho 'Fehler beim Laden der Regeln' >&2\nexit 2\n";
const GITLEAKS_STUB = `#!/bin/sh
case " $* " in *" --config gitleaks.toml "*) ;; *) echo '[]'; exit 0;; esac
for a; do ziel=$a; done
awk 'BEGIN{printf "["} /GEHEIMNIS/ {printf "%s{\\"RuleID\\":\\"stub-schluessel\\",\\"Description\\":\\"Stub-Schluessel gefunden\\",\\"StartLine\\":%d,\\"File\\":\\"%s\\"}", (n++?",":""), NR, FILENAME} END{print "]"}' "$ziel"
`;

after(() => {
  for (const ordner of aufzuraeumen) rmSync(ordner, { recursive: true, force: true });
});

function ohneGitUmgebung() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
}

function git(ordner, ...args) {
  const lauf = spawnSync("git", ["-c", "user.name=probe", "-c", "user.email=probe@example.com", ...args], { cwd: ordner, encoding: "utf8", env: ohneGitUmgebung() });
  assert.equal(lauf.status, 0, lauf.stderr);
}

function temporaer(vorsatz) {
  const ordner = mkdtempSync(join(tmpdir(), vorsatz));
  aufzuraeumen.push(ordner);
  return ordner;
}

function programme(inhalte) {
  const ordner = temporaer("hintergrund-bin-");
  for (const [name, inhalt] of Object.entries(inhalte)) {
    writeFileSync(join(ordner, name), inhalt);
    chmodSync(join(ordner, name), 0o755);
  }
  return ordner;
}

function ohneProgramme() {
  const gitPfad = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  return programme({ git: `#!/bin/sh\nexec "${gitPfad}" "$@"\n` });
}

function mitProgrammen(inhalte) {
  const ordner = programme(inhalte);
  return `${ordner}${delimiter}${process.env.PATH}`;
}

function arbeitsbaum(dateien) {
  const ordner = temporaer("sofort-hintergrund-");
  writeFileSync(join(ordner, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(ordner, "gitleaks.toml"), "[extend]\nuseDefault = true\n");
  writeFileSync(join(ordner, "tsconfig.json"), '{"compilerOptions":{"strict":true,"noEmit":true,"types":[],"module":"nodenext","moduleResolution":"nodenext","target":"es2024","lib":["es2024"]},"include":["src"]}\n');
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
  git(ordner, "init", "-q", "-b", "paket/probe");
  git(ordner, "add", "-A");
  git(ordner, "commit", "-q", "-m", "basis");
  git(ordner, "update-ref", "refs/remotes/hermes/master", "HEAD");
  return ordner;
}

function hook(ordner, pfad, { pfadVariable = mitProgrammen({ semgrep: SEMGREP_STUB, gitleaks: GITLEAKS_STUB }), argumente = [HINTERGRUND] } = {}) {
  const eingabe = JSON.stringify({ cwd: ordner, tool_input: { file_path: join(ordner, pfad) } });
  return spawnSync(process.execPath, [HOOK, ...argumente], { input: eingabe, encoding: "utf8", timeout: FRIST_MS, env: { ...ohneGitUmgebung(), PATH: pfadVariable } });
}

function still(lauf, name) {
  assert.equal(lauf.status, 0, name);
  assert.equal(lauf.stderr, LEER, name);
  assert.equal(lauf.stdout, LEER, name);
}

test("Semgrep: nur ein Fund, der gegenueber der Basis-Fassung neu ist, wird mit Zeile und Weg gemeldet", () => {
  const ordner = arbeitsbaum({ "src/a.js": "const a = 1;\nconst b = eval(x);\n" });
  still(hook(ordner, "src/a.js"), "unveraendert");
  writeFileSync(join(ordner, "src/a.js"), "const z = 0;\nconst a = 1;\nconst b = eval(x);\nconst c = eval(y);\n");
  const lauf = hook(ordner, "src/a.js");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /^src\/a\.js:4 {2}semgrep {2}stub\.eval-nutzen: eval fuehrt Text als Code aus\. So geht es richtig: \S/m);
  assert.doesNotMatch(lauf.stderr, /src\/a\.js:3 /);
  assert.match(lauf.stderr, /nosemgrep/);
});

test("Semgrep: eine neue Datei meldet jeden Fund, saubere und bekannte Dateien bleiben still", () => {
  const ordner = arbeitsbaum({ "src/alt.js": "const a = 1;\n" });
  writeFileSync(join(ordner, "src/neu.js"), "const b = eval(x);\n");
  const lauf = hook(ordner, "src/neu.js");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /^src\/neu\.js:1 {2}semgrep /m);
  still(hook(ordner, "src/alt.js"), "sauber");
});

test("Semgrep: Netzfehler und fehlendes Programm enden ohne Blockade, fehlendes Programm wird gemeldet", () => {
  const ordner = arbeitsbaum({ "src/a.js": "const a = 1;\n" });
  writeFileSync(join(ordner, "src/a.js"), "const b = eval(x);\n");
  still(hook(ordner, "src/a.js", { pfadVariable: mitProgrammen({ semgrep: SEMGREP_NETZFEHLER, gitleaks: GITLEAKS_STUB }) }), "Netzfehler");
  const lauf = hook(ordner, "src/a.js", { pfadVariable: ohneProgramme() });
  assert.equal(lauf.status, 0);
  assert.match(lauf.stderr, /^sofort-pruefen: Prüfung übersprungen \(semgrep nicht installiert\)$/m);
});

test("gitleaks: ein Fund wird mit Zeile, Regel und Weg gemeldet, saubere Dateien bleiben still", () => {
  const ordner = arbeitsbaum({ "docs/notiz.md": "nichts\n" });
  still(hook(ordner, "docs/notiz.md"), "sauber");
  writeFileSync(join(ordner, "docs/notiz.md"), "nichts\nnichts\nGEHEIMNIS=abc\n");
  const lauf = hook(ordner, "docs/notiz.md");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /^docs\/notiz\.md:3 {2}gitleaks {2}Stub-Schluessel gefunden \(stub-schluessel\)\. So geht es richtig: [^\n]*erfundene-geheimnisse\.js/m);
});

test("gitleaks: ohne installiertes Programm endet der Hook mit Exit 0 und der Zeile Prüfung übersprungen", () => {
  const ordner = arbeitsbaum({ "docs/notiz.md": "GEHEIMNIS=abc\n" });
  const lauf = hook(ordner, "docs/notiz.md", { pfadVariable: ohneProgramme() });
  assert.equal(lauf.status, 0);
  assert.equal(lauf.stdout, LEER);
  assert.match(lauf.stderr, /^sofort-pruefen: Prüfung übersprungen \(gitleaks nicht installiert\)$/m);
});

test("Typpruefung: Fehler in einer ts-Datei werden gemeldet, die der bearbeiteten Datei zuerst", () => {
  const ordner = arbeitsbaum({
    "src/andere.ts": 'export const ANDERE: number = "text";\n',
    "src/ganz.ts": "export const GANZ: number = 1;\n",
    "src/falsch.ts": 'export const OK = 1;\nexport const FALSCH: number = "text";\n',
  });
  const lauf = hook(ordner, "src/falsch.ts");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  const zeilen = lauf.stderr.split("\n").filter(Boolean);
  assert.match(zeilen[0], /^src\/falsch\.ts:2 {2}typpruefung {2}TS2322[^\n]*So geht es richtig: \S/);
  assert.match(zeilen[1], /^src\/andere\.ts:1 {2}typpruefung {2}TS2322/);
  assert.equal(zeilen.length, 2);
});

test("Typpruefung: es werden hoechstens zehn Fehler gemeldet", () => {
  const viele = Array.from({ length: 12 }, (_, nummer) => `export const F${nummer}: number = "text";`).join("\n");
  const ordner = arbeitsbaum({ "src/viele.ts": `${viele}\n` });
  const lauf = hook(ordner, "src/viele.ts");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  const meldungen = lauf.stderr.split("\n").filter(Boolean);
  assert.equal(meldungen.length, 10);
});

test("Typpruefung: saubere ts-Dateien und js-Dateien bleiben still", () => {
  const ordner = arbeitsbaum({ "src/ganz.ts": "export const GANZ: number = 1;\n", "src/a.js": "export const A = 1;\n" });
  still(hook(ordner, "src/ganz.ts"), "ts sauber");
  const mitFehler = arbeitsbaum({ "src/kaputt.ts": 'export const K: number = "text";\n', "src/a.js": "export const A = 1;\n" });
  still(hook(mitFehler, "src/a.js"), "js loest kein tsc aus");
});

test("ohne --hintergrund laufen Semgrep, gitleaks und tsc nicht", () => {
  const ordner = arbeitsbaum({ "scripts/a.mjs": "export const A = 1;\n" });
  writeFileSync(join(ordner, "scripts/a.mjs"), "export const B = eval(x);\nexport const GEHEIMNIS = 1;\n");
  still(hook(ordner, "scripts/a.mjs", { argumente: [] }), "schneller Teil");
});

test("--hintergrund fuehrt die schnellen Pruefungen nicht aus", () => {
  const ordner = arbeitsbaum({ "src/a.js": "export const A = 1;\n" });
  writeFileSync(join(ordner, "src/a.js"), "export const = ;\n");
  still(hook(ordner, "src/a.js"), "Syntaxfehler gehoert in den schnellen Teil");
});

test(".claude/settings.json ruft den Hook ein zweites Mal mit --hintergrund, asyncRewake und eigener Frist", () => {
  const eintraege = JSON.parse(readFileSync(EINSTELLUNGEN, "utf8")).hooks.PostToolUse;
  const befehle = eintraege.flatMap(({ hooks }) => hooks).filter(({ command }) => command.includes("sofort-pruefen.mjs"));
  assert.equal(befehle.length, 2);
  const [schnell, hintergrund] = befehle;
  assert.doesNotMatch(schnell.command, /--hintergrund/);
  assert.equal(schnell.asyncRewake, undefined);
  assert.match(hintergrund.command, /sofort-pruefen\.mjs"? --hintergrund$/);
  assert.equal(hintergrund.asyncRewake, true);
  assert.equal(hintergrund.timeout, EXPECTED_FRIST_S);
  const zweiter = eintraege.find(({ hooks }) => hooks.includes(hintergrund));
  assert.equal(zweiter.matcher, "Edit|Write|MultiEdit");
});
