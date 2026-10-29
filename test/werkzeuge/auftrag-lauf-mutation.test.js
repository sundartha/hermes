import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ABSCHALTUNG_VERSTOSS, GLEICHWERTIG_ANGENOMMEN, MUTANT_UEBERLEBT, ohneTestdatei } from "../../tools/auftrag/gleichwertig.mjs";
import { ABSATZ_MUTATION, ehrlicheNachrunde, exitCodes, funktion, GLEICHWERTIG_MIT_GRUND, MIT_MUTATION, MIT_SIEBEN, mitSieben, NEU_MUTANT, NOETIG, NOETIG_GRUND, pruefeGesichert, pruefung, ROTER_TEST, SIEBEN_TEST, VERDOPPELT } from "./auftrag-lauf-hilfen.js";
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

const GRUEN_NACH_NACHRUNDE = {
  test: { "test/rechnen.test.js": ROTER_TEST },
  bau: MIT_SIEBEN,
  ...ehrlicheNachrunde(NOETIG),
  "test-nachrunde": { "test/rechnen.test.js": SIEBEN_TEST },
  "test-nachrunde-antwort": ABSATZ_MUTATION,
};

function mutationsBefehle(context, schalter) {
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: GRUEN_NACH_NACHRUNDE, dateien: MIT_MUTATION, umgebung: { HERMES_MUTATION_IN_CI: schalter } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const befehle = beleg.pruefungen.filter(({ name }) => name.startsWith("mutation")).map(({ befehl }) => befehl);
  assert.ok(befehle.length > 0, lauf.stdout + lauf.stderr);
  return befehle;
}

test("mit HERMES_MUTATION_IN_CI=1 fährt jede Mutationsprüfung des Auftrags über die CI", (context) => {
  for (const befehl of mutationsBefehle(context, "1")) assert.match(befehl, /^npm --silent run test:mutation -- --in-ci --basis /);
});

test("ohne HERMES_MUTATION_IN_CI fährt die Mutationsprüfung des Auftrags lokal", (context) => {
  for (const befehl of mutationsBefehle(context, "")) assert.doesNotMatch(befehl, /--in-ci/);
});

const VORSCHAU_ZEILE = "Vorschau alt: 3 Quelldateien, 4 Testdateien, 4 Testgruppen, 120 Mutanten; Schätzung 4 Stryker-Aufrufe × 15 s + 120 Mutanten × 1 s = 3 min; Budget der normalen Mutation 15 min Rechenzeit, davon frei 15 min.";
const BUDGET_ZEILE = "Abbruch: Budget der normalen Mutation erreicht: 15 min Rechenzeit bei 15 min Budget, dazu 0 s Warten an der Sperre; Teilergebnis bis zum Halt: 2 Stryker-Läufe fertig mit 80 Mutanten, davon 80 getötet, 1 Dateien ganz geprüft, 2 Läufe abgebrochen; kein Zeit-Log; kein Urteil.";
const ENDE_ZEILE = "Mutationslog: Ende nach 15 min, Exit 2: Erstlauf 10 %, Mutanten 85 %, Sperre 0 %";
const ANDERE_ZEILE = "Mutationslog: Sperre nach 2 s Warten erhalten";

function immerAbbrechenMit(context, zeilen) {
  const skript = [...zeilen.map((zeile) => `console.error(${JSON.stringify(zeile)});`), "process.exitCode = 2;", ""].join("\n");
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_SIEBEN };
  const ergebnis = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: { ...MIT_MUTATION, "mutation.mjs": skript } });
  const { lauf, beleg } = ergebnis;
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(beleg.entscheidung.text.startsWith("## Entscheidung nötig\n"), beleg.entscheidung.text);
  return { ...ergebnis, notizPrompt: readFileSync(join(ergebnis.werkzeug, "prompt-notiz.txt"), "utf8") };
}

test("endet die Mutationsprüfung am Budget, läuft sie nicht noch einmal und die Notiz sieht Budget, Schätzung und Dauer", (context) => {
  const { beleg, notizPrompt } = immerAbbrechenMit(context, [ANDERE_ZEILE, VORSCHAU_ZEILE, BUDGET_ZEILE, ENDE_ZEILE]);
  assert.deepEqual(exitCodes(beleg, "mutation"), [2]);
  assert.equal(beleg.grund, "mutation am Budget beendet, kein Urteil; die Prüfung läuft nicht noch einmal.");
  assert.ok(notizPrompt.includes(`${VORSCHAU_ZEILE}\n${BUDGET_ZEILE}\n${ENDE_ZEILE}\n`), notizPrompt);
  assert.ok(!notizPrompt.includes(ANDERE_ZEILE), notizPrompt);
});

