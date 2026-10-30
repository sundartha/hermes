import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MUTANT_UEBERLEBT } from "../../tools/auftrag/gleichwertig.mjs";
import { ABGESCHALTETER_MUTANT, ABSATZ_MUTATION, ehrlicheNachrunde, exitCodes, funktion, GLEICHWERTIG_MIT_GRUND, MIT_MUTATION, MIT_SIEBEN, mitSieben, mitZaehlenderMutation, NEU_MUTANT, NOETIG, NOETIG_GRUND, PASST_NICHT, pruefung, ROTER_TEST, SIEBEN_TEST, VERDOPPELT, ZWEITER_MUTANT } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const WIDERSPRUCH_GRUND = "ohne die Zeile liefert die Sieben dasselbe Ergebnis und kein Test kann sie anders erwarten";
const WIDERSPRUCH = `Widerspruch: ${NEU_MUTANT}, weil ${WIDERSPRUCH_GRUND}`;
const NOETIG_ERNEUT_GRUND = "die Sieben soll null liefern, auch wenn das kein Test festhält";
const NOETIG_ERNEUT = `Nötig: ${NEU_MUTANT}, weil ${NOETIG_ERNEUT_GRUND}`;
const BAU_NACH_WIDERSPRUCH = "bau-nach-nachrunde-antwort";
const MARKE_RUECKGABE = "und widerspricht deinem „Nötig“";
const ABGESCHALTET_GRUND = "der Ersatz-Agent sieht keinen Unterschied";
const NOETIG_ABGESCHALTET = `Nötig: ${ABGESCHALTETER_MUTANT}, weil ${NOETIG_GRUND}`;
const WIDERSPRUCH_ABGESCHALTET = `Widerspruch: ${ABGESCHALTETER_MUTANT}, weil ${ABGESCHALTET_GRUND}`;
const AUSWEG_TEST_AGENT = "steige nicht aus, sondern antworte je Mutant";
const NAECHSTE_RUNDE = { "bau-antwort": ABSATZ_MUTATION, "test-antwort": ABSATZ_MUTATION };
const GLEICHWERTIG_WEG_TEST_AGENT = "antworte statt eines Tests mit einer Zeile je Mutant";

function mitWiderspruch(context, zusatz) {
  return mitSieben(context, { ...ehrlicheNachrunde(NOETIG), nach: MARKE_RUECKGABE, "test-nachrunde-antwort": WIDERSPRUCH, ...zusatz });
}

function rollen(beleg) {
  return beleg.agenten.map(({ rolle }) => rolle);
}

function ersteRunde(repo) {
  return JSON.parse(readFileSync(join(repo, ".fortschritt/probe/A1.runde-1.json"), "utf8"));
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
  const { lauf, beleg, werkzeug, repo } = mitSieben(context, { ...NAECHSTE_RUNDE, "test-nachrunde-antwort": WIDERSPRUCH });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, `Mutant überlebt: ${NEU_MUTANT}`);
  assert.deepEqual(rollen(ersteRunde(repo)), ["test", "bau", "bau", "test"]);
  assert.ok(!readFileSync(join(werkzeug, "prompt-test-nachrunde.txt"), "utf8").includes(AUSWEG_TEST_AGENT));
});

const NUR_ABGESCHALTET = { mutanten: [{ mutant: ABGESCHALTETER_MUTANT, annehmbar: false, abgeschaltet: true }] };

function abgeschaltetNachRueckgabe(zweiteTestAntwort) {
  return ohneTestdateiNachrunde({
    "bau-nachrunde-antwort": { "Nötig: <Mutant>": NOETIG_ABGESCHALTET, "": "" },
    "test-nachrunde-antwort": { [AUSWEG_TEST_AGENT]: WIDERSPRUCH_ABGESCHALTET, "": zweiteTestAntwort },
    [BAU_NACH_WIDERSPRUCH]: `Gleichwertig: ${ABGESCHALTETER_MUTANT}, weil ${ABGESCHALTET_GRUND}`,
  });
}

test("nimmt die Messung die Gleichwertig-Meldung nach dem Widerspruch nicht an, bleibt der Mutant überlebend und der Auftrag rot", (context) => {
  const { lauf, beleg, repo } = mitZaehlenderMutation(context, NUR_ABGESCHALTET, abgeschaltetNachRueckgabe(ABSATZ_MUTATION));
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, `Mutant überlebt: ${ABGESCHALTETER_MUTANT}`, lauf.stdout + lauf.stderr);
  const erste = ersteRunde(repo);
  assert.deepEqual(exitCodes(erste, "mutation nach Bau"), [EXIT_ROT, EXIT_ROT]);
  const nachBau = erste.pruefungen.findLast(({ name }) => name === "mutation nach Bau");
  assert.ok(nachBau.befehl.includes(`--gleichwertig ${ABGESCHALTETER_MUTANT}`), nachBau.befehl);
  assert.equal(pruefung(beleg, "mutation nach Test"), EXIT_ROT);
});

