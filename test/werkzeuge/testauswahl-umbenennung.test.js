import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { aufrufeIn } from "../../tools/testlaufzeit/echt-warten-statisch.mjs";
import { hilfsdateiBefunde } from "../../tools/testlaufzeit/hilfsdatei.mjs";
import { zeitgliederBefunde } from "../../tools/testlaufzeit/zeitglieder.mjs";
import {
  AFFECTED_TESTS_TOOL,
  DEPENDENCY_TOOL,
  PRUEFLEITER_TOOL,
  REPO_ROOT,
  commitAll,
  failingTest,
  passingTest,
  probeDirectory,
  probeRepository,
  runIn,
} from "./probe-repo.js";

const ERREICHT = "erreicht die umbenannte Datei";
const UNBETEILIGT = "unbeteiligter Test";
const TS_TEST = "Testdatei mit Typen";
const BASIS_JS = "export function doppelt(wert) {\n  return wert + wert;\n}\n";
const NUR_TYPEN = "export function doppelt(wert: number): number {\n  return wert + wert;\n}\n";
const GEAENDERT = "export function doppelt(wert: number): number {\n  return wert * 2;\n}\n";
const MITTE = (endung) => `import { doppelt } from "./basis.${endung}";\nexport const vier = doppelt(2);\n`;
const OHNE_WERKZEUGTESTS = /keine Änderung außerhalb von src\/ und test\//;
const ALTER_TEST = "test/alt-p1-probe.test.js";
const BEREICHE = JSON.stringify([{ bereich: "anrufe", quellen: ["^src/"], eingaenge: [], fachlogik: [] }]);
const KONFIGURATION = ".dependency-cruiser.cjs";
const BAUSTEIN = join(REPO_ROOT, "tools/umbenennung.mjs");
const TESTLAUFZEIT_TOOL = join(REPO_ROOT, "tools/testlaufzeit-pruefen.mjs");
const TS_ZEITGLIED_DATEI = "test/zeitglied.test.ts";
const ZEITGLIEDER_KONFIGURATION =
  'export default [{ name: "zeitglieder-in-tests", rules: { "no-restricted-globals": ["error", "setTimeout"] } }];\n';
const OBEN = (endung, typ = "") => `import { vier } from "./mitte.${endung}";\nexport const acht${typ} = vier + vier;\n`;

function auswahlProbe(context) {
  return probeRepository(context, {
    "package.json": JSON.stringify({ type: "module" }),
    "src/basis.js": BASIS_JS,
    "src/mitte.js": MITTE("js"),
    "test/erreicht.test.js": failingTest(ERREICHT, "x", "../src/mitte.js"),
    "test/unbeteiligt.test.js": failingTest(UNBETEILIGT, "x"),
    "test/werkzeuge/a.test.js": passingTest("Werkzeugtest"),
  });
}

function umbenennen(repo, inhalt) {
  rmSync(join(repo, "src/basis.js"));
  writeFileSync(join(repo, "src/basis.ts"), inhalt);
  writeFileSync(join(repo, "src/mitte.js"), MITTE("ts"));
}

function betroffen(repo) {
  return runIn(repo, process.execPath, [AFFECTED_TESTS_TOOL, "--basis", "HEAD"]);
}

test("betroffene Tests: nur Typen ergänzt wählt die erreichenden Tests statt der vollen Suite", (context) => {
  const repo = auswahlProbe(context);
  umbenennen(repo, NUR_TYPEN);
  const lauf = betroffen(repo);
  assert.match(lauf.stdout, new RegExp(ERREICHT));
  assert.doesNotMatch(lauf.stdout, new RegExp(UNBETEILIGT));
});

test("betroffene Tests: Umbenennung mit geändertem Laufzeitcode bleibt bei der vollen Suite", (context) => {
  const repo = auswahlProbe(context);
  umbenennen(repo, GEAENDERT);
  const lauf = betroffen(repo);
  assert.match(lauf.stdout, new RegExp(ERREICHT));
  assert.match(lauf.stdout, new RegExp(UNBETEILIGT));
});

