import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  DEPENDENCY_TOOL,
  REPO_ROOT,
  commitAll,
  probeRepository,
  runIn,
  writeFiles,
} from "./probe-repo.js";

const KONFIGURATION = ".dependency-cruiser.cjs";
const SELBSTPRUEFUNG = "tools/basis/selbstpruefung.json";
const FESTER_IMPORTPFAD = "tools/basis/fester-importpfad.json";
const ALT = "test/anrufe/alt.test.js|0123456789abcdef";
const ZWEITER = "test/anrufe/alt.test.js|fedcba9876543210";
const NEU = "test/anrufe/neu.test.js|00112233aabbccdd";
const EXIT_OK = 0;
const EXIT_FINDING = 1;

const GRUNDSTAND = {
  [KONFIGURATION]: readFileSync(join(REPO_ROOT, KONFIGURATION), "utf8"),
  "src/app.js": "export const app = true;\n",
};

function bestand(...eintraege) {
  return `${JSON.stringify({ befunde: eintraege })}\n`;
}

function nachAenderung(context, { vorher, nachher }) {
  const verzeichnis = probeRepository(context, { ...GRUNDSTAND, ...vorher });
  writeFiles(verzeichnis, nachher);
  commitAll(verzeichnis, "geaendert");
  return runIn(verzeichnis, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD~1"]);
}

test("bestaende: ein neuer Eintrag in tools/basis/selbstpruefung.json ist rot", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: { [SELBSTPRUEFUNG]: bestand(ALT) },
    nachher: { [SELBSTPRUEFUNG]: bestand(ALT, NEU) },
  });
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(
    ergebnis.stderr,
    /tools\/basis\/selbstpruefung\.json darf nur kürzer werden, neu oder öfter eingefroren ist: test\/anrufe\/neu\.test\.js\|00112233aabbccdd/,
  );
});

test("bestaende: derselbe Eintrag ein zweites Mal in tools/basis/fester-importpfad.json ist rot", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: { [FESTER_IMPORTPFAD]: bestand(ALT) },
    nachher: { [FESTER_IMPORTPFAD]: bestand(ALT, ALT) },
  });
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(ergebnis.stderr, /tools\/basis\/fester-importpfad\.json darf nur kürzer werden/);
});

test("bestaende: gekürzte Bestände sind grün", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: {
      [SELBSTPRUEFUNG]: bestand(ALT, ZWEITER),
      [FESTER_IMPORTPFAD]: bestand(ALT, ZWEITER),
    },
    nachher: { [SELBSTPRUEFUNG]: bestand(ZWEITER), [FESTER_IMPORTPFAD]: bestand() },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^0 neue Dateien unter test\/ seit der Basis/m);
});

test("bestaende: ein Bestand, den es auf der Basis noch nicht gibt, gilt als neu angelegt", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: {},
    nachher: { [SELBSTPRUEFUNG]: bestand(ALT, NEU) },
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^0 neue Dateien unter test\/ seit der Basis/m);
});

const QUELLTEXT = "tools/basis/quelltext-als-text.json";
const ALTE_DATEI = "test/anrufe/alt.test.js";
const TEST_INHALT = 'import { test } from "node:test";\ntest("alt", () => {});\n';

function umbenanntMitUmzug(context, neuerInhalt) {
  const verzeichnis = probeRepository(context, {
    ...GRUNDSTAND,
    "tools/bereiche.json": readFileSync(join(REPO_ROOT, "tools/bereiche.json"), "utf8"),
    [ALTE_DATEI]: TEST_INHALT,
    [SELBSTPRUEFUNG]: bestand(ALT),
  });
  rmSync(join(verzeichnis, ALTE_DATEI));
  writeFiles(verzeichnis, {
    "test/anrufe/alt.test.ts": neuerInhalt,
    [SELBSTPRUEFUNG]: bestand(ALT.replace("alt.test.js", "alt.test.ts")),
  });
  commitAll(verzeichnis, "umbenannt");
  return runIn(verzeichnis, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD~1"]);
}

test("bestaende: ein Eintrag, der mit einer Umbenennung nur mit Typen wandert, ist grün", (context) => {
  const ergebnis = umbenanntMitUmzug(context, TEST_INHALT.replace("() => {}", "(): void => {}"));
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
});

test("bestaende: ein Eintrag, der mit einer Umbenennung mit geändertem Code wandert, ist rot", (context) => {
  const ergebnis = umbenanntMitUmzug(context, TEST_INHALT.replace('"alt"', '"neu"'));
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(ergebnis.stderr, /selbstpruefung\.json darf nur kürzer werden, .*alt\.test\.ts/);
});

test("bestaende: ein neuer Eintrag in tools/basis/quelltext-als-text.json ist rot", (context) => {
  const ergebnis = nachAenderung(context, {
    vorher: { [QUELLTEXT]: bestand(ALT) },
    nachher: { [QUELLTEXT]: bestand(ALT, NEU) },
  });
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(ergebnis.stderr, /tools\/basis\/quelltext-als-text\.json darf nur kürzer werden/);
});
