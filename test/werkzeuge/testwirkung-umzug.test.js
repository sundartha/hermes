import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { EXIT_GRUEN, EXIT_ROT } from "./testwirkung-probe.js";

const WERKZEUG = join(REPO_ROOT, "tools/testwirkung.mjs");
const DATEN = '{ "summe": 3 }\n';
const ALTE_DATEI = "docs/daten.json";
const NEUE_DATEI = "test/daten.json";
const TESTDATEI = "test/daten.test.js";
const NOTIZ = "docs/notiz.md";
const NOTIZ_ARCHIVIERT = "docs/archiv/notiz.md";
const AUS_DATEI = (pfad) => `JSON.parse(readFileSync(new URL(${JSON.stringify(pfad)}, import.meta.url), "utf8"))`;
const EINGEBAUT = "{ summe: 3 }";
const RUECKFALL = "    return leer();";

function datentest(daten) {
  return [
    'import assert from "node:assert/strict";',
    'import { readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    "function lade() {",
    "  try {",
    `    return ${daten};`,
    "  } catch {",
    RUECKFALL,
    "  }",
    "}",
    "function leer() {",
    "  return { summe: 0 };",
    "}",
    'test("liest die Daten", () => {',
    "  assert.equal(lade().summe, 3);",
    "});",
    "",
  ].join("\n");
}

function pruefeNachAenderung(context, { neu, entfernt }) {
  const repo = probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    [ALTE_DATEI]: DATEN,
    [NOTIZ]: "Notiz\n",
    [TESTDATEI]: datentest(AUS_DATEI("../docs/daten.json")),
  });
  writeFiles(repo, neu);
  for (const datei of entfernt) rmSync(join(repo, datei));
  commitAll(repo, "Änderung");
  return runIn(repo, process.execPath, [WERKZEUG, "--basis", "HEAD~1"]);
}

const RUECKFALL_ZEILE = datentest(EINGEBAUT).split("\n").indexOf(RUECKFALL) + 1;
const ROT = new RegExp(`^Verstoß: Zeilen laufen nach der Änderung nicht mehr, die auf der Basis liefen: test/daten\\.test\\.js \\(Zeile ${RUECKFALL_ZEILE}\\)$`, "m");

test("eine Datendatei, die von docs/ nach test/ umzieht, bleibt im Basislauf für den alten Test sichtbar", (context) => {
  const lauf = pruefeNachAenderung(context, {
    neu: { [NEUE_DATEI]: DATEN, [TESTDATEI]: datentest(AUS_DATEI("./daten.json")), [NOTIZ_ARCHIVIERT]: "Notiz\n" },
    entfernt: [ALTE_DATEI, NOTIZ],
  });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stdout, /^Verstoß:/m);
  assert.match(lauf.stdout, /^Erreichte Zeilen: 1 geänderte Dateien unter test\/ verglichen, 0 Tests oder Hilfsdateien erreichen Zeilen der Basis nicht mehr\.$/m);
});

test("eine gelöschte Datendatei ohne Umzug fehlt im Basislauf weiter, und der Rückfall des alten Tests zählt als erreichte Zeile", (context) => {
  const lauf = pruefeNachAenderung(context, { neu: { [TESTDATEI]: datentest(EINGEBAUT) }, entfernt: [ALTE_DATEI] });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, ROT);
});

test("eine Datendatei, die nur innerhalb von docs/ umzieht, fehlt im Basislauf weiter", (context) => {
  const lauf = pruefeNachAenderung(context, {
    neu: { "docs/archiv/daten.json": DATEN, [TESTDATEI]: datentest(AUS_DATEI("../docs/archiv/daten.json")) },
    entfernt: [ALTE_DATEI],
  });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, ROT);
});
