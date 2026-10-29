import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { anteilig } from "../../tools/mutationspruefung/teile.mjs";
import { EXIT_ABBRUCH, testdateien } from "./mutationspruefung-hilfen.js";
import { werkzeug } from "./mutationspruefung-probe.js";
import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/mutationspruefung.mjs");
const REIHUM = "Mutationsplan: ohne Laufzeitdaten, reihum";
const ANTEIL_TESTS = 25;
const VIELE_TESTDATEIEN = 50;
const ZWEI_ANTEILE = 2;
const SCHWERE_STELLEN = [0, 2, 4, 6, 8, 10];
const PFLICHTTEST = "test/summe.test.js";
const BELIEBIGER_LAUF = 7;
const SCHWERE_DAUER_MS = 100_000;
const LANGE_DAUER_MS = 1000;
const KURZE_DAUER_MS = 5;

const QUELLE = ["export function summe(liste) {", "  let ergebnis = 0;", "  for (const zahl of liste) ergebnis += zahl;", "  return ergebnis;", "}", ""].join("\n");
const BETRAG = "export function betrag(zahl) {\n  return zahl < 0 ? -zahl : zahl;\n}\n";
const BETRAG_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { betrag, summe } from "../src/summe.js";',
  'test("summiert", () => assert.equal(summe([1, 2]), 3));',
  'test("rechnet den Betrag", () => {',
  "  assert.equal(betrag(-2), 2);",
  "  assert.equal(betrag(2), 2);",
  "  assert.equal(betrag(0), 0);",
  "});",
  "",
].join("\n");
const ZWEITE_QUELLE = "export const doppelt = (zahl) => zahl * 2;\n";

function gewichte(namen, { schwer, schwerGewicht, leichtGewicht }) {
  return Object.fromEntries(namen.map((name, index) => [name, schwer.includes(index) ? schwerGewicht : leichtGewicht]));
}

function anteileVon(alle, von, dauern) {
  return Array.from({ length: von }, (_leer, index) => anteilig({ erste: alle, alle, nachsichtig: [] }, { anteil: index + 1, von, dauern }));
}

function summeDer(tests, dauern) {
  return tests.reduce((summe, test) => summe + dauern[test], 0);
}

test("mit Laufzeitdaten nimmt jeder Anteil die Testdateien nach Gewicht, längste zuerst in den leichtesten, und alle Anteile zusammen enthalten jede Testdatei genau einmal", () => {
  const faelle = [
    { dauern: { a: 100, b: 1, c: 1, d: 1, e: 1, f: 1 }, von: 2, erwartet: [["a"], ["b", "c", "d", "e", "f"]] },
    { dauern: { a: 5, b: 4, c: 3, d: 3, e: 2, f: 1 }, von: 3, erwartet: [["a", "f"], ["b", "e"], ["c", "d"]] },
    { dauern: { a: 10, b: 2, c: 2 }, von: 2, erwartet: [["a"], ["b", "c", "d"]], alle: ["a", "b", "c", "d"] },
    { dauern: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 100 }, von: 2, erwartet: [["f"], ["a", "b", "c", "d", "e"]] },
  ];
  for (const { dauern, von, erwartet, alle = Object.keys(dauern) } of faelle) {
    const anteile = anteileVon(alle, von, dauern);
    assert.deepEqual(anteile.map((anteil) => anteil.alle), erwartet);
    assert.deepEqual(anteile.flatMap((anteil) => anteil.alle).sort(), [...alle].sort());
    assert.deepEqual(anteile.flatMap((anteil) => anteil.erste), anteile.flatMap((anteil) => anteil.alle));
  }
});

