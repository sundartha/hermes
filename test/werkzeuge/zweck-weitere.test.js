import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BEFUNDQUELLEN } from "../../tools/abhaengigkeiten.mjs";
import { MELDUNG, kenntZweck, ohneZweck, zweckBlock, zweckTexteVereinen } from "../../tools/auftrag/zweck.mjs";
import { TOOLS, VERSIONSWECHSEL } from "../../tools/basis-vergleich.mjs";
import { DEPENDENCY_TOOL, REPO_ROOT, commitAll, probeDirectory, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const WEITERE = "tools/zweck";
const ZEIGEN = join(REPO_ROOT, "tools/zweck-zeigen.mjs");
const FELDER = ["liste", "wozu", "behebung", "nichtAngenommen", "ausweg"];
const TITEL = ["Wozu: ", "Echte Behebung: ", "Nicht angenommen: ", "Ausweg: "];
const REGEL = "Keine Umgehung von Prüfungen";
const VERBOTENE_ANFAENGE = [
  "Auftrag passt nicht:",
  "Voraussetzung fehlt:",
  "Gleichwertig:",
  "Nötig:",
  "Alter Test hält altes Verhalten fest:",
  "Zerlegung passt nicht:",
  "Pitch ändern:",
  "Empfehlung:",
  "grün:",
  "rot:",
  "Verstoß:",
  "Bestätigung:",
  "Hinweis:",
  "Abweichung:",
];
const VERBOTENE_WOERTER = [
  "test.json",
  "Pull Requests",
  "actions: read",
  "statuses: read",
  "pull-requests: read",
  " Altverstöße",
  " neue Befunde",
  " Testimporte an internen Modulen",
];
const EXIT_OK = 0;
const EXIT_BEFUND = 1;
const EXIT_AUFRUF = 2;
const BASIS_VERGLEICH = join(REPO_ROOT, "tools/basis-vergleich.mjs");
const ABHAENGIGKEITEN = {
  ".dependency-cruiser.cjs": readFileSync(join(REPO_ROOT, ".dependency-cruiser.cjs"), "utf8"),
  ".dependency-cruiser-known-violations.json": "[]\n",
  "src/store/vorrat.js": "export const vorrat = 1;\n",
  "src/store.js": 'export { vorrat } from "./store/vorrat.js";\n',
  "src/routes/lager.js": 'import { vorrat } from "../store.js";\nexport const lager = vorrat;\n',
};

function gelesen(pfad) {
  return JSON.parse(readFileSync(join(REPO_ROOT, pfad), "utf8"));
}

function weitereDateien() {
  if (!existsSync(join(REPO_ROOT, WEITERE))) return [];
  return readdirSync(join(REPO_ROOT, WEITERE))
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ bereich: name.slice(0, -".json".length), eintraege: gelesen(`${WEITERE}/${name}`) }));
}

function weitereEintraege() {
  return weitereDateien().flatMap(({ bereich, eintraege }) =>
    Object.entries(eintraege).map(([id, eintrag]) => ({ bereich, id, eintrag })),
  );
}

function zeigen(ids) {
  return runIn(REPO_ROOT, process.execPath, [ZEIGEN, ...ids]);
}

test("jede Datei unter tools/zweck/ hat das Format von zweck.json und IDs mit ihrem Bereich als Präfix", () => {
  for (const { bereich, id, eintrag } of weitereEintraege()) {
    assert.ok(id.startsWith(`${bereich}/`), `${id} beginnt nicht mit ${bereich}/`);
    assert.deepEqual(Object.keys(eintrag).toSorted(), FELDER.toSorted(), id);
    for (const feld of FELDER) assert.ok(typeof eintrag[feld] === "string" && eintrag[feld].trim() !== "", `${id}.${feld} ist leer`);
  }
});