function neueDateiOhneTest(context, neu) {
  const repo = auswahlProbe(context);
  writeFileSync(join(repo, neu), BASIS_JS);
  runIn(repo, "git", ["add", neu]);
  return betroffen(repo);
}

test("betroffene Tests: eine neue .js ohne Paar und ohne Test fällt auf die volle Suite", (context) => {
  assert.match(neueDateiOhneTest(context, "src/neu.js").stdout, new RegExp(UNBETEILIGT));
});

test("betroffene Tests: eine neue .ts ohne Paar und ohne Test fällt auf die volle Suite", (context) => {
  assert.match(neueDateiOhneTest(context, "src/neu.ts").stdout, new RegExp(UNBETEILIGT));
});

test("betroffene Tests: eine geänderte .test.ts-Datei wird gewählt", (context) => {
  const repo = auswahlProbe(context);
  writeFileSync(join(repo, "test/typen.test.ts"), failingTest(TS_TEST, "x", "../src/mitte.js"));
  commitAll(repo, "Testdatei mit Typen");
  writeFileSync(join(repo, "test/typen.test.ts"), failingTest(TS_TEST, "y", "../src/mitte.js"));
  const lauf = betroffen(repo);
  assert.match(lauf.stdout, new RegExp(TS_TEST));
  assert.doesNotMatch(lauf.stdout, new RegExp(UNBETEILIGT));
});

function kettenBaustein(context, basisInhalt) {
  const repo = probeRepository(context, {
    "src/basis.js": BASIS_JS,
    "src/mitte.js": MITTE("js"),
    "src/oben.js": OBEN("js"),
  });
  for (const datei of ["src/basis.js", "src/mitte.js", "src/oben.js"]) rmSync(join(repo, datei));
  writeFileSync(join(repo, "src/basis.ts"), basisInhalt);
  writeFileSync(join(repo, "src/mitte.ts"), MITTE("ts").replace("vier", "vier: number"));
  writeFileSync(join(repo, "src/oben.ts"), OBEN("ts", ": number"));
  commitAll(repo, "Kette");
  return runIn(repo, process.execPath, [BAUSTEIN, "--basis", "HEAD~1"]);
}

test("Baustein: eine Kette, die nur einer Umbenennung mit geändertem Laufzeitcode folgt, gilt durchgehend als geändert", (context) => {
  const lauf = kettenBaustein(context, GEAENDERT);
  for (const datei of ["basis", "mitte", "oben"])
    assert.match(lauf.stdout, new RegExp(`src/${datei}\\.js → src/${datei}\\.ts: geändert \\(`));
  assert.doesNotMatch(lauf.stdout, /nur Typen ergänzt/);
});

test("Baustein: dieselbe Kette mit nur Typen in jeder Datei bleibt nur Typen", (context) => {
  const lauf = kettenBaustein(context, NUR_TYPEN);
  assert.equal(lauf.stdout.match(/nur Typen ergänzt, Laufzeitcode gleich/g)?.length, 3);
});

function teil(repo) {
  return runIn(repo, process.execPath, [PRUEFLEITER_TOOL, "--basis", "HEAD", "--werkzeugteil", "1/1"]);
}

test("Prüfleiter: nur Typen ergänzt unter src/ verlangt keine Werkzeugtests", (context) => {
  const repo = auswahlProbe(context);
  umbenennen(repo, NUR_TYPEN);
  assert.match(teil(repo).stdout, OHNE_WERKZEUGTESTS);
});

test("Prüfleiter: Umbenennung mit geändertem Laufzeitcode verlangt die Werkzeugtests wie eine gelöschte Datei", (context) => {
  const repo = auswahlProbe(context);
  umbenennen(repo, GEAENDERT);
  assert.doesNotMatch(teil(repo).stdout, OHNE_WERKZEUGTESTS);
});