test("widerspricht der Test-Agent nach der Rückgabe ein zweites Mal, hält der Lauf mit „Entscheidung nötig“ an", (context) => {
  const zweiterGrund = "auch die Rückgabe ändert nichts am Verhalten";
  const zusatz = abgeschaltetNachRueckgabe(`Widerspruch: ${ABGESCHALTETER_MUTANT}, weil ${zweiterGrund}`);
  const { lauf, beleg } = mitZaehlenderMutation(context, NUR_ABGESCHALTET, zusatz);
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
  const [, anTestAgent] = prompt.split("\n").find((zeile) => zeile.includes("Ausweg:")).split("der Test-Agent");
  assert.ok(anTestAgent.includes("Widerspruch:") && !anTestAgent.includes("Gleichwertig"), anTestAgent);
});

const ZWEI_ABGESCHALTET = [
  { mutant: ABGESCHALTETER_MUTANT, annehmbar: false, abgeschaltet: true },
  { mutant: ZWEITER_MUTANT, annehmbar: false },
];
const NOETIG_ZWEITER_GRUND = "die Division gehört zur Rechnung";
const NOETIG_ZWEITER = `Nötig: ${ZWEITER_MUTANT}, weil ${NOETIG_ZWEITER_GRUND}`;

function ohneTestdateiNachrunde(zusatz) {
  return { ...NAECHSTE_RUNDE, nach: MARKE_RUECKGABE, "test-nachrunde": {}, ...zusatz };
}

test("widerspricht der Test-Agent nur einem Mutanten, den der Bau-Agent nicht „Nötig“ nannte, geht trotz anderer „Nötig“-Zeilen nichts zurück", (context) => {
  const zusatz = ohneTestdateiNachrunde({
    "bau-nachrunde-antwort": { "Nötig: <Mutant>": NOETIG_ABGESCHALTET, "": "" },
    "test-nachrunde-antwort": `Widerspruch: ${ZWEITER_MUTANT}, weil ${ABGESCHALTET_GRUND}`,
  });
  const { lauf, beleg, repo } = mitZaehlenderMutation(context, { mutanten: ZWEI_ABGESCHALTET }, zusatz);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(rollen(ersteRunde(repo)), ["test", "bau", "bau", "test"]);
  assert.equal(beleg.grund, `Mutant überlebt: ${ABGESCHALTETER_MUTANT}`, lauf.stdout + lauf.stderr);
});

test("gibt der Lauf einen Widerspruch zurück, fragt die zweite Test-Runde nur noch die übrigen „Nötig“-Mutanten und bietet keinen zweiten Widerspruch an", (context) => {
  const zusatz = ohneTestdateiNachrunde({
    "bau-nachrunde-antwort": { "Nötig: <Mutant>": `${NOETIG_ABGESCHALTET}\n${NOETIG_ZWEITER}`, "": "" },
    "test-nachrunde-antwort": { [AUSWEG_TEST_AGENT]: WIDERSPRUCH_ABGESCHALTET, "": PASST_NICHT },
    [BAU_NACH_WIDERSPRUCH]: `Gleichwertig: ${ABGESCHALTETER_MUTANT}, weil ${ABGESCHALTET_GRUND}`,
  });
  const { lauf, testPrompt } = mitZaehlenderMutation(context, { mutanten: ZWEI_ABGESCHALTET }, zusatz);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(testPrompt.includes(`- ${ZWEITER_MUTANT}, weil ${NOETIG_ZWEITER_GRUND}\n`), testPrompt);
  assert.ok(!testPrompt.includes(`- ${ABGESCHALTETER_MUTANT}, weil `), testPrompt);
  assert.ok(!testPrompt.includes(AUSWEG_TEST_AGENT), testPrompt);
});

