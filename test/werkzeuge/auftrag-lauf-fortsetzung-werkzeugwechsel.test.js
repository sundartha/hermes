import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MIT_MUTATION, MIT_SIEBEN, NEU_MUTANT, PASST_NICHT, ROTER_TEST, funktion, namen, pruefung } from "./auftrag-lauf-hilfen.js";
import { GRUND_VERWORFEN, aufgeraeumt, gesichert, rollen, zeigt } from "./auftrag-lauf-fortsetzung-hilfen.js";
import { BASIS, EXIT_ROT, UMBAU, starte, starteNochmal } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const KONFIGURATION = "stryker.config.json";
const WERKZEUG_KAPUTT = "Abbruch: Erstlauf rot: test/rechnen.test.js › verdoppelt";
const ERSATZ_MUTATION = [
  'import { existsSync, readFileSync } from "node:fs";',
  `const datei = ${JSON.stringify(KONFIGURATION)};`,
  'const konfiguration = existsSync(datei) ? readFileSync(datei, "utf8") : "";',
  'const kaputt = konfiguration === "";',
  'const streng = konfiguration.includes("streng");',
  `if (kaputt) console.error(${JSON.stringify(WERKZEUG_KAPUTT)});`,
  `else if (streng) console.log(${JSON.stringify(`Verstoß: Mutant überlebt: ${NEU_MUTANT}`)});`,
  'else console.log("grün: keiner überlebt");',
  "process.exitCode = kaputt ? 2 : Number(streng);",
  "",
].join("\n");
const DREHBUCH = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_SIEBEN };
const NEUES_WERKZEUG = '{"mutate":["src/**/*.js"]}\n';
const STRENGES_WERKZEUG = '{"mutate":["src/**/*.js"],"streng":true}\n';
const OHNE_PRUEFERGEBNIS = /Fortsetzung auf gesichertem Stand \(Werkzeugstand und Basis neu: nur die Arbeit der Agenten bis zur Stufe bau gilt weiter.*kein Prüfergebnis der Sicherung gilt, jede Prüfstufe läuft mit dem neuen Stand neu\)/;
const ERNEUTE_PRUEFSTUFEN = ["rot", "zwischenstand", "abnahme", "lint", "betroffene tests", "mutation"];

function agentenStarts(werkzeug) {
  const protokoll = join(werkzeug, "starts.jsonl");
  if (!existsSync(protokoll)) return [];
  const rollen = readFileSync(protokoll, "utf8").split("\n").filter(Boolean).map((zeile) => JSON.parse(zeile).rolle);
  return rollen.filter((rolle) => rolle === "test" || rolle === "bau");
}

function mitKaputtemWerkzeug(context) {
  const erster = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, dateien: { ...MIT_MUTATION, "mutation.mjs": ERSATZ_MUTATION } });
  assert.equal(erster.lauf.status, EXIT_ROT, erster.lauf.stdout + erster.lauf.stderr);
  assert.ok(existsSync(gesichert(erster.repo, "json")), "nach dem Werkzeugabbruch fehlt der gesicherte Stand");
  return erster;
}

function werkzeugGewechselt(erster, inhalt) {
  aufgeraeumt(erster);
  appendFileSync(join(erster.repo, ".git/info/exclude"), `${KONFIGURATION}\n`);
  writeFileSync(join(erster.repo, KONFIGURATION), inhalt);
  runIn(erster.repo, "git", ["commit", "-q", "--allow-empty", "-m", "Werkzeug-Merge"]);
  return runIn(erster.repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
}

function phaseGeaendert({ werkzeug }, aendern) {
  const datei = join(werkzeug, "phase.json");
  writeFileSync(datei, JSON.stringify(aendern(JSON.parse(readFileSync(datei, "utf8")))));
}

function verworfenUndNeuGebaut(erster, grund) {
  const zweiter = starteNochmal(erster, DREHBUCH);
  assert.match(zweiter.lauf.stderr, GRUND_VERWORFEN, zweiter.lauf.stdout + zweiter.lauf.stderr);
  assert.equal(GRUND_VERWORFEN.exec(zweiter.lauf.stderr)[1], grund);
  assert.equal(zweiter.lauf.status, 0, zweiter.lauf.stdout + zweiter.lauf.stderr);
  assert.deepEqual(rollen(zweiter.beleg), ["test", "bau"]);
  assert.equal(zweiter.beleg.fortgesetzt, false);
}

test("bricht ein Werkzeug nach grünem Bau ab, bleibt die Arbeit beider Agenten gesichert, mit Stufe, Stand und Herkunft, und die Wiederholung ruft keinen Agenten neu", (context) => {
  const { repo, werkzeug, lauf } = mitKaputtemWerkzeug(context);
  const stand = JSON.parse(readFileSync(gesichert(repo, "json"), "utf8"));
  assert.equal(stand.stufe, "bau");
  assert.equal(stand.herkunft.stufe, "bau");
  assert.match(stand.herkunft.commit, /^[0-9a-f]{40}$/);
  assert.match(stand.herkunft.baum, /^[0-9a-f]{40}$/);
  assert.deepEqual(stand.herkunft.agenten.map(({ rolle }) => rolle), ["test", "bau"]);
  assert.equal(stand.ueberlebende, null);
  assert.deepEqual(agentenStarts(werkzeug), ["test", "bau"]);
  assert.match(lauf.stdout, /Entscheidung nötig/);
});

test("nach einem Werkzeugwechsel setzt lauf einen schon grünen Bau ohne Agenten fort, und jede Prüfstufe läuft mit dem neuen Werkzeug neu", (context) => {
  const erster = mitKaputtemWerkzeug(context);
  const basis = werkzeugGewechselt(erster, NEUES_WERKZEUG);
  const { lauf, beleg, repo, werkzeug } = starteNochmal(erster, DREHBUCH);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, OHNE_PRUEFERGEBNIS);
  assert.deepEqual(agentenStarts(werkzeug), ["test", "bau"]);
  assert.deepEqual(rollen(beleg), []);
  const gelaufen = namen(beleg);
  assert.deepEqual(ERNEUTE_PRUEFSTUFEN.filter((name) => !gelaufen.includes(name)), []);
  assert.equal(pruefung(beleg, "rot"), 0);
  assert.equal(pruefung(beleg, "mutation"), 0);
  const mutation = beleg.pruefungen.find(({ name }) => name === "mutation");
  const befehl = mutation.befehl.split(" ");
  assert.equal(befehl[befehl.indexOf("--basis") + 1], basis);
  assert.equal(zeigt(repo, "src/rechnen.js"), MIT_SIEBEN["src/rechnen.js"]);
  assert.equal(zeigt(repo, "test/rechnen.test.js"), ROTER_TEST);
  assert.ok(!existsSync(gesichert(repo, "json")), "der Stand bleibt nach dem Commit liegen");
});

