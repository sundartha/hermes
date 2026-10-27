import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ROTER_TEST, VERDOPPELT, exitCodes, funktion, pruefung } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const EINSTIEG = join(REPO_ROOT, "tools/auftrag.mjs");
const ZAHL_TEST = "test/zahl.test.js";
const NEUE_DATEI = "test/zahl-zwei.test.js";
const SATZ = "Die Zahl bleibt eine Zahl.";
const ZWEITER_SATZ = "Die Zahl bleibt positiv.";
const ERWARTET = "Zahl falsch";
const KOPF = ['import assert from "node:assert/strict";', 'import { test } from "node:test";', 'import { ZAHL } from "../src/zahl.js";', ""];
const BESTAND = [...KOPF, 'test("eins", () => {', "  assert.equal(ZAHL, 1);", "});", ""].join("\n");
const IST_ZAHL = 'assert.equal(typeof ZAHL, "number");';

function fall(name, rumpf, optionen = "") {
  return [`test(${JSON.stringify(name)}, ${optionen}() => {`, `  ${rumpf}`, "});", ""].join("\n");
}

function angehaengt(...faelle) {
  return { [ZAHL_TEST]: [BESTAND, ...faelle].join("\n") };
}

function auftrag(nie) {
  const erwarteteDateien = ["src/zahl.js", ZAHL_TEST, NEUE_DATEI];
  return { id: "A1", art: "funktion", ziel: "Halte die Zahl", bereich: "src/zahl.js", erwarteteDateien, vorbild: "src/zahl.js", abnahme: ZAHL_TEST, erwarteterFehler: ERWARTET, wasDarfNiePassieren: nie };
}

function probe(context, { vorher = BESTAND, nachher, nie = [SATZ] }) {
  const repo = probeRepository(context, { "package.json": JSON.stringify({ type: "module" }), "src/zahl.js": "export const ZAHL = 1;\n", [ZAHL_TEST]: vorher });
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFiles(repo, nachher);
  const phasendatei = join(probeDirectory(context, {}), "phase.json");
  writeFileSync(phasendatei, JSON.stringify({ phase: "probe", entwurf: { "src/zahl.js": "Entwurf." }, auftraege: [auftrag(nie)] }));
  const aufruf = (argumente) => {
    const lauf = spawnSync(process.execPath, [EINSTIEG, ...argumente], { cwd: repo, encoding: "utf8", env: isolatedEnvironment() });
    return { status: lauf.status, ausgabe: `${lauf.stdout}${lauf.stderr}` };
  };
  return {
    faelle: (kennung = "A1") => aufruf(["faelle", "--basis", basis, "--phasendatei", phasendatei, "--auftrag", kennung]),
    schutztests: (rolle) => aufruf(["schutztests", phasendatei, "A1", "--rolle", rolle, "--basis", basis]),
  };
}

function gruen(ergebnis) {
  assert.equal(ergebnis.status, 0, ergebnis.ausgabe);
}

function rot(ergebnis, meldung) {
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.ausgabe);
  assert.match(ergebnis.ausgabe, meldung);
}

test("Schutztest: ein neuer Fall mit der Kennung eines Satzes darf gegen den alten Code grün sein und erfüllt die Pflicht", (context) => {
  const { faelle, schutztests } = probe(context, { nachher: angehaengt(fall("[NIE1] die Zahl ist eine Zahl", IST_ZAHL)) });
  gruen(faelle());
  gruen(schutztests("test"));
  gruen(schutztests("bau"));
});

test("Schutztest: derselbe grüne Fall ohne Kennung bleibt ein Strukturumbau, und der Satz bleibt ohne Schutztest", (context) => {
  const { faelle, schutztests } = probe(context, { nachher: angehaengt(fall("die Zahl ist eine Zahl", IST_ZAHL)) });
  rot(faelle(), /„die Zahl ist eine Zahl“ ist gegen den unveränderten Produktcode grün/);
  rot(schutztests("test"), /\[NIE1\] „Die Zahl bleibt eine Zahl\.“ hat keinen neuen Testfall/);
});