test("widerspricht der Test-Agent in der zweiten Runde einem Mutanten, den der Bau-Agent nie „Nötig“ nannte, hält der Lauf nicht an und misst weiter", (context) => {
  const zusatz = ohneTestdateiNachrunde({
    "bau-nachrunde-antwort": { "Nötig: <Mutant>": `${NOETIG_ABGESCHALTET}\n${NOETIG_ZWEITER}`, "": "" },
    "test-nachrunde-antwort": { [AUSWEG_TEST_AGENT]: WIDERSPRUCH_ABGESCHALTET, "": WIDERSPRUCH },
    [BAU_NACH_WIDERSPRUCH]: `Gleichwertig: ${ABGESCHALTETER_MUTANT}, weil ${ABGESCHALTET_GRUND}`,
  });
  const { lauf, beleg } = mitZaehlenderMutation(context, { mutanten: ZWEI_ABGESCHALTET }, zusatz);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(beleg.grund.startsWith("Mutant überlebt: "), beleg.grund);
  assert.notEqual(pruefung(beleg, "mutation nach Test"), undefined);
});

test("steigt der Bau-Agent nach dem Widerspruch aus, hält der Lauf an und misst nicht neu", (context) => {
  const { lauf, beleg } = mitWiderspruch(context, { ...NAECHSTE_RUNDE, [BAU_NACH_WIDERSPRUCH]: PASST_NICHT });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(exitCodes(beleg, "mutation nach Bau"), [EXIT_ROT]);
});

test("ändert der Bau-Agent nach dem Widerspruch eine Datei außerhalb seines Bereichs, bleibt der Auftrag rot und der Lauf misst nicht neu", (context) => {
  const nach = { "bau-nach-nachrunde": { "src/text.js": "export function gross(text) {\n  return text.trim();\n}\n" }, [BAU_NACH_WIDERSPRUCH]: ABSATZ_MUTATION };
  const { lauf, beleg } = mitWiderspruch(context, { ...NAECHSTE_RUNDE, ...nach });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout + lauf.stderr, /✗ grenzen bau/);
  assert.deepEqual(exitCodes(beleg, "mutation nach Bau"), []);
});

test("steigt der Test-Agent trotz „Nötig“ mit „Auftrag passt nicht“ aus, hält der Lauf wie bisher an und gibt nichts zurück", (context) => {
  const { lauf, beleg } = mitWiderspruch(context, { "test-nachrunde-antwort": PASST_NICHT });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(rollen(beleg), ["test", "bau", "bau", "test"]);
});

const GEMISCHTE_MUTATION = [
  'import { readFileSync } from "node:fs";',
  'const getestet = readFileSync("test/rechnen.test.js", "utf8").includes("(7)");',
  `const toetbar = ${JSON.stringify(NEU_MUTANT)};`,
  `const offen = [toetbar, ${JSON.stringify(ZWEITER_MUTANT)}].filter((mutant) => (mutant === toetbar ? !getestet : !process.argv.includes(mutant)));`,
  `for (const mutant of offen) console.log(${JSON.stringify(MUTANT_UEBERLEBT)} + ": " + mutant);`,
  "process.exitCode = offen.length > 0 ? 1 : 0;",
  "",
].join("\n");

test("meldet der Bau-Agent einen tötbaren und einen gleichwertigen Mutanten als „Nötig“, tötet der Test-Agent den einen, widerspricht beim anderen und der Auftrag wird grün", (context) => {
  const gleichwertigerGrund = "die Division ändert bei keiner Eingabe das Ergebnis, weil der Wert nie gelesen wird";
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    bau: MIT_SIEBEN,
    nach: MARKE_RUECKGABE,
    "bau-nachrunde-antwort": { "Nötig: <Mutant>": `${NOETIG}\n${NOETIG_ZWEITER}`, "": "" },
    "test-nachrunde": { "test/rechnen.test.js": SIEBEN_TEST },
    "test-nachrunde-antwort": `${ABSATZ_MUTATION}\nWiderspruch: ${ZWEITER_MUTANT}, weil ${gleichwertigerGrund}`,
    [BAU_NACH_WIDERSPRUCH]: `Gleichwertig: ${ZWEITER_MUTANT}, weil ${gleichwertigerGrund}`,
  };
  const { repo, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: { ...MIT_MUTATION, "mutation.mjs": GEMISCHTE_MUTATION } });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(rollen(beleg), ["test", "bau", "bau", "test", "bau"]);
  assert.deepEqual(exitCodes(beleg, "mutation nach Bau"), [EXIT_ROT, 0]);
  assert.equal(runIn(repo, "git", ["show", "HEAD:test/rechnen.test.js"]).stdout, SIEBEN_TEST);
  assert.ok(runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout.includes(`Gleichwertig: ${ZWEITER_MUTANT}, weil ${gleichwertigerGrund}`));
});
