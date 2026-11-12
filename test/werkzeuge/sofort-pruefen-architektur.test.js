import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const HOOK = join(WURZEL, ".claude/hooks/sofort-pruefen.mjs");
const PROJEKTKONFIGURATION = pathToFileURL(join(WURZEL, "eslint.config.js")).href;
const FRIST_MS = 120_000;
const VERSTOSS_EXIT = 2;
const LEER = "";
const KARTE = "tools/bausteine.json";
const KATALOG = "docs/sicherheitsgrenzen.md";
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

function einchecken(ordner) {
  git(ordner, "init", "-q", "-b", "paket/probe");
  writeFileSync(join(ordner, ".git/info/exclude"), "/node_modules\n");
  git(ordner, "add", "-A");
  git(ordner, "commit", "-q", "-m", "basis");
  git(ordner, "update-ref", "refs/remotes/hermes/master", "HEAD");
  symlinkSync(join(WURZEL, "node_modules"), join(ordner, "node_modules"));
}

function schreiben(ordner, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
}

function kleinerBaum(dateien, karte) {
  const ordner = mkdtempSync(join(tmpdir(), "sofort-architektur-"));
  arbeitsbaeume.push(ordner);
  schreiben(ordner, {
    "package.json": '{"type":"module"}\n',
    "eslint.config.js": `export { default } from "${PROJEKTKONFIGURATION}";\n`,
    ".dependency-cruiser.cjs": readFileSync(join(WURZEL, ".dependency-cruiser.cjs")),
    ...(karte === undefined ? {} : { [KARTE]: JSON.stringify(karte) }),
    "tools/katalog-pruefen.mjs": "process.exitCode = 0;\n",
    "test/leer.js": "export const LEER = 1;\n",
    ...dateien,
  });
  einchecken(ordner);
  return ordner;
}

function echterBaum() {
  const ordner = mkdtempSync(join(tmpdir(), "sofort-architektur-echt-"));
  arbeitsbaeume.push(ordner);
  for (const eintrag of ["src", "test", "docs", "tools", "package.json", ".dependency-cruiser.cjs", "eslint.config.js", "eslint-suppressions.json", "tsconfig.json", "gitleaks.toml"]) {
    cpSync(join(WURZEL, eintrag), join(ordner, eintrag), { recursive: true });
  }
  einchecken(ordner);
  return ordner;
}

function hook(ordner, pfad) {
  const eingabe = JSON.stringify({ cwd: ordner, tool_input: { file_path: join(ordner, pfad) } });
  return spawnSync("node", [HOOK], { input: eingabe, encoding: "utf8", timeout: FRIST_MS, env: ohneGitUmgebung() });
}

function still(lauf, name) {
  assert.equal(lauf.status, 0, `${name}: ${lauf.stderr}`);
  assert.equal(lauf.stderr, LEER, name);
  assert.equal(lauf.stdout, LEER, name);
}

const KARTE_KLEIN = {
  schichten: [["texte"], ["anrufe"]],
  bausteine: [
    { baustein: "texte", zweck: "Texte.", quellen: ["src/i18n/"], eingaenge: ["src/i18n/index.js"], nutzt: [] },
    { baustein: "anrufe", zweck: "Anrufe.", quellen: ["src/anrufe/"], eingaenge: ["src/anrufe/index.js"], nutzt: [] },
  ],
  altlast: [],
};
const STORE = { "src/store.js": "export const STORE = 1;\n", "src/store/intern.js": "export const INTERN = 1;\n" };
const AM_EINGANG_VORBEI = 'import { INTERN } from "../store/intern.js";\n\nexport const WERT = INTERN;\n';
const SAUBER = 'import { STORE } from "../store.js";\n\nexport const WERT = STORE;\n';
const I18N = { ...STORE, "src/i18n/index.js": "export const TEXT = 1;\n", "src/i18n/intern.js": "export const INTERN = 1;\n" };

test("ein neuer Import an der Speicher-Fassade vorbei wird mit Datei, Regel und Weg gemeldet", () => {
  const ordner = kleinerBaum({ ...STORE, "src/anrufe/a.js": SAUBER });
  still(hook(ordner, "src/anrufe/a.js"), "sauber");
  writeFileSync(join(ordner, "src/anrufe/a.js"), AM_EINGANG_VORBEI);
  const lauf = hook(ordner, "src/anrufe/a.js");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /^src\/anrufe\/a\.js:1 {2}architektur {2}Neuer Verstoß speicher-nur-ueber-fassade: src\/anrufe\/a\.js → src\/store\/intern\.js\. So geht es richtig: [^\n]*\.dependency-cruiser\.cjs[^\n]*tools\/bausteine\.json/m);
});

