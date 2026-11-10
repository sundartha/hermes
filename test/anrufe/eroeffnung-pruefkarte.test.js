import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { runChecks } from "../../scripts/convo-bench/checks.mjs";
import { seedCall, seedState, tempDataDir } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/store/defaults.js";

const KARTE = JSON.parse(readFileSync("elevenlabs/test_configs/a6-offenlegung-erster-satz.json", "utf8"));
const VORLAGE = JSON.parse(readFileSync("elevenlabs/agent_configs/outbound-agent.template.json", "utf8"));
const AGENT_KONFIG = VORLAGE.agent.conversation_config;
const ERSTE_NACHRICHT = AGENT_KONFIG.agent.first_message;
const OWNER = "Joe Testcase";
const ANLASS = KARTE.dynamic_variables.opening_line;
const EROEFFNUNG_PLATZHALTER = "{{eroeffnung}}";
const KI_HINWEIS_EN = `I am Hermes, the AI assistant of ${OWNER}`;
const ZUSAMMENFASSUNG_EN = "and I will summarise this conversation for Joe.";
const DISCLOSURE_EN = `Hello, this is an AI assistant calling on behalf of ${OWNER}. This conversation will be summarised for the person I represent.`;
const JONAS = "Jonas Beispiel";
const KI_HINWEIS_DE = `ich bin Hermes, der KI-Assistent von ${JONAS}`;
const ZUSAMMENFASSUNG_DE = "und ich fasse das Gespräch für Jonas zusammen.";
const DISCLOSURE_DE = `Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${JONAS}. Das Gespräch wird für meinen Auftraggeber zusammengefasst.`;
const KI_HINWEIS_FR = "je suis Hermes, l'assistant IA de Jean Dupont";
const ZUSAMMENFASSUNG_FR = "et je résume cette conversation pour Jean.";
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
const ANLASS_DE_OHNE_PUNKT = "ich rufe an, um einen Termin zu vereinbaren";

let openingText;
before(async () => {
  process.env.DATA_DIR = tempDataDir(
    seedState({
      calls: [],
      tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: OWNER }],
    }),
  );
  ({ openingText } = await import("../../src/claude.js"));
});

const KARTEN_SATZ_FRAGE = "Hello, I am calling to book a men's haircut appointment for Joe Testcase – Is that fine? ";

function satzAusDerQuelle() {
  return openingText(seedCall({ tenantId: BOOTSTRAP_TENANT_ID, direction: "outbound", language: "en", goal: ANLASS }));
}

test("A6-Karte: die Erwartung ist der Satz aus der Quelle, Reihenfolge Gruss, Anlass, KI-Hinweis, Zusammenfassung im selben Redebeitrag", () => {
  assert.match(KARTE.name, /im ersten Redebeitrag/);
  const erwartet = satzAusDerQuelle();
  assert.ok(erwartet.startsWith(`Hello, ${ANLASS.replace(/\.$/, "")} – ${KI_HINWEIS_EN}, ${ZUSAMMENFASSUNG_EN}`), erwartet);
  assert.equal(KARTE.success_examples[0].response, erwartet);
  assert.equal(KARTE.dynamic_variables.eroeffnung, erwartet);
  assert.ok(KARTE.success_condition.includes(erwartet));
});

test("A6-Karte: Erfolgsbeispiel ist die Vorlage-first_message mit eingesetzter Variable", () => {
  const vorlage = ERSTE_NACHRICHT.replace(EROEFFNUNG_PLATZHALTER, KARTE.dynamic_variables.eroeffnung);
  assert.equal(KARTE.success_examples[0].response, vorlage);
});

test("Vorlage: first_message und alle Sprach-Presets tragen nur die Variable eroeffnung, keinen Satztext", () => {
  assert.equal(ERSTE_NACHRICHT, EROEFFNUNG_PLATZHALTER);
  const presetSaetze = Object.values(AGENT_KONFIG.language_presets).map((preset) => preset?.overrides?.agent?.first_message ?? null);
  assert.deepEqual(presetSaetze.filter((satz) => satz !== null), [EROEFFNUNG_PLATZHALTER, EROEFFNUNG_PLATZHALTER]);
});

