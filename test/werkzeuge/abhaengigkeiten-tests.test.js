import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DEPENDENCY_TOOL, REPO_ROOT, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const KONFIGURATION = ".dependency-cruiser.cjs";
const BEREICHE_DATEI = "tools/bereiche.json";
const TESTIMPORTE = "tools/basis/test-importe.json";
const ALTVERSTOESSE = ".dependency-cruiser-known-violations.json";
const NEUER_TEST = "test/anrufe/anruf-starten.test.js";
const WERKZEUG_TEST = "test/werkzeuge/x.test.js";
const INTERN = "src/store/defaults.js";
const EINGANG = "src/routes/voice.js";
const FACHLOGIK = "src/billing/period.js";
const EINGANGSREGEL = "tests-nur-ueber-eingaenge";
const EXIT_OK = 0;
const EXIT_FINDING = 1;

const BEREICHE = [
  {
    bereich: "anrufe",
    quellen: ["^src/routes/voice\\.js$"],
    eingaenge: ["^src/routes/voice\\.js$"],
    fachlogik: [],
  },
  {
    bereich: "abrechnung",
    quellen: ["^src/billing/"],
    eingaenge: [],
    fachlogik: ["^src/billing/period\\.js$"],
  },
  { bereich: "werkzeuge", quellen: [], eingaenge: [], fachlogik: [] },
  { bereich: "gemeinsam", quellen: ["^src/"], eingaenge: [], fachlogik: [] },
];

const GRUNDSTAND = {
  [KONFIGURATION]: readFileSync(join(REPO_ROOT, KONFIGURATION), "utf8"),
  [BEREICHE_DATEI]: JSON.stringify(BEREICHE),
  [INTERN]: "export const wert = 1;\n",
  [EINGANG]: "export const wert = 2;\n",
  [FACHLOGIK]: "export const wert = 3;\n",
  [TESTIMPORTE]: "[]\n",
};

function importiert(ziel) {
  return `import { wert } from "../../${ziel}";\nexport const genutzt = wert;\n`;
}

function eingefroren(von, nach) {
  return {
    type: "dependency",
    from: von,
    to: nach,
    rule: { severity: "error", name: EINGANGSREGEL },
  };
}

function liste(eintraege) {
  return `${JSON.stringify(eintraege)}\n`;
}

function probe(context, dateien = {}) {
  return probeRepository(context, { ...GRUNDSTAND, ...dateien });
}

function pruefe(verzeichnis) {
  return runIn(verzeichnis, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD"]);
}

test("ein neuer Test, der ein internes Modul aus src/ importiert, ist rot und nennt die Regel", (context) => {
  const verzeichnis = probe(context);
  writeFiles(verzeichnis, { [NEUER_TEST]: importiert(INTERN) });

  const ergebnis = pruefe(verzeichnis);
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(
    ergebnis.stderr,
    /test\/anrufe\/anruf-starten\.test\.js → src\/store\/defaults\.js verstößt gegen „tests-nur-ueber-eingaenge“/,
  );
  assert.match(ergebnis.stderr, /tools\/bereiche\.json/);
});

test("derselbe neue Test über einen öffentlichen Eingang ist grün", (context) => {
  const verzeichnis = probe(context);
  writeFiles(verzeichnis, { [NEUER_TEST]: importiert(EINGANG) });

  const ergebnis = pruefe(verzeichnis);
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^0 Testimporte an internen Modulen/m);
});

test("derselbe neue Test über reine Fachlogik eines anderen Bereichs ist grün", (context) => {
  const verzeichnis = probe(context);
  writeFiles(verzeichnis, { [NEUER_TEST]: importiert(FACHLOGIK) });

  const ergebnis = pruefe(verzeichnis);
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^0 Testimporte an internen Modulen/m);
});

test("ein in tools/basis/test-importe.json eingefrorener Testimport bleibt grün", (context) => {
  const verzeichnis = probe(context, {
    [NEUER_TEST]: importiert(INTERN),
    [TESTIMPORTE]: liste([eingefroren(NEUER_TEST, INTERN)]),
  });

  const ergebnis = pruefe(verzeichnis);
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(
    ergebnis.stdout,
    /^1 Testimporte an internen Modulen, alle eingefroren in tools\/basis\/test-importe\.json/m,
  );
});

test("wer einen neuen Testimport in tools/basis/test-importe.json einfriert, bekommt rot", (context) => {
  const verzeichnis = probe(context);
  writeFiles(verzeichnis, {
    [NEUER_TEST]: importiert(INTERN),
    [TESTIMPORTE]: liste([eingefroren(NEUER_TEST, INTERN)]),
  });

  const ergebnis = pruefe(verzeichnis);
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(
    ergebnis.stderr,
    /tools\/basis\/test-importe\.json darf nur kürzer werden, neu eingefroren ist: test\/anrufe\/anruf-starten\.test\.js → src\/store\/defaults\.js/,
  );
});

test("ein Testimport in der Liste der Altverstöße gilt nicht als eingefroren", (context) => {
  const verzeichnis = probe(context, {
    [NEUER_TEST]: importiert(INTERN),
    [ALTVERSTOESSE]: liste([eingefroren(NEUER_TEST, INTERN)]),
  });

  const ergebnis = pruefe(verzeichnis);
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(
    ergebnis.stderr,
    /Neuer Verstoß: test\/anrufe\/anruf-starten\.test\.js → src\/store/,
  );
});

test("ein Test unter test/werkzeuge/, der aus src/ importiert, ist rot, auch über einen Eingang", (context) => {
  const verzeichnis = probe(context);
  writeFiles(verzeichnis, { [WERKZEUG_TEST]: importiert(EINGANG) });

  const ergebnis = pruefe(verzeichnis);
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(
    ergebnis.stderr,
    /test\/werkzeuge\/x\.test\.js → src\/routes\/voice\.js verstößt gegen „werkzeug-tests-ohne-src“/,
  );
});