function ordnungsProbe(context, alterTest) {
  const repo = probeRepository(context, {
    [KONFIGURATION]: readFileSync(join(REPO_ROOT, KONFIGURATION), "utf8"),
    "tools/bereiche.json": BEREICHE,
    "src/app.js": "export const app = true;\n",
    [ALTER_TEST]: alterTest,
  });
  rmSync(join(repo, ALTER_TEST));
  return repo;
}

function ordnung(repo) {
  commitAll(repo, "Umbenennung");
  return runIn(repo, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD~1"]);
}

test("Testordnung: eine flache Testdatei, die beim Wechsel nach .ts nur Typen bekommt, gilt nicht als neu", (context) => {
  const repo = ordnungsProbe(context, "export const wert = 1;\n");
  writeFileSync(join(repo, "test/alt-p1-probe.test.ts"), "export const wert: number = 1;\n");
  const lauf = ordnung(repo);
  assert.doesNotMatch(lauf.stderr, /alt-p1-probe\.test\.ts: neue Testdateien/);
  assert.match(lauf.stdout, /^0 neue Dateien unter test\//m);
});

test("Testordnung: eine flache Testdatei mit geändertem Laufzeitcode ist nach .ts eine neue Datei", (context) => {
  const repo = ordnungsProbe(context, "export const wert = 1;\n");
  writeFileSync(join(repo, "test/alt-p1-probe.test.ts"), "export const wert: number = 2;\n");
  const lauf = ordnung(repo);
  assert.match(lauf.stderr, /test\/alt-p1-probe\.test\.ts: neue Testdateien liegen unter test\/<bereich>\//);
});

test("Testlaufzeit: echtWarten in einer .ts-Testdatei wird gelesen, Laufzeit-TypeScript bricht ab", () => {
  const text = 'import { echtWarten } from "./echt-warten.js";\nconst ms: number = 500;\nawait echtWarten(ms);\n';
  assert.equal(aufrufeIn("test/probe.test.ts", text).length, 1);
  assert.throws(() => aufrufeIn("test/probe.test.ts", "enum Art { A }\n"), /TypeScript-Syntax mit Laufzeitwirkung/);
});

test("Testlaufzeit: ein Zeitglied in einer .test.ts-Datei zählt gegen den Bestand", async (context) => {
  const wurzel = probeDirectory(context, {
    "package.json": JSON.stringify({ type: "module" }),
    "eslint.config.js": ZEITGLIEDER_KONFIGURATION,
    [TS_ZEITGLIED_DATEI]: "const ms: number = 5;\nsetTimeout(() => {}, ms);\n",
  });
  assert.deepEqual(await zeitgliederBefunde(wurzel, { [TS_ZEITGLIED_DATEI]: 1 }), []);
});

test("Testlaufzeit: echtWarten über 100 ms in einer flachen .ts-Hilfsdatei ist ohne Eintrag ein Befund", (context) => {
  const repo = probeRepository(context, {
    "tools/basis/testlaufzeit.json": JSON.stringify({ ausklingen_grenze_ms: null, ausklingen_bestand: [] }),
    "tools/basis/echte-wartezeiten.json": "[]",
    "tools/basis/zeitglieder-bestand.json": "{}",
    "test/warte-helfer.ts": 'import { echtWarten } from "./echt-warten.js";\nconst ms: number = 500;\nawait echtWarten(ms);\n',
  });
  const lauf = runIn(repo, process.execPath, [TESTLAUFZEIT_TOOL, "--laufzeiten", "fehlt.jsonl"]);
  assert.match(lauf.stdout, /test\/warte-helfer\.ts: echtWarten\(ms\): 500 ms/);
});

test("Testlaufzeit: Testfälle in einer .test.ts-Datei sind keine Hilfsdatei-Befunde", () => {
  assert.deepEqual(hilfsdateiBefunde([{ datei: "test/probe.test.ts" }]), []);
  assert.equal(hilfsdateiBefunde([{ datei: "test/helfer.ts" }]).length, 1);
});