test("keine Zweck-ID steht zweimal, auch nicht zwischen zweck.json und tools/zweck/", () => {
  const ids = [...Object.keys(gelesen("tools/auftrag/zweck.json")), ...weitereEintraege().map(({ id }) => id)];
  assert.equal(new Set(ids).size, ids.length);
  const quellen = [
    ["tools/auftrag/zweck.json", { lint: { wozu: "eins" } }],
    ["tools/zweck/basis.json", { lint: { wozu: "zwei" } }],
  ];
  assert.throws(() => zweckTexteVereinen(quellen), /lint steht doppelt: in tools\/auftrag\/zweck\.json und in tools\/zweck\/basis\.json/);
});

test("jeder Text unter tools/zweck/ nennt bei Nicht angenommen die Regel Keine Umgehung von Prüfungen", () => {
  for (const { id, eintrag } of weitereEintraege()) assert.ok(eintrag.nichtAngenommen.includes(REGEL), id);
});

test("kein Text unter tools/zweck/ beginnt eine Zeile wie eine Ausstiegs- oder Belegzeile oder nennt ein Wort, das rote Fälle verbieten", () => {
  for (const { id, eintrag } of weitereEintraege()) {
    const zeilen = [...FELDER.flatMap((feld) => eintrag[feld].split("\n")), ...zweckBlock(id)];
    for (const zeile of zeilen) {
      const anfang = VERBOTENE_ANFAENGE.find((praefix) => zeile.trimStart().startsWith(praefix));
      assert.equal(anfang, undefined, `${id}: ${zeile}`);
      const wort = VERBOTENE_WOERTER.find((verboten) => zeile.includes(verboten));
      assert.equal(wort, undefined, `${id}: ${zeile}`);
    }
  }
});

test("zweckBlock findet jede ID unter tools/zweck/, und ohneZweck filtert ihren Block", () => {
  for (const { id, eintrag } of weitereEintraege()) {
    const block = zweckBlock(id);
    assert.deepEqual(block, TITEL.map((titel, index) => `${titel}${eintrag[FELDER[index + 1]]}`), id);
    assert.deepEqual(ohneZweck(["Befund", ...block]), ["Befund"], id);
  }
});

test("zweck-zeigen schreibt die Blöcke der genannten IDs auf stderr", () => {
  const ids = [MELDUNG.JSCPD, ...weitereEintraege().map(({ id }) => id).slice(0, 1)];
  const lauf = zeigen(ids);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.equal(lauf.stdout, "");
  assert.equal(lauf.stderr, `${ids.flatMap(zweckBlock).join("\n")}\n`);
});

test("zweck-zeigen scheitert laut an einer unbekannten ID und ohne ID", () => {
  const unbekannt = zeigen([MELDUNG.JSCPD, "basis/gibt-es-nicht"]);
  assert.equal(unbekannt.status, EXIT_AUFRUF);
  assert.equal(unbekannt.stdout, "");
  assert.match(unbekannt.stderr, /Kein Zweck-Text für basis\/gibt-es-nicht/);
  assert.doesNotMatch(unbekannt.stderr, /Wozu:/);
  const ohne = zeigen([]);
  assert.equal(ohne.status, EXIT_AUFRUF);
  assert.match(ohne.stderr, /Aufruf: node tools\/zweck-zeigen\.mjs/);
});

function nachBefunden(ausgabe, id) {
  const zeilen = ausgabe.split("\n").filter((zeile) => zeile !== "");
  const block = zweckBlock(id);
  const anfang = zeilen.indexOf(block[0]);
  assert.ok(anfang > 0, `kein Block ${id} nach einem Befund:\n${ausgabe}`);
  assert.deepEqual(zeilen.slice(anfang, anfang + block.length), block, ausgabe);
  return ohneZweck(zeilen);
}

test("jedes Werkzeug in tools/basis-vergleich.mjs hat einen Zweck-Text", () => {
  for (const [name, werkzeug] of Object.entries(TOOLS)) {
    assert.equal(typeof werkzeug.zweck, "string", `${name} hat kein Feld zweck`);
    assert.ok(kenntZweck(werkzeug.zweck), `${name}: kein Text für ${werkzeug.zweck}`);
  }
  assert.ok(kenntZweck(VERSIONSWECHSEL));
});