test("Schutztest: eine Kennung ohne passenden Satz desselben Auftrags ist rot", (context) => {
  const faelleMitFalscherKennung = [
    { name: "[NIE2] die Zahl ist eine Zahl", nie: [SATZ] },
    { name: "[NIE1] die Zahl ist eine Zahl", nie: [] },
    { name: "[NIE0] die Zahl ist eine Zahl", nie: [SATZ] },
    { name: "[NIE01] die Zahl ist eine Zahl", nie: [SATZ] },
    { name: "[nie1] die Zahl ist eine Zahl", nie: [SATZ] },
    { name: "[NIE1]die Zahl ist eine Zahl", nie: [SATZ] },
  ];
  for (const { name, nie } of faelleMitFalscherKennung) {
    const { faelle, schutztests } = probe(context, { nachher: angehaengt(fall(name, IST_ZAHL)), nie });
    rot(faelle(), /ist gegen den unveränderten Produktcode grün/);
    rot(schutztests("test"), /trägt keine Kennung eines Satzes aus wasDarfNiePassieren/);
  }
});

test("Schutztest: ein bestehender Fall wird durch eine Kennung nicht zum Schutztest und muss rot sein", (context) => {
  const alterSchutztest = [BESTAND, fall("[NIE1] alt", "assert.equal(ZAHL, 1);")].join("\n");
  const geaenderteFaelle = [
    { vorher: BESTAND, nachher: BESTAND.replace('test("eins"', 'test("[NIE1] eins"'), name: /„\[NIE1\] eins“ ist gegen den unveränderten Produktcode grün/ },
    { vorher: BESTAND, nachher: BESTAND.replace('test("eins", () => {\n  assert.equal(ZAHL, 1);', `test("[NIE1] neu", () => {\n  ${IST_ZAHL}`), name: /„\[NIE1\] neu“ ist gegen den unveränderten Produktcode grün/ },
    { vorher: alterSchutztest, nachher: alterSchutztest.replace('"[NIE1] alt", () => {\n', `"[NIE1] alt", () => {\n  ${IST_ZAHL}\n`), name: /„\[NIE1\] alt“ ist gegen den unveränderten Produktcode grün/ },
  ];
  for (const { vorher, nachher, name } of geaenderteFaelle) {
    const { faelle, schutztests } = probe(context, { vorher, nachher: { [ZAHL_TEST]: nachher } });
    rot(faelle(), name);
    rot(schutztests("test"), /hat keinen neuen Testfall/);
  }
});

test("Schutztest: ein Fall mit Kennung, der mit dem erwarteten Fehler rot ist, zählt nie als Abnahme", (context) => {
  const { schutztests } = probe(context, { nachher: angehaengt(fall("[NIE1] die Zahl ist zwei", `assert.equal(ZAHL, 2, ${JSON.stringify(ERWARTET)});`)) });
  rot(schutztests("test"), /„\[NIE1\] die Zahl ist zwei“ ist mit dem erwarteten Fehler rot\. Ein Schutztest zählt nie als Abnahme/);
});

test("Schutztest: ein bestehender Fall, der eine Kennung bekommt, wird auf erwarteten Fehler und passenden Satz geprüft", (context) => {
  const umbenannteFaelle = [
    { nachher: BESTAND.replace('test("eins", () => {\n  assert.equal(ZAHL, 1);', `test("[NIE1] eins", () => {\n  assert.equal(ZAHL, 2, ${JSON.stringify(ERWARTET)});`), meldung: /„\[NIE1\] eins“ ist mit dem erwarteten Fehler rot\. Ein Schutztest zählt nie als Abnahme/ },
    { nachher: BESTAND.replace('test("eins"', 'test("[NIE9] eins"'), meldung: /„\[NIE9\] eins“ trägt keine Kennung eines Satzes aus wasDarfNiePassieren/ },
  ];
  for (const { nachher, meldung } of umbenannteFaelle) {
    const { schutztests } = probe(context, { nachher: { [ZAHL_TEST]: nachher } });
    rot(schutztests("test"), meldung);
  }
});

