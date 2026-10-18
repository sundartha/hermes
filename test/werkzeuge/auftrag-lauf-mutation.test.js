import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ABSCHALTUNG_VERSTOSS, GLEICHWERTIG_ANGENOMMEN, MUTANT_UEBERLEBT, ohneTestdatei } from "../../tools/auftrag/gleichwertig.mjs";
import { ABSATZ_MUTATION, ehrlicheNachrunde, exitCodes, funktion, GLEICHWERTIG_MIT_GRUND, MIT_MUTATION, MIT_SIEBEN, mitSieben, NEU_MUTANT, NOETIG, NOETIG_GRUND, pruefeGesichert, pruefung, ROTER_TEST, SIEBEN_TEST } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

test("überlebt ein Mutant, streicht oder meldet der Bau-Agent in seiner Sitzung, sonst ergänzt der Test-Agent", (context) => {
  const faelle = [
    { zusatz: { "bau-nachrunde-antwort": GLEICHWERTIG_MIT_GRUND }, letzte: "mutation nach Bau", nachricht: GLEICHWERTIG_MIT_GRUND },
    { zusatz: { "test-nachrunde": { "test/rechnen.test.js": SIEBEN_TEST }, "test-nachrunde-antwort": ABSATZ_MUTATION }, letzte: "mutation nach Test", nachricht: "Art: funktion" },
  ];
  for (const { zusatz, letzte, nachricht } of faelle) {
    const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_SIEBEN, ...zusatz };
    const { repo, werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: MIT_MUTATION });
    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    assert.deepEqual([pruefung(beleg, "mutation"), pruefung(beleg, letzte)], [EXIT_ROT, 0]);
    assert.deepEqual(exitCodes(beleg, "mutation"), [EXIT_ROT]);
    const [ersterBau, nachrunde] = beleg.agenten.filter(({ rolle }) => rolle === "bau");
    assert.equal(nachrunde.sitzung, ersterBau.sitzung);
    assert.match(readFileSync(join(werkzeug, "prompt-bau-nachrunde.txt"), "utf8"), /src\/rechnen\.js:2:7/);
    assert.ok(runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout.includes(nachricht), letzte);
  }
});

test("hält der Bau-Agent eine überlebende Zeile für nötig, ergänzt der Test-Agent den Test und der Auftrag wird grün", (context) => {
  const nachgeholt = { "test-nachrunde": { "test/rechnen.test.js": SIEBEN_TEST }, "test-nachrunde-antwort": ABSATZ_MUTATION };
  const { repo, werkzeug, lauf, beleg } = mitSieben(context, { ...ehrlicheNachrunde(NOETIG), ...nachgeholt });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual([pruefung(beleg, "mutation"), pruefung(beleg, "mutation nach Test")], [EXIT_ROT, 0]);
  assert.ok(readFileSync(join(werkzeug, "prompt-test-nachrunde.txt"), "utf8").includes(NOETIG_GRUND));
  assert.equal(runIn(repo, "git", ["show", "HEAD:src/rechnen.js"]).stdout, MIT_SIEBEN["src/rechnen.js"]);
  assert.doesNotMatch(runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout, /^Gleichwertig: /m);
});

test("eine als nötig gemeldete Zeile gilt nie als gleichwertig; tötet kein Test den Mutanten, bleibt der Auftrag rot", (context) => {
  const ergebnis = mitSieben(context, { ...ehrlicheNachrunde(`${NOETIG}\n${GLEICHWERTIG_MIT_GRUND}`), "bau-antwort": ABSATZ_MUTATION, "test-antwort": ABSATZ_MUTATION });
  const { lauf, beleg } = ergebnis;
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, `Mutant überlebt: ${NEU_MUTANT}`);
  assert.equal(pruefung(beleg, "mutation nach Test"), EXIT_ROT);
  const mutationen = beleg.pruefungen.filter(({ name }) => name.startsWith("mutation"));
  assert.ok(mutationen.every(({ befehl }) => !befehl.includes("--gleichwertig")), JSON.stringify(mutationen));
  pruefeGesichert(ergebnis);
});

test("bricht die Mutationsprüfung mit rotem Erstlauf ab, nennt der Grund der Runde Testdatei und Testname", (context) => {
  const erstlaufRot = [
    'console.error("Abbruch: Erstlauf rot: test/rechnen.test.js › verdopple > sieben");',
    'console.error("Abbruch: There were failed tests in the initial test run.");',
    "process.exitCode = 2;",
    "",
  ].join("\n");
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_SIEBEN };
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: { ...MIT_MUTATION, "mutation.mjs": erstlaufRot } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, "mutation ist mit Exit 2 abgebrochen: Erstlauf rot: test/rechnen.test.js › verdopple > sieben");
  assert.equal(pruefung(beleg, "mutation"), 2);
});

