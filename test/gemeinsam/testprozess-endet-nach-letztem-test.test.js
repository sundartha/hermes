import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const TESTORDNER = fileURLToPath(new URL("..", import.meta.url));
const HILFEN_DIE_PGLITE_SELBST_ANLEGEN = new Set(["pglite-helfer.js", path.join("gemeinsam", "pglite-instanz.js")]);
const PGLITE_ANLAGE = /new\s+PGlite\s*\(|PGlite\s*\.\s*create\s*\(/;
const PGLITE_IMPORT = /@electric-sql[\\/"'`,+\s]*pglite/;
const SKRIPTENDUNG = /\.(?:js|mjs|cjs)$/;
const BEISPIELDATEI = path.join(TESTORDNER, "absender-wahrheit-pg.test.js");
const ERGEBNISZEILE = /^\s*(?:not )?ok \d+ /;
const HOECHSTENS_MS_NACH_DEM_LETZTEN_TEST = 1000;
const IMPORTFORMEN = JSON.parse(fs.readFileSync(new URL("./pglite-importformen.json", import.meta.url), "utf8"));

function testdateien(ordner) {
  return fs.readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
    const voll = path.join(ordner, eintrag.name);
    if (eintrag.isDirectory()) return testdateien(voll);
    return SKRIPTENDUNG.test(eintrag.name) ? [voll] : [];
  });
}

function laufZeitenMessen(datei) {
  const umgebung = { ...process.env, NODE_ENV: "test" };
  delete umgebung.NODE_TEST_CONTEXT;
  const kind = spawn(process.execPath, ["--test-reporter=tap", datei], { env: umgebung });
  let letztesErgebnis = null;
  let rest = "";
  let ausgabe = "";
  kind.stdout.setEncoding("utf8");
  kind.stdout.on("data", (stueck) => {
    ausgabe += stueck;
    const zeilen = (rest + stueck).split("\n");
    rest = zeilen.pop();
    if (zeilen.some((zeile) => ERGEBNISZEILE.test(zeile))) letztesErgebnis = performance.now();
  });
  kind.stderr.resume();
  return new Promise((resolve, reject) => {
    kind.on("error", reject);
    kind.on("exit", (code) => resolve({ code, letztesErgebnis, ende: performance.now(), ausgabe }));
  });
}

function dateienMitPgliteAnDenHilfenVorbei(ordner) {
  const vorbei = [];
  for (const datei of testdateien(ordner)) {
    const relativ = path.relative(ordner, datei);
    if (HILFEN_DIE_PGLITE_SELBST_ANLEGEN.has(relativ)) continue;
    const inhalt = fs.readFileSync(datei, "utf8");
    if (PGLITE_ANLAGE.test(inhalt) || PGLITE_IMPORT.test(inhalt)) vorbei.push(relativ);
  }
  return vorbei.sort();
}

function ordnerMitDateien(inhalte) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-pglite-waechter-"));
  for (const [relativ, inhalt] of Object.entries(inhalte)) {
    const ziel = path.join(ordner, relativ);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, inhalt);
  }
  return ordner;
}

test("keine Testdatei legt PGlite an den Hilfen vorbei an, die ihre Instanzen am Ende schliessen", () => {
  const vorbei = dateienMitPgliteAnDenHilfenVorbei(TESTORDNER);
  assert.deepEqual(vorbei, [], `PGlite direkt angelegt statt ueber test/gemeinsam/pglite-instanz.js:\n${vorbei.join("\n")}`);
});

test("der Waechter meldet jede Schreibweise, mit der eine Testdatei PGlite an den Hilfen vorbei laedt", (t) => {
  const ordner = ordnerMitDateien({ ...IMPORTFORMEN.erkannt, ...IMPORTFORMEN.unauffaellig });
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const erwartet = Object.keys(IMPORTFORMEN.erkannt).map((relativ) => path.normalize(relativ)).sort();
  assert.deepEqual(dateienMitPgliteAnDenHilfenVorbei(ordner), erwartet);
});

test("eine Testdatei mit PGlite endet binnen einer Sekunde nach ihrem letzten Test", async () => {
  const { code, letztesErgebnis, ende, ausgabe } = await laufZeitenMessen(BEISPIELDATEI);
  assert.equal(code, 0, ausgabe);
  assert.ok(letztesErgebnis !== null, ausgabe);
  const nachklang = Math.round(ende - letztesErgebnis);
  assert.ok(
    nachklang <= HOECHSTENS_MS_NACH_DEM_LETZTEN_TEST,
    `Prozess lief noch ${nachklang} ms nach dem letzten Testergebnis`,
  );
});