test("mit mehreren schweren Testdateien bleibt der längste Anteil höchstens beim Ideal plus der schwersten Datei, reihum läge er darüber", () => {
  const alle = testdateien(VIELE_TESTDATEIEN, "test/t");
  const dauern = gewichte(alle, { schwer: SCHWERE_STELLEN, schwerGewicht: 10, leichtGewicht: 1 });
  const gesamt = summeDer(alle, dauern);
  const schwerste = Math.max(...Object.values(dauern));
  const nachGewicht = anteileVon(alle, ZWEI_ANTEILE, dauern).map((anteil) => summeDer(anteil.alle, dauern));
  const reihum = anteileVon(alle, ZWEI_ANTEILE, undefined).map((anteil) => summeDer(anteil.alle, dauern));
  assert.ok(reihum[0] > gesamt / 2 + schwerste, `reihum ${reihum}`);
  assert.ok(Math.max(...nachGewicht) <= gesamt / 2 + schwerste, `nach Gewicht ${nachGewicht}`);
  assert.equal(nachGewicht[0] + nachGewicht[1], gesamt);
});

test("ohne Laufzeitdaten verteilt anteilig die Testdateien reihum nach der Stelle in der sortierten Liste wie bisher", () => {
  const alle = ["a", "b", "c", "d", "e"];
  for (const dauern of [undefined, null]) {
    const anteile = anteileVon(alle, 2, dauern);
    assert.deepEqual(anteile.map((anteil) => anteil.alle), [["a", "c", "e"], ["b", "d"]]);
    assert.deepEqual(anteilig({ erste: ["b", "c"], alle, nachsichtig: ["c"] }, { anteil: 1, von: 2, dauern }), { erste: ["c"], alle: ["a", "c", "e"], nachsichtig: ["c"] });
  }
});

function ablage(context, inhalt) {
  const ziel = join(probeDirectory(context, {}), "laufzeiten.json");
  writeFileSync(ziel, typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt));
  return ziel;
}

function planRepo(context, dateien = {}) {
  return probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    ".gitignore": "node_modules/\n",
    "src/summe.js": QUELLE,
    "src/doppelt.js": ZWEITE_QUELLE,
    "test/summe.test.js": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { summe } from "../src/summe.js";\ntest("summiert", () => assert.equal(summe([1, 2]), 3));\n',
    "test/doppelt.test.js": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { doppelt } from "../src/doppelt.js";\ntest("verdoppelt", () => assert.equal(doppelt(2), 4));\n',
    ...dateien,
  });
}

function geaendert(repo) {
  writeFiles(repo, { "src/summe.js": QUELLE.replace("let ergebnis = 0;", "let ergebnis = 1;"), "src/doppelt.js": "export const doppelt = (zahl) => zahl * 3;\n" });
  return repo;
}

function plane(context, repo, ...zusatz) {
  const ziel = join(probeDirectory(context, {}), "plan.json");
  const lauf = werkzeug(repo, "HEAD", "--plan", ziel, ...zusatz);
  return { lauf, plan: lauf.status === 0 ? JSON.parse(readFileSync(ziel, "utf8")) : null };
}

test("jeder Rückfall auf reihum steht als eigene Zeile mit Grund im Plan: nichts angegeben, Tabelle leer, Grund aus dem Holen, Datei unlesbar", (context) => {
  const repo = geaendert(planRepo(context));
  const faelle = [
    { zusatz: [], grund: "keine Laufzeitdaten angegeben" },
    { zusatz: ["--laufzeiten", ablage(context, { lauf: null, dauern: {} })], grund: "Tabelle leer" },
    { zusatz: ["--laufzeiten", ablage(context, { lauf: null, grund: "kein grüner Master-Lauf", dauern: {} })], grund: "kein grüner Master-Lauf" },
    { zusatz: ["--laufzeiten", ablage(context, "{kaputt")], grund: "Laufzeitdatei unlesbar" },
  ];
  for (const { zusatz, grund } of faelle) {
    const { lauf } = plane(context, repo, ...zusatz);
    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    assert.ok(lauf.stdout.split("\n").includes(`${REIHUM} (${grund})`), `${grund}: ${lauf.stdout}`);
  }
});

