import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LOCALES, reasonFirstOpening } from "../../src/i18n/locales.js";
import { runChecks } from "../../scripts/convo-bench/checks.mjs";

const KARTE = JSON.parse(readFileSync("elevenlabs/test_configs/a6-offenlegung-erster-satz.json", "utf8"));
const VORLAGE = JSON.parse(readFileSync("elevenlabs/agent_configs/outbound-agent.template.json", "utf8"));
const OWNER = "Joe Testcase";
const ANLASS = KARTE.dynamic_variables.opening_line;
const LEERES_SZENARIO = { id: "s", direction: "outbound", checks: ["disclosure_first"] };

function benchErgebnis(language, ownerName, ersterSay, folgeSays = []) {
  const samples = [ersterSay, ...folgeSays].map((text, turn) => ({ turn, sayTexts: [text] }));
  return {
    call: { direction: "outbound", language },
    ownerName,
    transcript: [],
    agentSamples: samples,
    endedVia: "turn_cap",
    turnCount: samples.length,
    metricsParsed: [],
    storeSnapshot: { actionItems: [], calendarNewEvents: [] },
  };
}

function erstesUrteil(language, ownerName, ersterSay, folgeSays) {
  return runChecks(benchErgebnis(language, ownerName, ersterSay, folgeSays), LEERES_SZENARIO)[0];
}

const ANLASS_DE = "Ich rufe an, um einen Termin zu vereinbaren.";
const ANLASS_FR = "J'appelle pour prendre rendez-vous.";

test("A6-Karte: Erwartung ist die neue Reihenfolge Gruss, Anlass, KI-Satz, Hinweis im selben Redebeitrag", () => {
  assert.match(KARTE.name, /im ersten Redebeitrag/);
  const erwartet = reasonFirstOpening("en", OWNER, ANLASS).text;
  assert.equal(KARTE.success_examples[0].response, erwartet);
  assert.ok(KARTE.success_condition.includes(erwartet));
});

test("A6-Karte: Erfolgsbeispiel ist die Vorlage-first_message mit eingesetzten Variablen", () => {
  const vorlage = VORLAGE.agent.conversation_config.agent.first_message
    .replace("{{opening_line}}", ANLASS)
    .replace("{{owner_name}}", OWNER);
  assert.equal(KARTE.success_examples[0].response, vorlage);
});

test("A6-Karte: KI-Satz vor dem Anlass, fehlender KI-Satz und KI-Satz nach Frage sind Fehlschlaege", () => {
  const alteReihenfolge = `${LOCALES.en.disclosure(OWNER)} ${ANLASS}`;
  const ohneKiSatz = `Hello, ${ANLASS}`;
  const nachFrage = `Hello, ${ANLASS} Is that fine? ${LOCALES.en.aiSentence(OWNER)} ${LOCALES.en.summaryNotice}`;
  const fehlschlaege = KARTE.failure_examples.map((beispiel) => beispiel.response);
  assert.ok(fehlschlaege.includes(alteReihenfolge));
  assert.ok(fehlschlaege.includes(ohneKiSatz));
  assert.ok(fehlschlaege.includes(nachFrage));
});

test("A6-Karte: Erfolgsbeispiele und Fehlschlaege widersprechen sich nicht", () => {
  const erfolge = new Set(KARTE.success_examples.map((beispiel) => beispiel.response));
  assert.equal(KARTE.failure_examples.filter((beispiel) => erfolge.has(beispiel.response)).length, 0);
});

test("disclosure_first: Gruss, Anlass, KI-Satz im ersten Redebeitrag besteht in allen Sprachen", () => {
  assert.equal(erstesUrteil("de", "Jonas Beispiel", reasonFirstOpening("de", "Jonas Beispiel", ANLASS_DE).text).pass, true);
  assert.equal(erstesUrteil("en", OWNER, reasonFirstOpening("en", OWNER, ANLASS).text).pass, true);
  assert.equal(erstesUrteil("fr", "Jean Dupont", reasonFirstOpening("fr", "Jean Dupont", ANLASS_FR).text).pass, true);
});

test("disclosure_first: Name mit Fragezeichen zaehlt nicht als Frage vor dem KI-Satz", () => {
  const text = reasonFirstOpening("de", "Dr. M. Mueller?", ANLASS_DE).text;
  assert.equal(erstesUrteil("de", "Dr. M. Mueller?", text).pass, true);
});

test("disclosure_first: erster Redebeitrag ohne KI-Hinweis faellt durch", () => {
  const urteil = erstesUrteil("de", "Jonas Beispiel", `Hallo, ${ANLASS_DE}`, [LOCALES.de.aiSentence("Jonas Beispiel")]);
  assert.equal(urteil.pass, false);
});

test("disclosure_first: Frage vor dem KI-Hinweis faellt durch", () => {
  const text = `Hallo, ${ANLASS_DE} Wie sieht es damit aus? ${LOCALES.de.aiSentence("Jonas Beispiel")}`;
  assert.equal(erstesUrteil("de", "Jonas Beispiel", text).pass, false);
});

test("disclosure_first: KI-Hinweis mit falschem Namen faellt durch", () => {
  const text = reasonFirstOpening("de", "Anna Fremd", ANLASS_DE).text;
  assert.equal(erstesUrteil("de", "Jonas Beispiel", text).pass, false);
});

test("disclosure_first: bisheriger /voice-Wortlaut mit KI-Satz zuerst besteht weiter", () => {
  const text = `${LOCALES.de.disclosure("Jonas Beispiel")} ${ANLASS_DE}`;
  assert.equal(erstesUrteil("de", "Jonas Beispiel", text).pass, true);
});