test("A6-Karte: KI-Satz vor dem Anlass, fehlender KI-Satz und KI-Satz nach Frage sind Fehlschlaege", () => {
  const erfolg = satzAusDerQuelle();
  const anlassTeil = erfolg.slice(0, erfolg.indexOf(" – "));
  const ohneKiSatz = `${anlassTeil}.`;
  const nachFrage = `${KARTEN_SATZ_FRAGE}${erfolg.slice(erfolg.indexOf(" – ") + 3)}`;
  const fehlschlaege = KARTE.failure_examples.map((beispiel) => beispiel.response);
  assert.ok(fehlschlaege.includes(ohneKiSatz));
  assert.ok(fehlschlaege.includes(nachFrage));
  assert.ok(fehlschlaege.includes(`${DISCLOSURE_EN} ${ANLASS}`));
});

test("A6-Karte: Erfolgsbeispiele und Fehlschlaege widersprechen sich nicht", () => {
  const erfolge = new Set(KARTE.success_examples.map((beispiel) => beispiel.response));
  assert.equal(KARTE.failure_examples.filter((beispiel) => erfolge.has(beispiel.response)).length, 0);
});

const ERSTER_REDEBEITRAG_DE = `Hallo, ${ANLASS_DE_OHNE_PUNKT} – ${KI_HINWEIS_DE}, ${ZUSAMMENFASSUNG_DE}`;

test("disclosure_first: Gruss, Anlass, KI-Satz im ersten Redebeitrag besteht in allen Sprachen", () => {
  const franzoesisch = `Bonjour, j'appelle pour prendre rendez-vous – ${KI_HINWEIS_FR}, ${ZUSAMMENFASSUNG_FR}`;
  assert.equal(erstesUrteil("de", JONAS, ERSTER_REDEBEITRAG_DE).pass, true);
  assert.equal(erstesUrteil("en", OWNER, satzAusDerQuelle()).pass, true);
  assert.equal(erstesUrteil("fr", "Jean Dupont", franzoesisch).pass, true);
});

test("disclosure_first: Name mit Fragezeichen zaehlt nicht als Frage vor dem KI-Satz", () => {
  const text = `Hallo, ${ANLASS_DE_OHNE_PUNKT} – ich bin Hermes, der KI-Assistent von Dr. M. Mueller?, ${ZUSAMMENFASSUNG_DE}`;
  assert.equal(erstesUrteil("de", "Dr. M. Mueller?", text).pass, true);
});

test("disclosure_first: erster Redebeitrag ohne KI-Hinweis faellt durch", () => {
  const urteil = erstesUrteil("de", JONAS, `Hallo, ${ANLASS_DE}`, KI_HINWEIS_DE);
  assert.equal(urteil.pass, false);
});

test("disclosure_first: Frage vor dem KI-Hinweis faellt durch", () => {
  const text = `Hallo, ${ANLASS_DE_OHNE_PUNKT} – wie sieht es damit aus? ${KI_HINWEIS_DE}, ${ZUSAMMENFASSUNG_DE}`;
  assert.equal(erstesUrteil("de", JONAS, text).pass, false);
});

test("disclosure_first: KI-Hinweis mit falschem Namen faellt durch", () => {
  const text = ERSTER_REDEBEITRAG_DE.replace(JONAS, "Anna Fremd");
  assert.equal(erstesUrteil("de", JONAS, text).pass, false);
});

test("disclosure_first: bisheriger /voice-Wortlaut mit KI-Satz zuerst besteht weiter", () => {
  assert.equal(erstesUrteil("de", JONAS, `${DISCLOSURE_DE} ${ANLASS_DE}`).pass, true);
});