test("mit Laufzeitdaten steht keine Rückfallzeile im Plan, eine angegebene aber fehlende Datei bricht Plan, Teil und Urteil ab, die Option ohne Plan, Teil oder Urteil wird abgelehnt", (context) => {
  const repo = geaendert(planRepo(context));
  const tabelle = ablage(context, { lauf: BELIEBIGER_LAUF, dauern: { [PFLICHTTEST]: LANGE_DAUER_MS } });
  const { lauf } = plane(context, repo, "--laufzeiten", tabelle);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(!lauf.stdout.includes(REIHUM), lauf.stdout);
  const fehlt = join(probeDirectory(context, {}), "gibt-es-nicht.json");
  const ergebnis = join(probeDirectory(context, {}), "teil.json");
  const abbrueche = [
    ["--plan", ergebnis],
    ["--teil", "1", "--teile", "2", "--ergebnis", ergebnis],
    ["--urteil", probeDirectory(context, {})],
  ];
  for (const betriebsart of abbrueche) {
    const abbruch = werkzeug(repo, "HEAD", ...betriebsart, "--laufzeiten", fehlt);
    assert.equal(abbruch.status, EXIT_ABBRUCH, abbruch.stdout + abbruch.stderr);
    assert.match(abbruch.stderr, /Laufzeitdatei fehlt/);
  }
  const ohneBetriebsart = werkzeug(repo, "HEAD", "--laufzeiten", tabelle);
  assert.equal(ohneBetriebsart.status, EXIT_ABBRUCH, ohneBetriebsart.stdout + ohneBetriebsart.stderr);
});

test("gleiche Laufzeitdaten ergeben dieselbe Prüfsumme, andere Daten eine andere, und ein Urteil mit anderen Daten als der Teil bricht laut ab", (context) => {
  const repo = geaendert(planRepo(context));
  const eins = ablage(context, { lauf: BELIEBIGER_LAUF, dauern: { [PFLICHTTEST]: LANGE_DAUER_MS, "test/doppelt.test.js": KURZE_DAUER_MS } });
  const gleich = ablage(context, { lauf: BELIEBIGER_LAUF, dauern: { [PFLICHTTEST]: LANGE_DAUER_MS, "test/doppelt.test.js": KURZE_DAUER_MS } });
  const anders = ablage(context, { lauf: BELIEBIGER_LAUF, dauern: { [PFLICHTTEST]: KURZE_DAUER_MS, "test/doppelt.test.js": LANGE_DAUER_MS } });
  const [mitEins, nochmal, mitAnders, ohne] = [eins, gleich, anders, undefined].map((tabelle) => plane(context, repo, ...(tabelle ? ["--laufzeiten", tabelle] : [])).plan);
  assert.equal(mitEins.pruefsumme, nochmal.pruefsumme);
  assert.notEqual(mitEins.pruefsumme, mitAnders.pruefsumme);
  assert.notEqual(mitEins.pruefsumme, ohne.pruefsumme);
  const ordner = probeDirectory(context, {});
  for (const teil of mitEins.teile) writeFileSync(join(ordner, `mutation-teil-${teil}.json`), JSON.stringify({ pruefsumme: mitEins.pruefsumme, teil, messungen: [] }));
  const passend = werkzeug(repo, "HEAD", "--urteil", ordner, "--laufzeiten", gleich);
  assert.equal(passend.status, 0, passend.stdout + passend.stderr);
  const abweichend = werkzeug(repo, "HEAD", "--urteil", ordner, "--laufzeiten", anders);
  assert.equal(abweichend.status, EXIT_ABBRUCH, abweichend.stdout + abweichend.stderr);
  assert.match(abweichend.stderr, /gehören zu einem anderen Plan/);
  const ohneDaten = werkzeug(repo, "HEAD", "--urteil", ordner);
  assert.equal(ohneDaten.status, EXIT_ABBRUCH, ohneDaten.stdout + ohneDaten.stderr);
});

function teilGelaufen(repo, teil, { ordner, tabelle }) {
  return werkzeug(repo, "HEAD", "--teil", String(teil), "--teile", "2", "--ergebnis", join(ordner, `mutation-teil-${teil}.json`), "--laufzeiten", tabelle);
}

function testdateienJeLauf(ausgabe) {
  return [...ausgabe.matchAll(/ gegen (\d+) Testdateien in /g)].map(([, anzahl]) => Number(anzahl));
}