test("nennt ein anderer Abbruch nur in der Vorschau das Budget, läuft die Mutationsprüfung weiter einmal neu", (context) => {
  const { beleg } = immerAbbrechenMit(context, [VORSCHAU_ZEILE, "Abbruch: Netzfehler"]);
  assert.deepEqual(exitCodes(beleg, "mutation"), [2, 2]);
  assert.ok(beleg.entscheidung.text.includes("Ein Werkzeug ist 2-mal abgebrochen"), beleg.entscheidung.text);
});

const OHNE_PFAD = NEU_MUTANT.slice(NEU_MUTANT.indexOf(":") + 1);
const NACHFRAGE = "## Meldung ohne genauen Schlüssel";
const GRUND_OHNE_PFAD = "die Sieben ohne Sonderfall dasselbe Ergebnis hätte";

function mitMeldung(context, { erste, zweite, naechsteRunde = {} }) {
  const zusatz = { ...naechsteRunde, "bau-nachrunde-antwort": erste, nach: NACHFRAGE, ...(zweite === undefined ? {} : { "bau-nach-antwort": zweite }) };
  const ergebnis = mitSieben(context, zusatz);
  const nachfrage = join(ergebnis.werkzeug, "prompt-bau-nach.txt");
  return { ...ergebnis, nachfrage: existsSync(nachfrage) ? readFileSync(nachfrage, "utf8") : null };
}

test("meldet der Bau-Agent einen Mutanten ohne Dateipfad als gleichwertig, fragt der Lauf in derselben Sitzung nach den genauen Schlüsseln und nimmt die Meldung mit Pfad an", (context) => {
  const erste = `Gleichwertig: ${OHNE_PFAD}, weil ${GRUND_OHNE_PFAD}`;
  const { lauf, beleg, nachfrage } = mitMeldung(context, { erste, zweite: GLEICHWERTIG_MIT_GRUND });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(nachfrage !== null, "keine Nachfrage gestellt");
  assert.ok(nachfrage.includes(erste) && nachfrage.includes(`- ${NEU_MUTANT}\n`), nachfrage);
  const [ersterBau] = beleg.agenten.filter(({ rolle }) => rolle === "bau");
  assert.deepEqual(beleg.nachfragen.map(({ sitzung }) => sitzung), [ersterBau.sitzung]);
  assert.deepEqual(exitCodes(beleg, "mutation"), [EXIT_ROT]);
  assert.equal(pruefung(beleg, "mutation nach Bau"), 0);
  const { zeilen } = beleg.pruefungen.findLast(({ name }) => name === "mutation nach Bau");
  assert.ok(zeilen.includes(`${GLEICHWERTIG_ANGENOMMEN}: ${NEU_MUTANT}`), zeilen.join("\n"));
});