test("ein Architekturverstoß, den schon die Basis hat, bleibt still", () => {
  const ordner = kleinerBaum({ ...STORE, "src/anrufe/a.js": AM_EINGANG_VORBEI });
  still(hook(ordner, "src/anrufe/a.js"), "bekannt");
});

test("ein Verstoß einer anderen Datei wird nicht der bearbeiteten Datei angelastet", () => {
  const ordner = kleinerBaum({ ...STORE, "src/anrufe/a.js": SAUBER, "src/anrufe/b.js": SAUBER });
  writeFileSync(join(ordner, "src/anrufe/b.js"), AM_EINGANG_VORBEI);
  still(hook(ordner, "src/anrufe/a.js"), "fremde Datei");
});

test("ein Import an einem Eingang des Bausteins vorbei wird aus der Bausteinkarte gemeldet", () => {
  const ordner = kleinerBaum({ ...I18N, "src/anrufe/a.js": 'import { TEXT } from "../i18n/index.js";\n\nexport const WERT = TEXT;\n' }, KARTE_KLEIN);
  still(hook(ordner, "src/anrufe/a.js"), "ueber den Eingang");
  writeFileSync(join(ordner, "src/anrufe/a.js"), 'import { INTERN } from "../i18n/intern.js";\n\nexport const WERT = INTERN;\n');
  const lauf = hook(ordner, "src/anrufe/a.js");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /^src\/anrufe\/a\.js:1 {2}bausteinkarte {2}src\/anrufe\/a\.js → src\/i18n\/intern\.js: [^\n]*kein Eingang von texte[^\n]*So geht es richtig: \S/m);
});

test("eine neue Datei ohne Baustein wird aus der Bausteinkarte gemeldet", () => {
  const ordner = kleinerBaum({ ...I18N }, KARTE_KLEIN);
  schreiben(ordner, { "src/lose.js": "export const LOSE = 1;\n" });
  const lauf = hook(ordner, "src/lose.js");
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /^src\/lose\.js:1 {2}bausteinkarte {2}[^\n]*src\/lose\.js gehört zu keinem Baustein[^\n]*So geht es richtig: \S/m);
});

test("wer tools/bausteine.json bearbeitet, erfaehrt, dass die Ordner-Hinweise nicht mehr passen", () => {
  const ordner = kleinerBaum({ ...I18N, "src/anrufe/a.js": SAUBER }, KARTE_KLEIN);
  const lauf = hook(ordner, KARTE);
  assert.equal(lauf.status, VERSTOSS_EXIT);
  assert.match(lauf.stderr, /^tools\/bausteine\.json:1 {2}bausteinkarte {2}src\/i18n\/CLAUDE\.md passt nicht mehr zu tools\/bausteine\.json: npm run hinweise ausführen\. So geht es richtig: \S/m);
});

test("Architektur und Katalog bleiben ausserhalb ihrer Bereiche still", () => {
  const ordner = kleinerBaum({ ...STORE, "src/anrufe/a.js": AM_EINGANG_VORBEI, "docs/x.md": "x\n", "scripts/s.mjs": "export const S = 1;\n" });
  still(hook(ordner, "docs/x.md"), "docs");
  still(hook(ordner, "scripts/s.mjs"), "scripts");
});

test("der Bedrohungskatalog meldet bei einer doppelten Zeile, bei Aenderung am Katalog wie an src, und bleibt sonst still", () => {
  const ordner = echterBaum();
  const beginn = Date.now();
  still(hook(ordner, "src/config.js"), "sauber");
  assert.ok(Date.now() - beginn < FRIST_MS);
  const zeile = readFileSync(join(ordner, KATALOG), "utf8").split("\n").find((text) => text.startsWith("| SG-01 |"));
  appendFileSync(join(ordner, KATALOG), `${zeile}\n`);
  for (const pfad of [KATALOG, "src/config.js"]) {
    const lauf = hook(ordner, pfad);
    assert.equal(lauf.status, VERSTOSS_EXIT, pfad);
    assert.match(lauf.stderr, new RegExp(`^${pfad.replace(".", "\\.")}:1 {2}bedrohungskatalog {2}[^\\n]*SG-01 steht mehrfach[^\\n]*So geht es richtig: [^\\n]*SG-<nr>`, "m"), pfad);
  }
});