test("Schutztest: aus anderem Grund rot ist vor dem Bau erlaubt, nach dem Bau erfüllt der Fall die Pflicht nicht", (context) => {
  const { schutztests } = probe(context, { nachher: angehaengt(fall("[NIE1] die Zahl ist zwei", 'assert.equal(ZAHL, 2, "anderer Grund");')) });
  gruen(schutztests("test"));
  rot(schutztests("bau"), /hat keinen neuen Testfall mit der Kennung \[NIE1\] am Namensanfang, der nach dem Bau grün ist/);
});

test("Schutztest: ein übersprungener oder als todo markierter Fall mit Kennung erfüllt die Pflicht nicht", (context) => {
  for (const optionen of ["{ skip: true }, ", "{ todo: true }, "]) {
    const { schutztests } = probe(context, { nachher: angehaengt(fall("[NIE1] die Zahl ist eine Zahl", IST_ZAHL, optionen)) });
    rot(schutztests("test"), /\[NIE1\] „Die Zahl bleibt eine Zahl\.“ hat keinen neuen Testfall/);
  }
});

test("Schutztest: jeder Satz braucht seinen eigenen Schutztest, auch in einer neuen Testdatei", (context) => {
  const nie = [SATZ, ZWEITER_SATZ];
  const nurErster = probe(context, { nachher: angehaengt(fall("[NIE1] die Zahl ist eine Zahl", IST_ZAHL)), nie });
  const ergebnis = nurErster.schutztests("test");
  rot(ergebnis, /\[NIE2\] „Die Zahl bleibt positiv\.“ hat keinen neuen Testfall/);
  assert.doesNotMatch(ergebnis.ausgabe, /\[NIE1\] „/);
  const zweiterNeu = [...KOPF, fall("[NIE2] die Zahl ist positiv", "assert.ok(ZAHL > 0);")].join("\n");
  const beide = probe(context, { nachher: { ...angehaengt(fall("[NIE1] die Zahl ist eine Zahl", IST_ZAHL)), [NEUE_DATEI]: zweiterNeu }, nie });
  gruen(beide.schutztests("test"));
  gruen(beide.schutztests("bau"));
});

test("Schutztest: eine leere Liste wasDarfNiePassieren verlangt keinen Schutztest", (context) => {
  const { schutztests } = probe(context, { nachher: angehaengt(fall("drei", `assert.equal(ZAHL, 3, ${JSON.stringify(ERWARTET)});`)), nie: [] });
  gruen(schutztests("test"));
  gruen(schutztests("bau"));
});

test("Schutztest: faelle mit einer Phasendatei ohne den genannten Auftrag ist rot", (context) => {
  const { faelle } = probe(context, { nachher: angehaengt(fall("[NIE1] die Zahl ist eine Zahl", IST_ZAHL)) });
  rot(faelle("A9"), /Die Phase hat keinen Auftrag A9/);
});

test("lauf: fehlt einem Satz aus wasDarfNiePassieren der Schutztest, startet kein Bau-Agent", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: { ...funktion("2 !== 4"), wasDarfNiePassieren: [SATZ] }, drehbuch });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(pruefung(beleg, "schutztests"), EXIT_ROT, JSON.stringify(beleg.pruefungen));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});

test("lauf: ein grüner Schutztest neben dem roten Abnahmefall trägt den Auftrag bis zum Commit", (context) => {
  const mitSchutztest = `${ROTER_TEST}test("[NIE1] verdoppelt null zu null", () => assert.equal(verdopple(0), 0));\n`;
  const drehbuch = { test: { "test/rechnen.test.js": mitSchutztest }, bau: { "src/rechnen.js": VERDOPPELT } };
  const { lauf, beleg } = starte(context, { auftrag: { ...funktion("2 !== 4"), wasDarfNiePassieren: [SATZ] }, drehbuch });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, "schutztests"), [0, 0]);
  assert.deepEqual(exitCodes(beleg, "rot"), [0]);
});