test("steht die Meldung auch nach der Nachfrage ohne genauen Schlüssel, endet der Lauf mit der Zeile und startet keine weitere Mutationsprüfung", (context) => {
  const erste = `Gleichwertig: ${OHNE_PFAD}, weil ${GRUND_OHNE_PFAD}`;
  const { lauf, beleg } = mitMeldung(context, { erste, zweite: erste, naechsteRunde: { "bau-antwort": ABSATZ_MUTATION } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(beleg.grund.includes(OHNE_PFAD) && beleg.grund.includes(GRUND_OHNE_PFAD), beleg.grund);
  assert.deepEqual(beleg.pruefungen.filter(({ name }) => name.startsWith("mutation")).map(({ name }) => name), ["mutation"]);
});

test("ändert der Bau-Agent bei der Nachfrage zur Meldung eine Datei, endet der Lauf damit und startet keine weitere Mutationsprüfung", (context) => {
  const erste = `Gleichwertig: ${OHNE_PFAD}, weil ${GRUND_OHNE_PFAD}`;
  const geaendert = { "src/text.js": "export function gross(text) {\n  return text.toUpperCase().trim();\n}\n" };
  const naechsteRunde = { "bau-antwort": ABSATZ_MUTATION, "bau-nach": geaendert };
  const { lauf, beleg } = mitMeldung(context, { erste, zweite: GLEICHWERTIG_MIT_GRUND, naechsteRunde });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, "Die Nachfrage zur Meldung hat Dateien geändert.");
  assert.deepEqual(beleg.pruefungen.filter(({ name }) => name.startsWith("mutation")).map(({ name }) => name), ["mutation"]);
});

test("passt jede Meldung der Nachrunde genau auf einen überlebenden Mutanten, fragt der Lauf nicht nach", (context) => {
  const { lauf, nachfrage } = mitMeldung(context, { erste: GLEICHWERTIG_MIT_GRUND });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(nachfrage, null);
});

const WIDERSPRUCH_GRUND = "ohne die Zeile liefert die Sieben dasselbe Ergebnis und kein Test kann sie anders erwarten";
const WIDERSPRUCH = `Widerspruch: ${NEU_MUTANT}, weil ${WIDERSPRUCH_GRUND}`;
const NOETIG_ERNEUT_GRUND = "die Sieben soll null liefern, auch wenn das kein Test festhält";
const NOETIG_ERNEUT = `Nötig: ${NEU_MUTANT}, weil ${NOETIG_ERNEUT_GRUND}`;
const BAU_NACH_WIDERSPRUCH = "bau-nach-nachrunde-antwort";
const ABGESCHALTET_GRUND = "der Ersatz-Agent sieht keinen Unterschied";
const NOETIG_ABGESCHALTET = `Nötig: ${ABGESCHALTETER_MUTANT}, weil ${NOETIG_GRUND}`;
const WIDERSPRUCH_ABGESCHALTET = `Widerspruch: ${ABGESCHALTETER_MUTANT}, weil ${ABGESCHALTET_GRUND}`;
const AUSWEG_TEST_AGENT = "Widerspruch: <Mutant>, weil";
const NAECHSTE_RUNDE = { "bau-antwort": ABSATZ_MUTATION, "test-antwort": ABSATZ_MUTATION };
const GLEICHWERTIG_WEG_TEST_AGENT = "antworte statt eines Tests mit einer Zeile je Mutant";

function mitWiderspruch(context, zusatz) {
  return mitSieben(context, { ...ehrlicheNachrunde(NOETIG), nach: WIDERSPRUCH_GRUND, "test-nachrunde-antwort": WIDERSPRUCH, ...zusatz });
}

function rollen(beleg) {
  return beleg.agenten.map(({ rolle }) => rolle);
}

test("widerspricht der Test-Agent einem „Nötig“, geht der Widerspruch mit seiner Begründung einmal an den Bau-Agenten zurück und dessen Gleichwertig-Meldung gilt nach neuer Messung", (context) => {
  const { repo, werkzeug, lauf, beleg } = mitWiderspruch(context, { [BAU_NACH_WIDERSPRUCH]: GLEICHWERTIG_MIT_GRUND });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(rollen(beleg), ["test", "bau", "bau", "test", "bau"]);
  assert.deepEqual(exitCodes(beleg, "mutation nach Bau"), [EXIT_ROT, 0]);
  const nachBau = beleg.pruefungen.findLast(({ name }) => name === "mutation nach Bau");
  assert.ok(nachBau.befehl.includes(`--gleichwertig ${NEU_MUTANT}`), nachBau.befehl);
  const prompt = readFileSync(join(werkzeug, "prompt-bau-nach-nachrunde.txt"), "utf8");
  assert.ok(prompt.includes(`${NEU_MUTANT}, weil ${WIDERSPRUCH_GRUND}`), prompt);
  assert.ok(runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout.includes(GLEICHWERTIG_MIT_GRUND));
});

test("vereinfacht der Bau-Agent die Zeile nach dem Widerspruch des Test-Agenten, misst der Lauf neu und der Mutant ist weg", (context) => {
  const nach = { "bau-nach-nachrunde": { "src/rechnen.js": VERDOPPELT }, [BAU_NACH_WIDERSPRUCH]: ABSATZ_MUTATION };
  const { repo, lauf, beleg } = mitWiderspruch(context, nach);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, "mutation nach Bau"), [EXIT_ROT, 0]);
  assert.equal(runIn(repo, "git", ["show", "HEAD:src/rechnen.js"]).stdout, VERDOPPELT);
  const mutationen = beleg.pruefungen.filter(({ name }) => name.startsWith("mutation"));
  assert.ok(mutationen.every(({ befehl }) => !befehl.includes("--gleichwertig")), JSON.stringify(mutationen));
});

test("bleibt der Bau-Agent nach dem Widerspruch bei „Nötig“, hält der Lauf mit „Entscheidung nötig“ und beiden Begründungen an und es folgt keine dritte Runde", (context) => {
  const { lauf, beleg } = mitWiderspruch(context, { [BAU_NACH_WIDERSPRUCH]: NOETIG_ERNEUT });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(beleg.entscheidung.text.startsWith("## Entscheidung nötig\n"), beleg.entscheidung.text);
  for (const begruendung of [NOETIG_GRUND, WIDERSPRUCH_GRUND, NOETIG_ERNEUT_GRUND]) assert.ok(beleg.entscheidung.text.includes(begruendung), begruendung);
  assert.deepEqual(rollen(beleg), ["test", "bau", "bau", "test", "bau"]);
  assert.deepEqual(exitCodes(beleg, "mutation nach Bau"), [EXIT_ROT]);
});

