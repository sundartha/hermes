import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const WERKZEUG_URL = pathToFileURL(join(REPO_ROOT, "tools/freigabe-strenger.mjs")).href;
const AUFRUF = [
  `import { stricterCases } from ${JSON.stringify(WERKZEUG_URL)};`,
  "const [, pfad] = process.argv;",
  'const faelle = stricterCases("HEAD~1", [{ status: "M", path: pfad }]);',
  "console.log(JSON.stringify(faelle ?? null));",
].join("\n");
const ALTBEFUNDE_GESTRICHEN = "(a) Altbefunde gestrichen";
const SELBSTPRUEFUNG = "tools/basis/selbstpruefung.json";
const FESTER_IMPORTPFAD = "tools/basis/fester-importpfad.json";
const TESTIMPORTE = "tools/basis/test-importe.json";

function befundListe(...befunde) {
  return `${JSON.stringify({ befunde })}\n`;
}

function testimporte(...ziele) {
  const eintraege = ziele.map((ziel) => ({
    from: "test/anrufe/alt.test.js",
    to: ziel,
    rule: { name: "tests-nur-ueber-eingaenge" },
  }));
  return `${JSON.stringify(eintraege)}\n`;
}

function einstufung(context, pfad, { vorher, nachher }) {
  const verzeichnis = probeRepository(context, { [pfad]: vorher });
  writeFiles(verzeichnis, { [pfad]: nachher });
  commitAll(verzeichnis, "geaendert");
  const lauf = runIn(verzeichnis, process.execPath, ["--input-type=module", "-e", AUFRUF, pfad]);
  assert.equal(lauf.status, 0, lauf.stderr);
  return JSON.parse(lauf.stdout);
}

test("freigabe-strenger: aus tools/basis/selbstpruefung.json nur streichen ist strenger", (context) => {
  const faelle = einstufung(context, SELBSTPRUEFUNG, {
    vorher: befundListe("a", "b"),
    nachher: befundListe("b"),
  });
  assert.deepEqual(faelle, [{ path: SELBSTPRUEFUNG, fall: ALTBEFUNDE_GESTRICHEN }]);
});

test("freigabe-strenger: aus tools/basis/fester-importpfad.json nur streichen ist strenger", (context) => {
  const faelle = einstufung(context, FESTER_IMPORTPFAD, {
    vorher: befundListe("a", "b"),
    nachher: befundListe("a"),
  });
  assert.deepEqual(faelle, [{ path: FESTER_IMPORTPFAD, fall: ALTBEFUNDE_GESTRICHEN }]);
});

test("freigabe-strenger: aus tools/basis/test-importe.json nur streichen ist strenger", (context) => {
  const faelle = einstufung(context, TESTIMPORTE, {
    vorher: testimporte("src/store/defaults.js", "src/store/state-ops.js"),
    nachher: testimporte("src/store/state-ops.js"),
  });
  assert.deepEqual(faelle, [{ path: TESTIMPORTE, fall: ALTBEFUNDE_GESTRICHEN }]);
});

test("freigabe-strenger: ein neuer Eintrag in einem Bestand der Testregeln ist nicht strenger", (context) => {
  const befunde = einstufung(context, SELBSTPRUEFUNG, {
    vorher: befundListe("a"),
    nachher: befundListe("a", "b"),
  });
  const importe = einstufung(context, TESTIMPORTE, {
    vorher: testimporte("src/store/defaults.js"),
    nachher: testimporte("src/store/defaults.js", "src/store/pg.js"),
  });
  assert.deepEqual([befunde, importe], [null, null]);
});

const UNTERDRUECKUNGEN = "eslint-suppressions.json";

function unterdrueckungen(zahlen) {
  const eintraege = Object.entries(zahlen).map(([datei, count]) => [datei, { complexity: { count } }]);
  return `${JSON.stringify(Object.fromEntries(eintraege))}\n`;
}

test("freigabe-strenger: eine gesenkte Zahl in eslint-suppressions.json ist strenger", (context) => {
  const faelle = einstufung(context, UNTERDRUECKUNGEN, {
    vorher: unterdrueckungen({ "src/a.js": 3, "src/b.js": 1 }),
    nachher: unterdrueckungen({ "src/a.js": 2, "src/b.js": 1 }),
  });
  assert.deepEqual(faelle, [{ path: UNTERDRUECKUNGEN, fall: ALTBEFUNDE_GESTRICHEN }]);
});

test("freigabe-strenger: ein gestrichener Eintrag in eslint-suppressions.json ist strenger", (context) => {
  const faelle = einstufung(context, UNTERDRUECKUNGEN, {
    vorher: unterdrueckungen({ "src/a.js": 3, "src/b.js": 1 }),
    nachher: unterdrueckungen({ "src/a.js": 3 }),
  });
  assert.deepEqual(faelle, [{ path: UNTERDRUECKUNGEN, fall: ALTBEFUNDE_GESTRICHEN }]);
});

test("freigabe-strenger: eine erhöhte oder neue Zahl in eslint-suppressions.json ist nicht strenger", (context) => {
  const erhoeht = einstufung(context, UNTERDRUECKUNGEN, {
    vorher: unterdrueckungen({ "src/a.js": 3, "src/b.js": 1 }),
    nachher: unterdrueckungen({ "src/a.js": 2, "src/b.js": 2 }),
  });
  const neu = einstufung(context, UNTERDRUECKUNGEN, {
    vorher: unterdrueckungen({ "src/a.js": 3 }),
    nachher: unterdrueckungen({ "src/a.js": 2, "src/c.js": 1 }),
  });
  assert.deepEqual([erhoeht, neu], [null, null]);
});
