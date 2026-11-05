import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MIT_SIEBEN, ROTER_TEST, funktion, namen, pruefung } from "./auftrag-lauf-hilfen.js";
import { GRUND_VERWORFEN, aufgeraeumt, gesichert, rollen, zeigt } from "./auftrag-lauf-fortsetzung-hilfen.js";
import { EXIT_ROT, starte, starteNochmal } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const KONFIGURATION = "stryker.config.json";
const AGENT_KAPUTT = { text: "API Error: 400 invalid_request_error" };
const DREHBUCH = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_SIEBEN };
const NEUES_WERKZEUG = '{"mutate":["src/**/*.js"]}\n';
const OHNE_PRUEFERGEBNIS = /Fortsetzung auf gesichertem Stand \(Werkzeugstand und Basis neu: nur die Arbeit der Agenten bis zur Stufe abnahme gilt weiter.*kein Prüfergebnis der Sicherung gilt, jede Prüfstufe läuft mit dem neuen Stand neu\)/;
const ERNEUTE_PRUEFSTUFEN = ["rot", "zwischenstand", "abnahme", "betroffene tests"];

function agentenStarts(werkzeug) {
  const protokoll = join(werkzeug, "starts.jsonl");
  if (!existsSync(protokoll)) return [];
  const rollen = readFileSync(protokoll, "utf8").split("\n").filter(Boolean).map((zeile) => JSON.parse(zeile).rolle);
  return rollen.filter((rolle) => rolle === "test" || rolle === "bau");
}

function mitKaputtemWerkzeug(context) {
  const drehbuch = { ...DREHBUCH, "bau-ausfall": [AGENT_KAPUTT, AGENT_KAPUTT] };
  const erster = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
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

test("bricht der Bau-Agent als Werkzeug ab, bleibt die Arbeit des Test-Agenten gesichert, mit Stufe, Stand und Herkunft, und die Wiederholung ruft den Test-Agenten nicht neu", (context) => {
  const { repo, werkzeug, lauf } = mitKaputtemWerkzeug(context);
  const stand = JSON.parse(readFileSync(gesichert(repo, "json"), "utf8"));
  assert.equal(stand.stufe, "abnahme");
  assert.equal(stand.herkunft.stufe, "abnahme");
  assert.match(stand.herkunft.commit, /^[0-9a-f]{40}$/);
  assert.match(stand.herkunft.baum, /^[0-9a-f]{40}$/);
  assert.deepEqual(stand.herkunft.agenten.map(({ rolle }) => rolle), ["test"]);
  assert.deepEqual(agentenStarts(werkzeug), ["test", "bau", "bau"]);
  assert.match(lauf.stdout, /Entscheidung nötig/);
});

test("nach einem Werkzeugwechsel setzt lauf einen schon grünen Abnahmetest ohne Test-Agenten fort, und jede Prüfstufe läuft mit dem neuen Werkzeug neu", (context) => {
  const erster = mitKaputtemWerkzeug(context);
  werkzeugGewechselt(erster, NEUES_WERKZEUG);
  const { lauf, beleg, repo, werkzeug } = starteNochmal(erster, DREHBUCH);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, OHNE_PRUEFERGEBNIS);
  assert.deepEqual(agentenStarts(werkzeug), ["test", "bau", "bau", "bau"]);
  assert.deepEqual(rollen(beleg), ["bau"]);
  const gelaufen = namen(beleg);
  assert.deepEqual(ERNEUTE_PRUEFSTUFEN.filter((name) => !gelaufen.includes(name)), []);
  assert.equal(pruefung(beleg, "rot"), 0);
  assert.equal(zeigt(repo, "src/rechnen.js"), MIT_SIEBEN["src/rechnen.js"]);
  assert.equal(zeigt(repo, "test/rechnen.test.js"), ROTER_TEST);
  assert.ok(!existsSync(gesichert(repo, "json")), "der Stand bleibt nach dem Commit liegen");
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
