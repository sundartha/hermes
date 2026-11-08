import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");
const PRUEFEN = join(WURZEL, "tools/pruefen.mjs");
const SUPPRESSIONS = "eslint-suppressions.json";
const FEST = "tools/basis/fester-importpfad.json";
const REGEL = "a-nicht-nach-b";
const CRUISER = ".dependency-cruiser.cjs";

function gitUmgebung() {
  const umgebung = { ...process.env };
  for (const name of Object.keys(umgebung)) if (name.startsWith("GIT_")) delete umgebung[name];
  return umgebung;
}

function git(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: gitUmgebung(), encoding: "utf8" }).trim();
}

function schreibe(ordner, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
}

function json(wert) {
  return `${JSON.stringify(wert, null, 2)}\n`;
}

function lauf(schritt, vorher, { nachher, entfernt = [] }) {
  const ordner = mkdtempSync(join(tmpdir(), "umzug-"));
  try {
    git(ordner, "init", "-q");
    schreibe(ordner, { ".gitignore": "node_modules\n", ...vorher });
    symlinkSync(join(WURZEL, "node_modules"), join(ordner, "node_modules"));
    git(ordner, "add", "--", ".");
    git(ordner, "commit", "-q", "-m", "basis");
    const basis = git(ordner, "rev-parse", "HEAD");
    for (const pfad of entfernt) rmSync(join(ordner, pfad));
    schreibe(ordner, nachher);
    const ergebnis = spawnSync("node", [PRUEFEN, schritt, "--basis", basis], { cwd: ordner, env: gitUmgebung(), encoding: "utf8" });
    return { gruen: ergebnis.status === 0, text: ergebnis.stdout };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function suppressions(...eintraege) {
  return json(Object.fromEntries(eintraege.map(([datei, regel, anzahl]) => [datei, { [regel]: { count: anzahl } }])));
}

function bestaende(vorher, nachher) {
  return lauf("bestaende", vorher, { nachher });
}

test("SG-21 Bestände: genau ein Eintrag zieht von .js nach .ts um, kein gewachsener Eintrag", () => {
  const ergebnis = bestaende(
    { [SUPPRESSIONS]: suppressions(["src/a.js", "no-undef", 3]) },
    { [SUPPRESSIONS]: suppressions(["src/a.ts", "no-undef", 3]) },
  );
  assert.match(ergebnis.text, /kein Eintrag neu oder gewachsen/);
  assert.equal(ergebnis.gruen, true);
});

test("SG-21 Bestände: Umzug in einer Liste mit Zähler pro Schlüssel", () => {
  const alt = { [FEST]: json({ befunde: ["src/a.js|h1", "src/a.js|h1", "src/c.js|h2"] }) };
  const beide = bestaende(alt, { [FEST]: json({ befunde: ["src/a.ts|h1", "src/a.ts|h1", "src/c.js|h2"] }) });
  assert.equal(beide.gruen, true);
  const zuviele = bestaende(alt, { [FEST]: json({ befunde: ["src/a.ts|h1", "src/a.ts|h1", "src/a.ts|h1", "src/c.js|h2"] }) });
  assert.equal(zuviele.gruen, false);
  assert.match(zuviele.text, /neu oder öfter eingefroren: befunde\|src\/a\.ts\|h1/);
});

test("SG-21 Bestände: Listeneintrag, der nur teilweise nach .ts umzieht, bleibt rot", () => {
  const alt = { [FEST]: json({ befunde: ["src/a.js|h1", "src/a.js|h1"] }) };
  const ergebnis = bestaende(alt, { [FEST]: json({ befunde: ["src/a.js|h1", "src/a.ts|h1"] }) });
  assert.equal(ergebnis.gruen, false);
  assert.match(ergebnis.text, /neu oder öfter eingefroren: befunde\|src\/a\.ts\|h1/);
});

test("SG-21 Bestände: Zähler sinkt beim Umzug von .js nach .ts bleibt grün", () => {
  const ergebnis = bestaende({ [SUPPRESSIONS]: suppressions(["src/a.js", "no-undef", 3]) }, { [SUPPRESSIONS]: suppressions(["src/a.ts", "no-undef", 2]) });
  assert.equal(ergebnis.gruen, true);
});

const BESTAND_ROT = [
  [
    "alter Eintrag bleibt zusätzlich",
    suppressions(["src/a.js", "no-undef", 3]),
    json({ "src/a.js": { "no-undef": { count: 3 } }, "src/a.ts": { "no-undef": { count: 3 } } }),
  ],
  [
    "alter Eintrag schrumpft nur und bleibt zusätzlich",
    suppressions(["src/a.js", "no-undef", 3]),
    json({ "src/a.js": { "no-undef": { count: 1 } }, "src/a.ts": { "no-undef": { count: 2 } } }),
  ],
  [
    "zwei neue Einträge für einen verschwundenen",
    suppressions(["src/a.js", "no-undef", 3]),
    json({ "src/a.ts": { "no-undef": { count: 3 }, "id-length": { count: 3 } } }),
  ],
  [
    "Eintrag einer anderen Datei verschwindet",
    json({ "src/a.js": { "no-undef": { count: 3 } }, "src/b.js": { "no-undef": { count: 3 } } }),
    suppressions(["src/a.js", "no-undef", 3], ["src/c.ts", "no-undef", 3]),
  ],
  ["Zähler wächst beim Umzug", suppressions(["src/a.js", "no-undef", 3]), suppressions(["src/a.ts", "no-undef", 4])],
  ["Regelname ändert sich beim Umzug", suppressions(["src/a.js", "no-undef", 3]), suppressions(["src/a.ts", "id-length", 3])],
  ["anderer Pfad beim Umzug", suppressions(["src/a.js", "no-undef", 3]), suppressions(["src/b.ts", "no-undef", 3])],
  ["ts zu js", suppressions(["src/a.ts", "no-undef", 3]), suppressions(["src/a.js", "no-undef", 3])],
  ["mjs zu ts", suppressions(["src/a.mjs", "no-undef", 3]), suppressions(["src/a.ts", "no-undef", 3])],
  ["cjs zu ts", suppressions(["src/a.cjs", "no-undef", 3]), suppressions(["src/a.ts", "no-undef", 3])],
  ["Eintrag ohne Vorgänger", json({}), suppressions(["src/a.ts", "no-undef", 3])],
];

for (const [name, vorher, nachher] of BESTAND_ROT) {
  test(`SG-21 Bestände: ${name} bleibt rot`, () => {
    const ergebnis = bestaende({ [SUPPRESSIONS]: vorher }, { [SUPPRESSIONS]: nachher });
    assert.equal(ergebnis.gruen, false);
    assert.match(ergebnis.text, /neu oder öfter eingefroren/);
  });
}

test("SG-21 Bestände: Wachstum ohne Umzug und Schrumpfen verhalten sich wie bisher", () => {
  const wachsen = bestaende({ [SUPPRESSIONS]: suppressions(["src/a.js", "no-undef", 3]) }, { [SUPPRESSIONS]: suppressions(["src/a.js", "no-undef", 4]) });
  assert.equal(wachsen.gruen, false);
  const schrumpfen = bestaende({ [SUPPRESSIONS]: suppressions(["src/a.js", "no-undef", 3]) }, { [SUPPRESSIONS]: suppressions(["src/a.js", "no-undef", 2]) });
  assert.equal(schrumpfen.gruen, true);
});

function grundlage(regel = REGEL, vonPfad = "a") {
  return {
    [CRUISER]: `module.exports={forbidden:[{name:"${regel}",severity:"error",from:{path:"^src/${vonPfad}\\\\.[jt]s$"},to:{path:"^src/b\\\\.[jt]s$"}}]};\n`,
    "test/leer.js": "\n",
    "src/b.js": "export const b = 1;\n",
  };
}

const IMPORT_B = 'import { b } from "./b.js"; export const a = b;\n';

function architektur(vorher, nachher, entfernt = []) {
  return lauf("architektur", vorher, { nachher, entfernt });
}

test("SG-21 Architektur: Verstoß zieht mit seiner Datei von .js nach .ts um, kein neuer Verstoß", () => {
  const ergebnis = architektur({ ...grundlage(), "src/a.js": IMPORT_B }, { "src/a.ts": IMPORT_B }, ["src/a.js"]);
  assert.doesNotMatch(ergebnis.text, /Neuer Architekturverstoß/);
  assert.match(ergebnis.text, /Architektur: 0 neue Verstöße/);
  assert.equal(ergebnis.gruen, true);
});

test("SG-21 Architektur: beide Enden des Verstoßes ziehen um", () => {
  const ergebnis = architektur(
    { ...grundlage(), "src/a.js": IMPORT_B },
    { "src/a.ts": 'import { b } from "./b.ts"; export const a = b;\n', "src/b.ts": "export const b = 1;\n" },
    ["src/a.js", "src/b.js"],
  );
  assert.match(ergebnis.text, /Architektur: 0 neue Verstöße/);
});

test("SG-21 Architektur: Verstoß bleibt neu, wenn der Basis-Verstoß bestehen bleibt", () => {
  const ergebnis = architektur({ ...grundlage(), "src/a.js": IMPORT_B }, { "src/a.ts": IMPORT_B });
  assert.match(ergebnis.text, new RegExp(`Neuer Architekturverstoß: ${REGEL}: src/a\\.ts → src/b\\.js`));
  assert.equal(ergebnis.gruen, false);
});

test("SG-21 Architektur: Verstoß einer anderen Datei bleibt neu", () => {
  const vorher = { ...grundlage(REGEL, "[ac]"), "src/a.js": IMPORT_B };
  const ergebnis = architektur(vorher, { "src/c.ts": IMPORT_B }, ["src/a.js"]);
  assert.match(ergebnis.text, new RegExp(`Neuer Architekturverstoß: ${REGEL}: src/c\\.ts → src/b\\.js`));
  assert.equal(ergebnis.gruen, false);
});

test("SG-21 Architektur: Verstoß einer anderen Regel bleibt neu", () => {
  const ergebnis = architektur({ ...grundlage(), "src/a.js": IMPORT_B }, { ...grundlage("andere-regel"), "src/a.ts": IMPORT_B }, ["src/a.js"]);
  assert.match(ergebnis.text, /Neuer Architekturverstoß: andere-regel: src\/a\.ts → src\/b\.js/);
  assert.equal(ergebnis.gruen, false);
});

test("SG-21 Architektur: ts zu js und mjs zu ts bleiben neu", () => {
  const tsAlt = { ...grundlage(), "src/a.ts": IMPORT_B };
  const zuJs = architektur(tsAlt, { "src/a.js": IMPORT_B }, ["src/a.ts"]);
  assert.match(zuJs.text, /Neuer Architekturverstoß: a-nicht-nach-b: src\/a\.js → src\/b\.js/);
  const mjs = architektur({ ...grundlage(), "src/a.mjs": IMPORT_B }, { "src/a.ts": IMPORT_B }, ["src/a.mjs"]);
  assert.equal(mjs.gruen, false);
  assert.match(mjs.text, /Neuer Architekturverstoß/);
});

test("SG-21 Architektur: neuer Verstoß ohne Vorgänger bleibt rot, Basis ohne Verstoß bleibt grün", () => {
  const sauber = { ...grundlage(), "src/a.js": "export const a = 1;\n" };
  assert.equal(architektur(sauber, { "src/a.ts": "export const a = 1;\n" }, ["src/a.js"]).gruen, true);
  const neu = architektur(sauber, { "src/a.js": IMPORT_B });
  assert.equal(neu.gruen, false);
  assert.match(neu.text, /Neuer Architekturverstoß: a-nicht-nach-b: src\/a\.js → src\/b\.js/);
});
