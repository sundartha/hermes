import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const WURZEL = resolve(import.meta.dirname, "../..");
const PRUEFEN = join(WURZEL, "tools/pruefen.mjs");
const SUPPRESSIONS = "eslint-suppressions.json";
const REGEL_ALT = "alt-pfad";
const IMPORT_B = 'import { b } from "../src/b.js"; export const a = b;\n';
const IMPORT_B_UND_C = 'import { b } from "../src/b.js"; import { c } from "../src/c.js"; export const a = [b, c];\n';

function umgebung() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
}

function gitIn(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: umgebung(), encoding: "utf8" }).trim();
}

function ablegen(ordner, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
}

function pruefeSchritt(schritt, { vorher, nachher, entfernt }) {
  const ordner = mkdtempSync(join(tmpdir(), "testordner-umzug-"));
  try {
    gitIn(ordner, "init", "-q");
    ablegen(ordner, { ".gitignore": "node_modules\n", ...vorher });
    symlinkSync(join(WURZEL, "node_modules"), join(ordner, "node_modules"));
    gitIn(ordner, "add", "--", ".");
    gitIn(ordner, "commit", "-q", "-m", "basis");
    const basis = gitIn(ordner, "rev-parse", "HEAD");
    for (const pfad of entfernt) rmSync(join(ordner, pfad));
    ablegen(ordner, nachher);
    const ergebnis = spawnSync("node", [PRUEFEN, schritt, "--basis", basis], { cwd: ordner, env: umgebung(), encoding: "utf8" });
    return { gruen: ergebnis.status === 0, text: ergebnis.stdout };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function eingefroren(datei, anzahl = 2) {
  return `${JSON.stringify({ [datei]: { "no-undef": { count: anzahl } } }, null, 2)}\n`;
}

function bestand(vorher, nachher) {
  return pruefeSchritt("bestaende", { vorher: { [SUPPRESSIONS]: vorher }, nachher: { [SUPPRESSIONS]: nachher }, entfernt: [] });
}

function cruiser(...quellen) {
  const regeln = quellen.map((von) => `{name:"${REGEL_ALT}",severity:"error",from:{path:"${von}"},to:{path:"^src/[bc]\\\\.js$"}}`);
  return `module.exports={forbidden:[${regeln.join(",")}]};\n`;
}

function grundlage(von) {
  return { ".dependency-cruiser.cjs": cruiser(von), "src/b.js": "export const b = 1;\n", "src/c.js": "export const c = 1;\n" };
}

function architektur({ von = "^test/", vorher, nachher, entfernt = [] }) {
  return pruefeSchritt("architektur", { vorher: { ...grundlage(von), ...vorher }, nachher: { ...grundlage(von), ...nachher }, entfernt });
}

test("Testordner-Umzug Bestände: Eintrag zieht von test/x.test.js nach test/<bereich>/x.test.js, nichts neu", () => {
  const ergebnis = bestand(eingefroren("test/x.test.js", 3), eingefroren("test/sicherheit/x.test.js", 3));
  assert.match(ergebnis.text, /kein Eintrag neu oder gewachsen/);
  assert.equal(ergebnis.gruen, true);
});

const BESTAND_BLEIBT_ROT = [
  ["Zähler wächst beim Umzug", eingefroren("test/x.test.js", 3), eingefroren("test/sicherheit/x.test.js", 4)],
  ["anderer Dateiname", eingefroren("test/x.test.js"), eingefroren("test/sicherheit/y.test.js")],
  ["Umzug aus einem anderen Ordner", eingefroren("test/alt/x.test.js"), eingefroren("test/sicherheit/x.test.js")],
  ["Umzug aus src nach test", eingefroren("src/x.test.js"), eingefroren("test/sicherheit/x.test.js")],
  ["zwei Ordner tief", eingefroren("test/x.test.js"), eingefroren("test/sicherheit/tief/x.test.js")],
  ["Umzug in einen anderen Ordner als test", eingefroren("test/x.test.js"), eingefroren("tools/sicherheit/x.test.js")],
  ["Zurück in den flachen Ordner", eingefroren("test/sicherheit/x.test.js"), eingefroren("test/x.test.js")],
  ["Eintrag ohne Vorgänger", "{}\n", eingefroren("test/sicherheit/x.test.js")],
];

for (const [name, vorher, nachher] of BESTAND_BLEIBT_ROT) {
  test(`Testordner-Umzug Bestände: ${name} bleibt rot`, () => {
    const ergebnis = bestand(vorher, nachher);
    assert.equal(ergebnis.gruen, false);
    assert.match(ergebnis.text, /neu oder öfter eingefroren/);
  });
}

test("Testordner-Umzug Bestände: alter Eintrag bleibt zusätzlich, der neue ist rot", () => {
  const beide = JSON.stringify({ "test/x.test.js": { "no-undef": { count: 2 } }, "test/sicherheit/x.test.js": { "no-undef": { count: 2 } } });
  const ergebnis = bestand(eingefroren("test/x.test.js"), beide);
  assert.equal(ergebnis.gruen, false);
  assert.match(ergebnis.text, /neu oder öfter eingefroren: .*test\/sicherheit\/x\.test\.js/);
});

test("Testordner-Umzug Architektur: Verstoß zieht mit der Testdatei in den Bereichsordner, kein neuer Verstoß", () => {
  const ergebnis = architektur({ vorher: { "test/x.test.js": IMPORT_B }, nachher: { "test/sicherheit/x.test.js": IMPORT_B.replace("../src", "../../src") }, entfernt: ["test/x.test.js"] });
  assert.doesNotMatch(ergebnis.text, /Neuer Architekturverstoß/);
  assert.match(ergebnis.text, /Architektur: 0 neue Verstöße/);
  assert.equal(ergebnis.gruen, true);
});

const ARCHITEKTUR_BLEIBT_ROT = [
  ["zweiter Verstoß der verschobenen Datei", IMPORT_B, IMPORT_B_UND_C, "test/sicherheit/x.test.js → src/c.js"],
  ["alter Verstoß bleibt in der alten Datei", IMPORT_B, IMPORT_B, "test/sicherheit/x.test.js → src/b.js"],
];

for (const [name, alt, neu, erwartet] of ARCHITEKTUR_BLEIBT_ROT) {
  test(`Testordner-Umzug Architektur: ${name} bleibt neu`, () => {
    const verschoben = (inhalt) => inhalt.replaceAll("../src", "../../src");
    const behalten = name.includes("alter Verstoß bleibt") ? [] : ["test/x.test.js"];
    const ergebnis = architektur({ vorher: { "test/x.test.js": alt }, nachher: { "test/sicherheit/x.test.js": verschoben(neu), ...(behalten.length === 0 ? { "test/x.test.js": alt } : {}) }, entfernt: behalten });
    assert.match(ergebnis.text, new RegExp(`Neuer Architekturverstoß: ${REGEL_ALT}: ${erwartet.replaceAll(".", "\\.")}`));
    assert.equal(ergebnis.gruen, false);
  });
}

test("Testordner-Umzug Architektur: Verstoß einer Datei mit anderem Namen bleibt neu", () => {
  const ergebnis = architektur({ vorher: { "test/x.test.js": IMPORT_B }, nachher: { "test/sicherheit/y.test.js": IMPORT_B.replace("../src", "../../src") }, entfernt: ["test/x.test.js"] });
  assert.match(ergebnis.text, /Neuer Architekturverstoß: alt-pfad: test\/sicherheit\/y\.test\.js → src\/b\.js/);
  assert.equal(ergebnis.gruen, false);
});

test("Testordner-Umzug Architektur: Verstoß aus einem anderen Testordner bleibt neu", () => {
  const ergebnis = architektur({ vorher: { "test/alt/x.test.js": IMPORT_B }, nachher: { "test/sicherheit/x.test.js": IMPORT_B.replace("../src", "../../src") }, entfernt: ["test/alt/x.test.js"] });
  assert.match(ergebnis.text, /Neuer Architekturverstoß: alt-pfad: test\/sicherheit\/x\.test\.js → src\/b\.js/);
  assert.equal(ergebnis.gruen, false);
});

test("Testordner-Umzug Architektur: Umzug von .js nach .ts bleibt wie bisher ohne neuen Verstoß", () => {
  const ergebnis = architektur({ von: "^src/a\\\\.[jt]s$", vorher: { "test/leer.test.js": "export {};\n", "src/a.js": 'import { b } from "./b.js"; export const a = b;\n' }, nachher: { "test/leer.test.js": "export {};\n", "src/a.ts": 'import { b } from "./b.js"; export const a = b;\n' }, entfernt: ["src/a.js"] });
  assert.match(ergebnis.text, /Architektur: 0 neue Verstöße/);
  assert.equal(ergebnis.gruen, true);
});