test("bricht die Mutationsprüfung einmal ab, wiederholt der Lauf nur diesen Schritt und setzt keinen Agenten neu ein", (context) => {
  const einmalAbbrechen = [
    'import { existsSync, writeFileSync } from "node:fs";',
    'if (existsSync(".git/mutation-abgebrochen")) process.exitCode = 0;',
    'else { writeFileSync(".git/mutation-abgebrochen", ""); console.error("Abbruch: Netzfehler"); process.exitCode = 2; }',
    "",
  ].join("\n");
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_SIEBEN };
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: { ...MIT_MUTATION, "mutation.mjs": einmalAbbrechen } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, "mutation"), [2, 0]);
  assert.deepEqual(beleg.agenten.map(({ rolle }) => rolle), ["test", "bau"]);
});

test("bricht die Mutationsprüfung auch in der Wiederholung ab, hält der Auftrag ohne neue Runde mit „Entscheidung nötig“ an", (context) => {
  const immerAbbrechen = ['console.error("Abbruch: Netzfehler");', "process.exitCode = 2;", ""].join("\n");
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_SIEBEN };
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: { ...MIT_MUTATION, "mutation.mjs": immerAbbrechen } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, "mutation"), [2, 2]);
  assert.equal(beleg.runde, 1);
  assert.ok(beleg.entscheidung.text.startsWith("## Entscheidung nötig\n"), beleg.entscheidung.text);
  assert.ok(beleg.entscheidung.text.includes("Ein Werkzeug ist 2-mal abgebrochen"), beleg.entscheidung.text);
});

const ZWEITER_MUTANT = "src/rechnen.js:3:10 ArithmeticOperator → zahl / 2";
const ABGESCHALTETER_MUTANT = "src/rechnen.js:2:3 IfStatement → false";
const MUTANT_OHNE_TESTDATEI = ohneTestdatei("src/rechnen.js", 2).schluessel;
const ZAEHLENDE_MUTATION = [
  'import { appendFileSync, readFileSync } from "node:fs";',
  'appendFileSync(".git/mutation-aufrufe", "aufruf\\n");',
  'const { mutanten, abschaltung, ueberlebt, verstoesse = [], rotOhneZeile = false } = JSON.parse(readFileSync("mutanten.json", "utf8"));',
  'const getestet = readFileSync("test/rechnen.test.js", "utf8").includes("(7)");',
  "const offen = getestet ? [] : mutanten.filter(({ mutant, annehmbar }) => !(annehmbar && process.argv.includes(mutant)));",
  'for (const { mutant, abgeschaltet } of offen) if (abgeschaltet) console.log(abschaltung + ": " + mutant);',
  'for (const { mutant } of offen) console.log(ueberlebt + ": " + mutant);',
  "const weitere = getestet ? [] : verstoesse;",
  "for (const zeile of weitere) console.log(zeile);",
  "process.exitCode = offen.length + weitere.length > 0 || (rotOhneZeile && !getestet) ? 1 : 0;",
  "",
].join("\n");

function gleichwertig(mutant) {
  return `Gleichwertig: ${mutant}, weil der Ersatz-Agent es so meldet`;
}

function mitZaehlenderMutation(context, ausgabe, zusatz) {
  const nachgeholt = { "test-nachrunde": { "test/rechnen.test.js": SIEBEN_TEST }, "test-nachrunde-antwort": ABSATZ_MUTATION };
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_SIEBEN, ...nachgeholt, ...zusatz };
  const liste = JSON.stringify({ mutanten: [], ...ausgabe, abschaltung: ABSCHALTUNG_VERSTOSS, ueberlebt: MUTANT_UEBERLEBT });
  const ergebnis = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: { ...MIT_MUTATION, "mutation.mjs": ZAEHLENDE_MUTATION, "mutanten.json": liste } });
  const aufrufe = readFileSync(join(ergebnis.repo, ".git/mutation-aufrufe"), "utf8").split("aufruf\n").length - 1;
  const { pruefungen } = ergebnis.beleg;
  const nachBau = pruefungen.filter(({ name }) => name === "mutation nach Bau");
  const promptDatei = join(ergebnis.werkzeug, "prompt-test-nachrunde.txt");
  return { ...ergebnis, aufrufe, nachBau, testPrompt: existsSync(promptDatei) ? readFileSync(promptDatei, "utf8") : "" };
}

const ZWEI_UEBERLEBENDE = {
  mutanten: [
    { mutant: NEU_MUTANT, annehmbar: true },
    { mutant: ZWEITER_MUTANT, annehmbar: true },
  ],
};
const UEBERSPRUNGEN = "Hinweis: mutation nach Bau nicht neu ausgeführt";