test("ein Teil misst mit Laufzeitdaten genau die Testdateien seines Anteils: die schwere Datei allein, die übrigen im anderen Teil, das Urteil bleibt gleich", (context) => {
  const fuellung = testdateien(ANTEIL_TESTS, "test/t").map((name) => [name, 'import { summe } from "../src/summe.js";\nsumme([]);\n']);
  const repo = planRepo(context, Object.fromEntries(fuellung));
  writeFiles(repo, { "src/summe.js": QUELLE + BETRAG, [PFLICHTTEST]: BETRAG_TEST });
  const dauern = Object.fromEntries([...fuellung.map(([name]) => [name, 1]), [PFLICHTTEST, SCHWERE_DAUER_MS]]);
  const tabelle = ablage(context, { lauf: BELIEBIGER_LAUF, dauern });
  const ordner = probeDirectory(context, {});
  const { plan } = plane(context, repo, "--laufzeiten", tabelle);
  assert.equal(plan.anzahl, 2);
  const [schwer, leicht] = [1, 2].map((teil) => teilGelaufen(repo, teil, { ordner, tabelle }));
  assert.equal(schwer.status, 0, schwer.stdout + schwer.stderr);
  assert.equal(leicht.status, 0, leicht.stdout + leicht.stderr);
  assert.deepEqual([...new Set(testdateienJeLauf(schwer.stdout))], [1]);
  assert.deepEqual([...new Set(testdateienJeLauf(leicht.stdout))], [ANTEIL_TESTS]);
  const urteil = werkzeug(repo, "HEAD", "--urteil", ordner, "--laufzeiten", tabelle);
  assert.equal(urteil.status, 0, urteil.stdout + urteil.stderr);
});

function falschesGh(context, modus) {
  const ordner = probeDirectory(context, {});
  const skript = [
    "#!/bin/sh",
    'if [ "$MODUS" = "fehler" ]; then echo "HTTP 502" >&2; exit 1; fi',
    'if [ "$2" = "list" ]; then',
    '  if [ "$MODUS" = "keinlauf" ]; then echo "[]"; else echo \'[{"databaseId":4242}]\'; fi',
    "  exit 0",
    "fi",
    'while [ $# -gt 0 ]; do if [ "$1" = "-D" ]; then ziel="$2"; fi; shift; done',
    'mkdir -p "$ziel/testlaufzeit-teil-1" "$ziel/testlaufzeit-teil-2"',
    'printf \'{"datei":"test/a.test.js","dauer_ms":1500.5}\\n{"datei":"test/b.test.js","dauer_ms":null}\\n{"datei":"test/c.test.js","dauer_ms":5}\\n\' > "$ziel/testlaufzeit-teil-1/dateien.jsonl"',
    'if [ "$MODUS" = "leer" ]; then : > "$ziel/testlaufzeit-teil-1/dateien.jsonl"; fi',
    'printf \'{"datei":"test/c.test.js","dauer_ms":20}\\n{"datei":"test/a.test.js","dauer_ms":900}\\n\' > "$ziel/testlaufzeit-teil-2/dateien.jsonl"',
    'if [ "$MODUS" = "leer" ]; then : > "$ziel/testlaufzeit-teil-2/dateien.jsonl"; fi',
    "",
  ].join("\n");
  mkdirSync(join(ordner, "bin"));
  const pfad = join(ordner, "bin", "gh");
  writeFileSync(pfad, skript);
  chmodSync(pfad, 0o755);
  return { PATH: `${join(ordner, "bin")}:${process.env.PATH}`, MODUS: modus };
}

function holen(context, umgebung) {
  const ziel = join(probeDirectory(context, {}), "mutation-laufzeiten.json");
  const lauf = spawnSync(process.execPath, [WERKZEUG, "--laufzeiten-holen", ziel], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, ...umgebung } });
  return { lauf, tabelle: lauf.status === 0 ? JSON.parse(readFileSync(ziel, "utf8")) : null };
}

test("das Holen schreibt die Dauern je Testdatei aus dem neuesten grünen Master-Lauf und lässt Testdateien ohne Dauer weg", (context) => {
  const { lauf, tabelle } = holen(context, falschesGh(context, "ok"));
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(tabelle, { lauf: 4242, dauern: { "test/a.test.js": 1500.5, "test/c.test.js": 20 } });
});