test("jede Befundquelle von tools/abhaengigkeiten.mjs hat einen Zweck-Text", () => {
  assert.ok(BEFUNDQUELLEN.length > 0);
  for (const [index, quelle] of BEFUNDQUELLEN.entries()) {
    assert.equal(typeof quelle.zweck, "string", `Befundquelle ${index} hat keine Zweck-ID`);
    assert.ok(kenntZweck(quelle.zweck), `Befundquelle ${index}: kein Text für ${quelle.zweck}`);
  }
});

test("tools/zweck/basis.json hat keine ID, die kein Werkzeug und keine Befundquelle nutzt", () => {
  const genutzt = new Set([
    ...Object.values(TOOLS).map(({ zweck }) => zweck),
    VERSIONSWECHSEL,
    ...BEFUNDQUELLEN.map(({ zweck }) => zweck),
  ]);
  const basis = Object.keys(gelesen(`${WEITERE}/basis.json`));
  assert.deepEqual(basis.toSorted(), [...genutzt].filter((id) => id?.startsWith("basis/")).toSorted());
});

test("ein neuer Verstoß gegen eine Abhängigkeitsregel nennt nach den Befunden genau den Block dieser Befundquelle", (context) => {
  const verzeichnis = probeRepository(context, ABHAENGIGKEITEN);
  writeFiles(verzeichnis, { "src/routes/lager.js": 'import { vorrat } from "../store/vorrat.js";\nexport const lager = vorrat;\n' });
  commitAll(verzeichnis, "Verstoß");
  const lauf = runIn(verzeichnis, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD~1"]);
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  const befunde = nachBefunden(lauf.stderr, "basis/abhaengigkeitsregeln");
  assert.equal(befunde.length, 1, lauf.stderr);
  assert.match(befunde[0], /^Neuer Verstoß: src\/routes\/lager\.js → src\/store\/vorrat\.js/);
  for (const andere of ["basis/test-importe", "basis/testregel-bestaende", "basis/testordnung"]) {
    assert.ok(!lauf.stderr.includes(zweckBlock(andere)[0]), andere);
  }
});

test("ein grüner Lauf von tools/abhaengigkeiten.mjs nennt keinen Block", (context) => {
  const verzeichnis = probeRepository(context, ABHAENGIGKEITEN);
  const lauf = runIn(verzeichnis, process.execPath, [DEPENDENCY_TOOL, "--basis", "HEAD"]);
  assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  assert.doesNotMatch(`${lauf.stdout}${lauf.stderr}`, /Wozu:/);
});

test("ein neuer Eintrag im Wurzelordner nennt nach den Befunden den Block der Wurzelprüfung", (context) => {
  const verzeichnis = probeRepository(context, { "README.md": "# Probe\n", "package.json": "{}\n" });
  assert.equal(runIn(verzeichnis, process.execPath, [BASIS_VERGLEICH, "wurzel", "--basis-anlegen"]).status, EXIT_OK);
  writeFiles(verzeichnis, { "plan.md": "# Plan\n" });
  const lauf = runIn(verzeichnis, process.execPath, [BASIS_VERGLEICH, "wurzel"]);
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  const befunde = nachBefunden(lauf.stderr, "basis/wurzel");
  assert.ok(befunde.some((zeile) => zeile.includes("plan.md gehört nicht in den Wurzelordner")), lauf.stderr);
});

test("eine andere jscpd-Version als in der Basislinie bricht mit dem Block des Versionswechsels ab", (context) => {
  const verzeichnis = probeDirectory(context, { "tools/basis/jscpd.json": '{"version":"0.0.0","befunde":[]}\n' });
  const lauf = runIn(verzeichnis, process.execPath, [BASIS_VERGLEICH, "jscpd"]);
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stderr);
  assert.match(lauf.stderr, /^Abbruch: jscpd .* ist installiert, tools\/basis\/jscpd\.json gilt für jscpd 0\.0\.0/);
  nachBefunden(lauf.stderr, VERSIONSWECHSEL);
  assert.ok(!lauf.stderr.includes(zweckBlock(MELDUNG.JSCPD)[0]), lauf.stderr);
});
