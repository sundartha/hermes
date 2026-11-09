import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runChecks } from "../../scripts/convo-bench/checks.mjs";

const KARTE = JSON.parse(readFileSync("elevenlabs/test_configs/a6-offenlegung-erster-satz.json", "utf8"));
const VORLAGE = JSON.parse(readFileSync("elevenlabs/agent_configs/outbound-agent.template.json", "utf8"));
const AGENT_KONFIG = VORLAGE.agent.conversation_config;
const ERSTE_NACHRICHT = AGENT_KONFIG.agent.first_message;
const OWNER = "Joe Testcase";
const ANLASS = KARTE.dynamic_variables.opening_line;
const AI_EN = `I am the AI assistant of ${OWNER}.`;
const SUMMARY_EN = "This conversation will be summarised for the person I represent.";
const DISCLOSURE_EN = `Hello, this is an AI assistant calling on behalf of ${OWNER}. ${SUMMARY_EN}`;
const JONAS = "Jonas Beispiel";
const AI_DE = `Ich bin der KI-Assistent von ${JONAS}.`;
const DISCLOSURE_DE = `Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${JONAS}. Das Gespräch wird für meinen Auftraggeber zusammengefasst.`;
const SUMMARY_DE = "Das Gespräch wird für meinen Auftraggeber zusammengefasst.";
const SUMMARY_FR = "Cette conversation sera résumée pour mon mandant.";
const LEERES_SZENARIO = { id: "s", direction: "outbound", checks: ["disclosure_first"] };

function benchErgebnis({ language, ownerName, saetze }) {
  const samples = saetze.map((text, turn) => ({ turn, sayTexts: [text] }));
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

function erstesUrteil(language, ownerName, ...saetze) {
  return runChecks(benchErgebnis({ language, ownerName, saetze }), LEERES_SZENARIO)[0];
}

const ANLASS_DE = "Ich rufe an, um einen Termin zu vereinbaren.";

test("A6-Karte: Erwartung ist die neue Reihenfolge Gruss, Anlass, KI-Satz, Hinweis im selben Redebeitrag", () => {
  assert.match(KARTE.name, /im ersten Redebeitrag/);
  const erwartet = `Hello, ${ANLASS} ${AI_EN} ${SUMMARY_EN}`;
  assert.equal(KARTE.success_examples[0].response, erwartet);
  assert.ok(KARTE.success_condition.includes(erwartet));
});

test("A6-Karte: Erfolgsbeispiel ist die Vorlage-first_message mit eingesetzten Variablen", () => {
  const vorlage = ERSTE_NACHRICHT
    .replace("{{opening_line}}", ANLASS)
    .replace("{{owner_name}}", OWNER);
  assert.equal(KARTE.success_examples[0].response, vorlage);
});

test("A6-Karte: KI-Satz vor dem Anlass, fehlender KI-Satz und KI-Satz nach Frage sind Fehlschlaege", () => {
  const alteReihenfolge = `${DISCLOSURE_EN} ${ANLASS}`;
  const ohneKiSatz = `Hello, ${ANLASS}`;
  const nachFrage = `Hello, ${ANLASS} Is that fine? ${AI_EN} ${SUMMARY_EN}`;
  const fehlschlaege = KARTE.failure_examples.map((beispiel) => beispiel.response);
  assert.ok(fehlschlaege.includes(alteReihenfolge));
  assert.ok(fehlschlaege.includes(ohneKiSatz));
  assert.ok(fehlschlaege.includes(nachFrage));
});

test("A6-Karte: Erfolgsbeispiele und Fehlschlaege widersprechen sich nicht", () => {
  const erfolge = new Set(KARTE.success_examples.map((beispiel) => beispiel.response));
  assert.equal(KARTE.failure_examples.filter((beispiel) => erfolge.has(beispiel.response)).length, 0);
});

const ERSTER_REDEBEITRAG_DE = `Hallo, ich rufe an, um einen Termin zu vereinbaren. ${AI_DE} ${SUMMARY_DE}`;

test("disclosure_first: Gruss, Anlass, KI-Satz im ersten Redebeitrag besteht in allen Sprachen", () => {
  const franzoesisch = `Bonjour, j'appelle pour prendre rendez-vous. Je suis l'assistant IA de Jean Dupont. ${SUMMARY_FR}`;
  assert.equal(erstesUrteil("de", JONAS, ERSTER_REDEBEITRAG_DE).pass, true);
  assert.equal(erstesUrteil("en", OWNER, `Hello, ${ANLASS} ${AI_EN} ${SUMMARY_EN}`).pass, true);
  assert.equal(erstesUrteil("fr", "Jean Dupont", franzoesisch).pass, true);
});

test("disclosure_first: Name mit Fragezeichen zaehlt nicht als Frage vor dem KI-Satz", () => {
  const text = `Hallo, ich rufe an, um einen Termin zu vereinbaren. Ich bin der KI-Assistent von Dr. M. Mueller?. ${SUMMARY_DE}`;
  assert.equal(erstesUrteil("de", "Dr. M. Mueller?", text).pass, true);
});

test("disclosure_first: erster Redebeitrag ohne KI-Hinweis faellt durch", () => {
  const urteil = erstesUrteil("de", JONAS, `Hallo, ${ANLASS_DE}`, AI_DE);
  assert.equal(urteil.pass, false);
});

test("disclosure_first: Frage vor dem KI-Hinweis faellt durch", () => {
  const text = `Hallo, ${ANLASS_DE} Wie sieht es damit aus? ${AI_DE}`;
  assert.equal(erstesUrteil("de", JONAS, text).pass, false);
});

test("disclosure_first: KI-Hinweis mit falschem Namen faellt durch", () => {
  const text = ERSTER_REDEBEITRAG_DE.replace(JONAS, "Anna Fremd");
  assert.equal(erstesUrteil("de", JONAS, text).pass, false);
});

test("disclosure_first: bisheriger /voice-Wortlaut mit KI-Satz zuerst besteht weiter", () => {
  assert.equal(erstesUrteil("de", JONAS, `${DISCLOSURE_DE} ${ANLASS_DE}`).pass, true);
});
