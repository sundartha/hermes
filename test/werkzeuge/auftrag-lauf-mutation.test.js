import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ABSATZ_MUTATION, ehrlicheNachrunde, funktion, GLEICHWERTIG_MIT_GRUND, MIT_MUTATION, MIT_SIEBEN, mitSieben, NEU_MUTANT, NOETIG, NOETIG_GRUND, pruefeGesichert, pruefung, ROTER_TEST, SIEBEN_TEST } from "./auftrag-lauf-hilfen.js";
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
