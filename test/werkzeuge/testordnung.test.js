import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  DEPENDENCY_TOOL,
  REPO_ROOT,
  commitAll,
  passingTest,
  probeRepository,
  runIn,
  writeFiles,
} from "./probe-repo.js";

const KONFIGURATION = ".dependency-cruiser.cjs";
const BEREICHE = [
  { bereich: "anrufe", quellen: ["^src/telephony/"], eingaenge: [], fachlogik: [] },
  { bereich: "gemeinsam", quellen: ["^src/"], eingaenge: [], fachlogik: [] },
];
const ALTE_TICKET_DATEI = "test/openai-t2-11-alt.test.js";
const EXIT_OK = 0;
const EXIT_FINDING = 1;

const GRUNDSTAND = {
  [KONFIGURATION]: readFileSync(join(REPO_ROOT, KONFIGURATION), "utf8"),
  "tools/bereiche.json": JSON.stringify(BEREICHE),
  "src/app.js": "export const app = true;\n",
  [ALTE_TICKET_DATEI]: passingTest("alt"),
};

function nachCommit(context, dateien) {
  const verzeichnis = probeRepository(context, GRUNDSTAND);
  writeFiles(verzeichnis, dateien);
  commitAll(verzeichnis, "neu");
  return runIn(verzeichnis, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD~1"]);
}

function neueDatei(context, pfad) {
  return nachCommit(context, { [pfad]: passingTest("neu") });
}

test("testordnung: test/openai-t9-99-probe.test.js direkt unter test/ ist rot und zeigt den guten Weg", (context) => {
  const ergebnis = neueDatei(context, "test/openai-t9-99-probe.test.js");
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(
    ergebnis.stderr,
    /^test\/openai-t9-99-probe\.test\.js: neue Testdateien liegen unter test\/<bereich>\/ \(Bereiche: anrufe, gemeinsam\) und heißen nach Verhalten, z\. B\. test\/anrufe\/anruf-starten\.test\.js\./m,
  );
  assert.match(ergebnis.stderr, /Ticket-Nummern gehören in Commit-Text und Testtitel\./);
  assert.match(ergebnis.stderr, /Ausnahme des Musters in tools\/abhaengigkeiten\/testordnung\.mjs/);
});

test("testordnung: test/anrufe/anruf-starten.test.js ist grün", (context) => {
  const ergebnis = neueDatei(context, "test/anrufe/anruf-starten.test.js");
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^1 neue Dateien unter test\/ seit der Basis/m);
});

test("testordnung: ein Ticket-Name im richtigen Bereich ist rot", (context) => {
  const ergebnis = neueDatei(context, "test/anrufe/openai-t9-99-probe.test.js");
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(ergebnis.stderr, /^test\/anrufe\/openai-t9-99-probe\.test\.js: /m);
});

test("testordnung: ein Ordner, der kein Bereich ist, ist rot", (context) => {
  const ergebnis = neueDatei(context, "test/unbekannt/x.test.js");
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(ergebnis.stderr, /^test\/unbekannt\/x\.test\.js: /m);
});

test("testordnung: eine geänderte bestehende Datei mit Ticket-Namen bleibt grün", (context) => {
  const ergebnis = nachCommit(context, { [ALTE_TICKET_DATEI]: passingTest("geaendert") });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^0 neue Dateien unter test\/ seit der Basis/m);
});

test("testordnung: eine Hilfsdatei unter test/gemeinsam/ ist grün", (context) => {
  const ergebnis = nachCommit(context, { "test/gemeinsam/hilfe.js": "export const hilfe = 1;\n" });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
});

test("testordnung: Fachnamen mit Ziffern wie e164, sha256 und i18n sind grün", (context) => {
  const ergebnis = nachCommit(context, {
    "test/anrufe/e164-normalisieren.test.js": passingTest("e164"),
    "test/anrufe/sha256-pruefsumme.test.js": passingTest("sha256"),
    "test/gemeinsam/i18n-katalog.test.js": passingTest("i18n"),
  });
  assert.equal(ergebnis.status, EXIT_OK, ergebnis.stderr);
  assert.match(ergebnis.stdout, /^3 neue Dateien unter test\/ seit der Basis/m);
});

test("testordnung: Katalognummern und Phasen in Ordnernamen sind rot", (context) => {
  const ergebnis = nachCommit(context, {
    "test/anrufe/gap-35-metrics-country.test.js": passingTest("gap"),
    "test/anrufe/p4/abbruch.test.js": passingTest("phase"),
  });
  assert.equal(ergebnis.status, EXIT_FINDING, ergebnis.stderr);
  assert.match(ergebnis.stderr, /^test\/anrufe\/gap-35-metrics-country\.test\.js: /m);
  assert.match(ergebnis.stderr, /^test\/anrufe\/p4\/abbruch\.test\.js: /m);
});