test("widerspricht der Test-Agent einem Mutanten, den der Bau-Agent nicht „Nötig“ nannte, geht nichts zurück und der Mutant bleibt überlebend", (context) => {
  const { lauf, beleg, werkzeug } = mitSieben(context, { ...NAECHSTE_RUNDE, "test-nachrunde-antwort": WIDERSPRUCH });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, `Mutant überlebt: ${NEU_MUTANT}`);
  assert.deepEqual(rollen(beleg), ["test", "bau", "bau", "test"]);
  assert.ok(!readFileSync(join(werkzeug, "prompt-test-nachrunde.txt"), "utf8").includes(AUSWEG_TEST_AGENT));
});

test("nimmt die Messung die Gleichwertig-Meldung nach dem Widerspruch nicht an, bleibt der Mutant überlebend und der Auftrag rot", (context) => {
  const gleichwertigAbgeschaltet = `Gleichwertig: ${ABGESCHALTETER_MUTANT}, weil ${ABGESCHALTET_GRUND}`;
  const mutanten = [{ mutant: ABGESCHALTETER_MUTANT, annehmbar: false, abgeschaltet: true }];
  const zusatz = {
    ...NAECHSTE_RUNDE,
    nach: ABGESCHALTET_GRUND,
    "bau-nachrunde-antwort": { "Nötig: <Mutant>": NOETIG_ABGESCHALTET, "": "" },
    "test-nachrunde": {},
    "test-nachrunde-antwort": { [AUSWEG_TEST_AGENT]: WIDERSPRUCH_ABGESCHALTET, "": ABSATZ_MUTATION },
    [BAU_NACH_WIDERSPRUCH]: gleichwertigAbgeschaltet,
  };
  const { lauf, beleg } = mitZaehlenderMutation(context, { mutanten }, zusatz);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, `Mutant überlebt: ${ABGESCHALTETER_MUTANT}`);
  assert.deepEqual(exitCodes(beleg, "mutation nach Bau"), [EXIT_ROT, EXIT_ROT]);
  const nachBau = beleg.pruefungen.findLast(({ name }) => name === "mutation nach Bau");
  assert.ok(nachBau.befehl.includes(`--gleichwertig ${ABGESCHALTETER_MUTANT}`), nachBau.befehl);
  assert.equal(pruefung(beleg, "mutation nach Test"), EXIT_ROT);
});

test("widerspricht der Test-Agent nach der Rückgabe ein zweites Mal, hält der Lauf mit „Entscheidung nötig“ an", (context) => {
  const zweiterGrund = "auch die Rückgabe ändert nichts am Verhalten";
  const mutanten = [{ mutant: ABGESCHALTETER_MUTANT, annehmbar: false, abgeschaltet: true }];
  const zusatz = {
    ...NAECHSTE_RUNDE,
    nach: ABGESCHALTET_GRUND,
    "bau-nachrunde-antwort": { "Nötig: <Mutant>": NOETIG_ABGESCHALTET, "": "" },
    "test-nachrunde": {},
    "test-nachrunde-antwort": { [AUSWEG_TEST_AGENT]: WIDERSPRUCH_ABGESCHALTET, "": `Widerspruch: ${ABGESCHALTETER_MUTANT}, weil ${zweiterGrund}` },
    [BAU_NACH_WIDERSPRUCH]: `Gleichwertig: ${ABGESCHALTETER_MUTANT}, weil ${ABGESCHALTET_GRUND}`,
  };
  const { lauf, beleg } = mitZaehlenderMutation(context, { mutanten }, zusatz);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(beleg.entscheidung.text.startsWith("## Entscheidung nötig\n"), beleg.entscheidung.text);
  for (const begruendung of [ABGESCHALTET_GRUND, zweiterGrund]) assert.ok(beleg.entscheidung.text.includes(begruendung), begruendung);
  assert.equal(pruefung(beleg, "mutation nach Test"), undefined);
});

test("die Test-Nachrunde nennt dem Test-Agenten die Widerspruch-Zeile für als nötig gemeldete Mutanten, aber keinen Gleichwertig-Weg", (context) => {
  const { werkzeug } = mitWiderspruch(context, { [BAU_NACH_WIDERSPRUCH]: NOETIG_ERNEUT });
  const prompt = readFileSync(join(werkzeug, "prompt-test-nachrunde.txt"), "utf8");
  assert.ok(prompt.includes(AUSWEG_TEST_AGENT), prompt);
  assert.ok(!prompt.includes(GLEICHWERTIG_WEG_TEST_AGENT), prompt);
});