test("das Holen schreibt bei jedem Misserfolg eine Tabelle mit Grund und ohne Dauern und endet grün: kein Lauf, Abruf fehlgeschlagen, gh fehlt, keine Laufzeiten im Lauf", (context) => {
  const leererPfad = join(probeDirectory(context, {}), "leer");
  mkdirSync(leererPfad);
  const faelle = [
    { umgebung: falschesGh(context, "keinlauf"), grund: /^kein grüner Master-Lauf$/ },
    { umgebung: falschesGh(context, "fehler"), grund: /^Abruf fehlgeschlagen: .*HTTP 502/ },
    { umgebung: { PATH: leererPfad, MODUS: "ok" }, grund: /^Abruf fehlgeschlagen: / },
    { umgebung: falschesGh(context, "leer"), grund: /^keine Laufzeiten im Lauf 4242$/ },
  ];
  for (const { umgebung, grund } of faelle) {
    const { lauf, tabelle } = holen(context, umgebung);
    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    assert.match(tabelle.grund, grund);
    assert.deepEqual(tabelle.dauern, {});
    assert.equal(tabelle.lauf, null);
    assert.match(lauf.stdout, /Mutationsplan: keine Laufzeiten geholt/);
  }
});

function planMitHolen(context, { umgebung, zusatz = [] }) {
  const repo = geaendert(planRepo(context));
  const ordner = probeDirectory(context, {});
  const tabelle = join(ordner, "mutation-laufzeiten.json");
  const lauf = spawnSync(process.execPath, [WERKZEUG, "--basis", "HEAD", "--plan", join(ordner, "plan.json"), "--laufzeiten-holen", tabelle, ...zusatz], {
    cwd: repo,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), ...umgebung },
  });
  return { lauf, tabelle };
}

test("der Plan holt die Laufzeiten im selben Aufruf, plant mit der geholten Tabelle und fällt bei jedem Misserfolg mit Grund auf reihum zurück", (context) => {
  const gefunden = planMitHolen(context, { umgebung: falschesGh(context, "ok") });
  assert.equal(gefunden.lauf.status, 0, gefunden.lauf.stdout + gefunden.lauf.stderr);
  assert.match(gefunden.lauf.stdout, /^Mutationsplan: Laufzeiten aus Lauf 4242, 2 Testdateien$/m);
  assert.ok(!gefunden.lauf.stdout.includes(REIHUM), gefunden.lauf.stdout);
  assert.equal(JSON.parse(readFileSync(gefunden.tabelle, "utf8")).lauf, 4242);
  const gescheitert = planMitHolen(context, { umgebung: falschesGh(context, "fehler") });
  assert.equal(gescheitert.lauf.status, 0, gescheitert.lauf.stdout + gescheitert.lauf.stderr);
  assert.match(gescheitert.lauf.stdout, /^Mutationsplan: ohne Laufzeitdaten, reihum \(Abruf fehlgeschlagen: .*HTTP 502.*\)$/m);
  assert.match(JSON.parse(readFileSync(gescheitert.tabelle, "utf8")).grund, /^Abruf fehlgeschlagen: /);
});

test("das Holen im Plan zusammen mit einer angegebenen Laufzeitdatei oder mit Teil oder Urteil wird abgelehnt", (context) => {
  const tabelle = ablage(context, { lauf: BELIEBIGER_LAUF, dauern: { [PFLICHTTEST]: LANGE_DAUER_MS } });
  const doppelt = planMitHolen(context, { umgebung: falschesGh(context, "ok"), zusatz: ["--laufzeiten", tabelle] });
  assert.equal(doppelt.lauf.status, EXIT_ABBRUCH, doppelt.lauf.stdout + doppelt.lauf.stderr);
  const mitTeil = planMitHolen(context, { umgebung: falschesGh(context, "ok"), zusatz: ["--teil", "1", "--teile", "2"] });
  assert.equal(mitTeil.lauf.status, EXIT_ABBRUCH, mitTeil.lauf.stdout + mitTeil.lauf.stderr);
});