test("fällt nach dem Werkzeugwechsel eine Prüfstufe rot aus, ist der Auftrag rot, obwohl die Agentenarbeit gesichert war", (context) => {
  const erster = mitKaputtemWerkzeug(context);
  const basis = werkzeugGewechselt(erster, STRENGES_WERKZEUG);
  const { lauf, beleg, repo } = starteNochmal(erster, { ...DREHBUCH, "bau-nachrunde-antwort": PASST_NICHT });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, OHNE_PRUEFERGEBNIS);
  assert.equal(beleg.ergebnis, "rot");
  assert.equal(pruefung(beleg, "mutation"), 1);
  assert.ok(!rollen(beleg).includes("test"), rollen(beleg).join(", "));
  assert.equal(runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim(), basis);
});

test("ändert sich nach einem Werkzeugwechsel der Auftrag, verfällt die Sicherung und beide Agenten bauen neu", (context) => {
  const erster = mitKaputtemWerkzeug(context);
  werkzeugGewechselt(erster, NEUES_WERKZEUG);
  phaseGeaendert(erster, (phase) => ({ ...phase, auftraege: [{ ...phase.auftraege[0], ziel: "Verdopple Zahlen und Brüche" }] }));
  verworfenUndNeuGebaut(erster, "Auftrag oder Phase haben sich geändert");
});

test("ändert sich nach einem Werkzeugwechsel die Phase, verfällt die Sicherung und beide Agenten bauen neu", (context) => {
  const erster = mitKaputtemWerkzeug(context);
  werkzeugGewechselt(erster, NEUES_WERKZEUG);
  phaseGeaendert(erster, (phase) => ({ ...phase, entwurf: { "src/rechnen.js": "Anderer Entwurf." } }));
  verworfenUndNeuGebaut(erster, "Auftrag oder Phase haben sich geändert");
});

test("ein Vorlauf mit kaputtem Testwerkzeug bricht lauf vor dem ersten Agenten ab und nennt die Stufe", (context) => {
  const paket = JSON.parse(BASIS["package.json"]);
  const kaputt = { ...paket, scripts: { ...paket.scripts, test: "node -e \"throw new Error('Testläufer kaputt')\"" } };
  const bereichstest = 'import { verdopple } from "../src/rechnen.js";\nverdopple(1);\n';
  const dateien = { "package.json": JSON.stringify(kaputt), "test/rechnen-alt.test.js": bereichstest };
  const { lauf, werkzeug, repo, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: DREHBUCH, dateien });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /Vorlauf rot in der Stufe „Tests im Bereich auf dem festen Stand“ \(Exit 1\); lauf bricht vor dem ersten Agenten ab/);
  assert.match(lauf.stderr, /test\/rechnen-alt\.test\.js/);
  assert.match(lauf.stderr, /Testläufer kaputt/);
  assert.deepEqual(agentenStarts(werkzeug), []);
  assert.equal(runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim(), basis);
});

test("ein vorhandener Abnahmetest außerhalb der Reichweite des Bereichs läuft im Vorlauf mit; ist er rot, startet kein Agent", (context) => {
  const auftrag = { ...UMBAU, bereich: "src/rechnen.js", erwarteteDateien: ["src/rechnen.js"], vorbild: "src/rechnen.js" };
  const roterAbnahmetest = 'import assert from "node:assert/strict";\nimport { test } from "node:test";\ntest("auf der Basis rot", () => assert.fail("rot auf dem festen Stand"));\n';
  const { lauf, werkzeug } = starte(context, { auftrag, drehbuch: DREHBUCH, dateien: { "test/text.test.js": roterAbnahmetest } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /Vorlauf: 1 Testdateien im Bereich laufen auf dem festen Stand: test\/text\.test\.js\n/);
  assert.match(lauf.stderr, /Vorlauf rot in der Stufe „Tests im Bereich auf dem festen Stand“/);
  assert.deepEqual(agentenStarts(werkzeug), []);
});
