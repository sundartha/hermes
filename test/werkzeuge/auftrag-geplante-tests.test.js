import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";

import { starteAgent } from "../../tools/auftrag/agenten.mjs";
import { BASIS, EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import {
  BLOCKING_EXIT_CODE,
  REPO_ROOT,
  ersatzClaude,
  isolatedEnvironment,
  probeDirectory,
  probeRepository,
  runHook,
  runIn,
  writeFiles,
} from "./probe-repo.js";

const GEPLANT = "test/geplant.test.js";
const FREMD = "test/fremd.test.js";
const ALT = 'test("alt", () => {});\n';
const NEU = 'test("neu", () => {});\n';
const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const NIE = { wiederholung: "-", gleichzeitig: "-", zeitueberschreitung: "-", abbruch: "-" };
const ABSATZ_GEAENDERTE_FAELLE = "Zweck geänderte fälle: Drehbuchtext des Ersatz-Agenten.";

function aendern(repo, pfad) {
  return { tool_name: "Edit", tool_input: { file_path: pfad, old_string: ALT, new_string: NEU }, cwd: repo };
}

function hook(repo, { rolle = "test", pfad, erwartet }) {
  const environment = { HERMES_ROLLE: rolle, ...(erwartet === undefined ? {} : { HERMES_ERWARTET: erwartet }) };
  return runHook("tests-schuetzen.mjs", { cwd: repo, input: aendern(repo, pfad), environment });
}

function testRepo(context) {
  return probeRepository(context, { [GEPLANT]: ALT, [FREMD]: ALT });
}

test("geplante Tests: der Test-Agent ändert eine bestehende Zeile in einer Testdatei aus erwarteteDateien", (context) => {
  const repo = testRepo(context);
  const erwartet = JSON.stringify([GEPLANT]);
  assert.equal(hook(repo, { pfad: GEPLANT, erwartet }).status, 0);
  assert.equal(hook(repo, { pfad: join(repo, GEPLANT), erwartet }).status, 0);
});

test("geplante Tests: eine nicht geplante Testdatei, eine fehlende, leere oder kaputte Liste und der Bau-Agent bleiben gesperrt", (context) => {
  const repo = testRepo(context);
  const faelle = [
    { pfad: FREMD, erwartet: JSON.stringify([GEPLANT]), meldung: /nur angehängt/ },
    { pfad: GEPLANT, erwartet: undefined, meldung: /nur angehängt/ },
    { pfad: GEPLANT, erwartet: "", meldung: /nur angehängt/ },
    { pfad: GEPLANT, erwartet: "[test/geplant.test.js", meldung: /nur angehängt/ },
    { pfad: GEPLANT, erwartet: JSON.stringify(GEPLANT), meldung: /nur angehängt/ },
    { pfad: GEPLANT, erwartet: JSON.stringify({ [GEPLANT]: true }), meldung: /nur angehängt/ },
    { rolle: "bau", pfad: GEPLANT, erwartet: JSON.stringify([GEPLANT]), meldung: /keine Tests/ },
  ];
  for (const { meldung, ...fall } of faelle) {
    const ergebnis = hook(repo, fall);
    assert.equal(ergebnis.status, BLOCKING_EXIT_CODE, JSON.stringify(fall));
    assert.match(ergebnis.stderr, meldung);
  }
});

test("geplante Tests: Pfad-Tricks und ein Symlink auf eine fremde Datei führen nicht an der Liste vorbei", (context) => {
  const repo = testRepo(context);
  const draussen = probeDirectory(context, { [FREMD]: ALT });
  symlinkSync(join(repo, FREMD), join(repo, "test/verweis.test.js"));
  const vonDraussen = `../${basename(draussen)}/${FREMD}`;
  const faelle = [
    { pfad: `./${FREMD}`, erwartet: [GEPLANT] },
    { pfad: `test/unter/../fremd.test.js`, erwartet: [GEPLANT] },
    { pfad: FREMD, erwartet: [`./${FREMD}`, `test/../${FREMD}`, join(repo, FREMD), `${FREMD}/`] },
    { pfad: "test/verweis.test.js", erwartet: ["test/verweis.test.js"] },
    { pfad: join(draussen, FREMD), erwartet: [vonDraussen, join(draussen, FREMD)] },
  ];
  for (const { pfad, erwartet } of faelle) {
    const ergebnis = hook(repo, { pfad, erwartet: JSON.stringify(erwartet) });
    assert.equal(ergebnis.status, BLOCKING_EXIT_CODE, pfad);
    assert.match(ergebnis.stderr, /nur angehängt/);
  }
});

const ERSATZ_CLAUDE = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.ERSATZ_ZIEL, process.env.HERMES_ERWARTET ?? "fehlt");
console.log(JSON.stringify({ type: "result", result: "fertig" }));
`;

test("geplante Tests: der Start eines Agenten gibt nur die Testdateien aus erwarteteDateien als HERMES_ERWARTET mit", (context) => {
  const ziel = ersatzClaude(context, ERSATZ_CLAUDE);
  const ordner = dirname(ziel);
  const erwarteteDateien = ["src/x.js", "test/x.test.js", "docs/x.md", "test/hilfe/daten.json", "src/x.test.js"];
  const auftrag = { bereich: "src/x.js", abnahme: "test/x.test.js", erwarteteDateien };
  for (const rolle of ["test", "bau"]) {
    const lauf = starteAgent({ rolle, auftrag, root: ordner }, "Auftrag");
    assert.equal(lauf.exitCode, 0, lauf.fehlerausgabe);
    const gesetzt = JSON.parse(readFileSync(ziel, "utf8"));
    assert.deepEqual(gesetzt, ["test/x.test.js", "test/hilfe/daten.json", "src/x.test.js"], rolle);
  }
});

const ZAHL_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { ZAHL } from "../src/zahl.js";',
  "",
  'test("eins", () => {',
  "  assert.equal(ZAHL, 1);",
  "});",
  "",
  'test("typ", () => {',
  '  assert.equal(typeof ZAHL, "number");',
  "});",
  "",
].join("\n");

const GRUPPEN_TEST = [
  'import assert from "node:assert/strict";',
  'import { describe, it } from "node:test";',
  'import { ZAHL } from "../src/zahl.js";',
  "",
  'describe("zahl", () => {',
  '  it("eins", () => {',
  "    assert.equal(ZAHL, 1);",
  "  });",
  "",
  '  it("typ", () => {',
  '    assert.equal(typeof ZAHL, "number");',
  "  });",
  "});",
  "",
].join("\n");

const EINS_ALS_TEXT = '"1"';

function faellePruefung(context, nachher, { zahl = "1", vorher = ZAHL_TEST } = {}) {
  const repo = probeRepository(context, {
    "package.json": JSON.stringify({ type: "module" }),
    "src/zahl.js": `export const ZAHL = ${zahl};\n`,
    "test/zahl.test.js": vorher,
  });
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(repo, { "test/zahl.test.js": nachher(vorher) });
  const lauf = spawnSync(process.execPath, [EINSTIEG, "faelle", "--basis", basis], {
    cwd: repo,
    encoding: "utf8",
    env: isolatedEnvironment(),
  });
  return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

test("geänderte Fälle: ein geänderter Fall, der gegen den unveränderten Produktcode rot ist, ist ein Verhaltensschritt", (context) => {
  const faelle = [
    (alt) => alt.replace("assert.equal(ZAHL, 1);", "assert.equal(ZAHL, 2);"),
    (alt) => `${alt}test("drei", () => assert.equal(ZAHL, 3));\n`,
    (alt) => alt.replace('import { ZAHL } from "../src/zahl.js";\n', 'import { ZAHL } from "../src/zahl.js";\nconst ZWEI = 2;\n').replace("ZAHL, 1", "ZAHL, ZWEI"),
  ];
  for (const nachher of faelle) {
    const { status, ausgabe } = faellePruefung(context, nachher);
    assert.equal(status, 0, ausgabe);
  }
});

test("geänderte Fälle: ein geänderter Fall, der grün bleibt, wird als Strukturumbau mit seinem Namen abgelehnt", (context) => {
  const faelle = [
    { nachher: (alt) => alt.replace("assert.equal(ZAHL, 1);", 'assert.equal(ZAHL, 1, "eins");'), name: /„eins“ ist gegen den unveränderten Produktcode grün/ },
    { nachher: (alt) => `${alt}test("auch eins", () => assert.equal(ZAHL, 1));\n`, name: /„auch eins“/ },
    { nachher: (alt) => alt.replace('import { test } from "node:test";\n', 'import { test } from "node:test";\nconst EINS = 1;\n'), name: /in keinem Testfall; die ganze Datei/ },
    { nachher: (alt) => alt.replace('test("typ", () => {\n  assert.equal(typeof ZAHL, "number");\n});\n', ""), name: /ganze Datei/ },
  ];
  for (const { nachher, name } of faelle) {
    const { status, ausgabe } = faellePruefung(context, nachher);
    assert.equal(status, EXIT_ROT, ausgabe);
    assert.match(ausgabe, name);
    assert.match(ausgabe, /Umbau ist ein eigener Schritt/);
  }
});

test("geänderte Fälle: ein unveränderter Fall, der gegen den unveränderten Produktcode rot ist, wird abgelehnt", (context) => {
  const nachher = (alt) => alt.replace("assert.equal(ZAHL, 1);", "assert.equal(ZAHL, 2);");
  const { status, ausgabe } = faellePruefung(context, nachher, { zahl: EINS_ALS_TEXT });
  assert.equal(status, EXIT_ROT, ausgabe);
  assert.match(ausgabe, /unveränderte Fall „typ“ ist rot/);
  assert.doesNotMatch(ausgabe, /„eins“/);
});

test("geänderte Fälle: in einer Gruppe zählt jeder Unterfall für sich, ein anderer roter Unterfall deckt keinen Umbau", (context) => {
  const rotEins = (alt) => alt.replace("assert.equal(ZAHL, 1);", "assert.equal(ZAHL, 2);");
  const faelle = [
    { nachher: (alt) => rotEins(alt).replace('"number");', '"number", "typ");'), zahl: "1", name: /„typ“ ist gegen den unveränderten Produktcode grün/ },
    { nachher: rotEins, zahl: EINS_ALS_TEXT, name: /unveränderte Fall „typ“ ist rot/ },
    { nachher: (alt) => alt.replace('describe("zahl", () => {\n', 'describe("zahl", () => {\n  const EINS = 1;\n'), zahl: "1", name: /in keinem Testfall; die ganze Datei/ },
  ];
  for (const { nachher, zahl, name } of faelle) {
    const { status, ausgabe } = faellePruefung(context, nachher, { zahl, vorher: GRUPPEN_TEST });
    assert.equal(status, EXIT_ROT, ausgabe);
    assert.match(ausgabe, name);
    assert.doesNotMatch(ausgabe, /„eins“/);
  }
});

function funktion(abnahme) {
  return {
    id: "A1",
    art: "funktion",
    ziel: "Schreibe groß",
    bereich: "src/text.js",
    erwarteteDateien: ["src/text.js", "test/text.test.js", abnahme],
    vorbild: "src/text.js",
    abnahme,
    erwarteterFehler: "2 !== 4",
    wasDarfNiePassieren: NIE,
  };
}

const ROTER_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { verdopple } from "../src/rechnen.js";',
  'test("verdoppelt", () => assert.equal(verdopple(2), 4));',
  "",
].join("\n");

test("geänderte Fälle: lauf stoppt einen Test-Agenten, der einen geplanten Test nur umbaut, vor dem Bau-Agenten", (context) => {
  const umgebaut = BASIS["test/text.test.js"].replace('"A"));', '"A", "gross"));');
  const drehbuch = { test: { "test/text.test.js": umgebaut, "test/rechnen.test.js": ROTER_TEST }, "test-antwort": ABSATZ_GEAENDERTE_FAELLE };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("test/rechnen.test.js"), drehbuch });
  assert.equal(lauf.status, EXIT_ROT);
  const pruefung = beleg.pruefungen.find(({ name }) => name === "geänderte fälle");
  assert.equal(pruefung?.exitCode, EXIT_ROT, JSON.stringify(beleg.pruefungen));
  assert.ok(pruefung.zeilen.some((zeile) => zeile.includes("„gross“ ist gegen den unveränderten Produktcode grün")));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});

function planBeleg(context, umbau) {
  const felder = { ziel: "Räume auf", vorbild: "src/text.js", abnahme: "test/text.test.js", entwurf: "Aufräumen.", ...umbau };
  const plan = ["```json", JSON.stringify(felder), "```"].join("\n");
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    "bau-antwort": "Voraussetzung fehlt: Es braucht zuerst einen Umbau.",
    "plan-antwort": plan,
  };
  const auftrag = { ...funktion("test/rechnen.test.js"), bereich: "src/rechnen.js", erwarteteDateien: ["src/rechnen.js", "test/rechnen.test.js"] };
  const { repo } = starte(context, { auftrag, drehbuch });
  return JSON.parse(readFileSync(join(repo, ".fortschritt/probe/A1-plan.json"), "utf8"));
}

test("geplante Tests: ein Umbau, dessen Bereich nur Tests umfasst, wird als testumbau angelegt, ein gemischter als umbau", (context) => {
  const nurTests = planBeleg(context, { bereich: "test/", erwarteteDateien: ["test/text.test.js"], vorbild: "test/text.test.js" });
  assert.deepEqual([nurTests.ergebnis, nurTests.befunde, nurTests.umbau.art], ["grün", [], "testumbau"]);
  const gemischt = planBeleg(context, { bereich: "src/", erwarteteDateien: ["src/text.js", "test/text.test.js"] });
  assert.deepEqual([gemischt.ergebnis, gemischt.befunde, gemischt.umbau.art], ["grün", [], "umbau"]);
});