function pruefeNachBau({ lauf, aufrufe, nachBau }, { abgeleitet }) {
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(aufrufe, abgeleitet ? 2 : 3);
  assert.deepEqual(nachBau.map(({ exitCode }) => exitCode), [EXIT_ROT]);
  const [{ zeilen }] = nachBau;
  assert.equal(zeilen.some((zeile) => zeile.startsWith(UEBERSPRUNGEN) && zeile.includes("unverändert")), abgeleitet, JSON.stringify(nachBau));
  return zeilen;
}

const GLEICHWERTIG_UND_NOETIG = `${ABSATZ_MUTATION}\n${gleichwertig(NEU_MUTANT)}\nNötig: ${ZWEITER_MUTANT}, weil ${NOETIG_GRUND}`;

test("ändert der Bau-Agent nach überlebenden Mutanten nichts, läuft die Mutationsprüfung nach dem Bau nicht noch einmal und der Beleg nennt den Grund", (context) => {
  const ergebnis = mitZaehlenderMutation(context, ZWEI_UEBERLEBENDE, { "bau-nachrunde-antwort": GLEICHWERTIG_UND_NOETIG });
  const zeilen = pruefeNachBau(ergebnis, { abgeleitet: true });
  assert.ok(zeilen.includes(`${GLEICHWERTIG_ANGENOMMEN}: ${NEU_MUTANT}`), zeilen.join("\n"));
  const { testPrompt } = ergebnis;
  assert.ok(testPrompt.includes(`- ${ZWEITER_MUTANT}\n`));
  assert.ok(!testPrompt.includes(`- ${NEU_MUTANT}\n`));
});

test("ändert der Bau-Agent nach überlebenden Mutanten eine Datei, läuft die Mutationsprüfung nach dem Bau wie bisher", (context) => {
  const umgestellt = { "src/rechnen.js": "export function verdopple(zahl) {\n  if (zahl === 7) return 0;\n  return 2 * zahl;\n}\n" };
  pruefeNachBau(mitZaehlenderMutation(context, ZWEI_UEBERLEBENDE, { "bau-nachrunde": umgestellt, "bau-nachrunde-antwort": GLEICHWERTIG_UND_NOETIG }), { abgeleitet: false });
});

test("ohne neuen Lauf nach dem Bau gelten abgeschaltete Mutanten und Mutanten ohne Testdatei trotz Gleichwertig-Meldung weiter als überlebend", (context) => {
  const mutanten = [
    { mutant: NEU_MUTANT, annehmbar: true },
    { mutant: MUTANT_OHNE_TESTDATEI, annehmbar: false },
    { mutant: ABGESCHALTETER_MUTANT, annehmbar: false, abgeschaltet: true },
  ];
  const antwort = [ABSATZ_MUTATION, ...mutanten.map(({ mutant }) => gleichwertig(mutant))].join("\n");
  const ergebnis = mitZaehlenderMutation(context, { mutanten }, { "bau-nachrunde-antwort": antwort });
  const zeilen = pruefeNachBau(ergebnis, { abgeleitet: true });
  for (const zeile of [`${ABSCHALTUNG_VERSTOSS}: ${ABGESCHALTETER_MUTANT}`, `${MUTANT_UEBERLEBT}: ${MUTANT_OHNE_TESTDATEI}`, `${MUTANT_UEBERLEBT}: ${ABGESCHALTETER_MUTANT}`]) {
    assert.ok(zeilen.includes(zeile), `${zeile}\n${zeilen.join("\n")}`);
  }
  const { testPrompt } = ergebnis;
  assert.ok(testPrompt.includes(`- ${MUTANT_OHNE_TESTDATEI}\n- ${ABGESCHALTETER_MUTANT}\n`), testPrompt);
  assert.ok(!testPrompt.includes(`- ${NEU_MUTANT}\n`));
});

const ZUSTANDSZUGRIFF = "Verstoß: Zeile fragt Strykers Zustand ab, ein Test darf nicht erkennen, ob ein Mutant aktiv ist: src/rechnen.js:2";

test("meldet der erste Durchgang nur einen Zustandszugriff, bleibt die Mutationsprüfung nach dem Bau ohne neuen Lauf rot", (context) => {
  const zeilen = pruefeNachBau(mitZaehlenderMutation(context, { verstoesse: [ZUSTANDSZUGRIFF] }, { "bau-nachrunde-antwort": ABSATZ_MUTATION }), { abgeleitet: true });
  assert.ok(zeilen.includes(ZUSTANDSZUGRIFF), zeilen.join("\n"));
});

test("endet der erste Durchgang rot ohne lesbare Verstoßzeile, läuft die Mutationsprüfung nach dem Bau neu", (context) => {
  pruefeNachBau(mitZaehlenderMutation(context, { rotOhneZeile: true }, { "bau-nachrunde-antwort": ABSATZ_MUTATION }), { abgeleitet: false });
});
