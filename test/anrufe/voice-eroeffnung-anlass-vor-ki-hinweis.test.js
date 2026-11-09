import { test } from "node:test";
import assert from "node:assert/strict";
import { runOutbound } from "../_outbound-harness.js";

const HTTP_OK = 200;

const ERWARTET = Object.freeze({
  de: Object.freeze({
    anlass: "Ich rufe an, um einen Termin zur Bremsenprüfung zu vereinbaren.",
    text:
      "Hallo, ich rufe an, um einen Termin zur Bremsenprüfung zu vereinbaren. Ich bin der KI-Assistent von Jonas Beispiel. Das Gespräch wird für meinen Auftraggeber zusammengefasst.",
  }),
  en: Object.freeze({
    anlass: "I am calling to arrange a brake inspection appointment.",
    text:
      "Hello, I am calling to arrange a brake inspection appointment. I am the AI assistant of Jonas Beispiel. This conversation will be summarised for the person I represent.",
  }),
  fr: Object.freeze({
    anlass: "J'appelle pour prendre rendez-vous pour un contrôle des freins.",
    text:
      "Bonjour, j'appelle pour prendre rendez-vous pour un contrôle des freins. Je suis l'assistant IA de Jonas Beispiel. Cette conversation sera résumée pour mon mandant.",
  }),
});
const KI_HINWEIS_DE = "Ich bin der KI-Assistent von Jonas Beispiel.";
const RUECKFALL_DE =
  "Hallo, ich rufe an, um ein kurzes Anliegen zu klären. Ich bin der KI-Assistent von Jonas Beispiel. Das Gespräch wird für meinen Auftraggeber zusammengefasst.";
const GOAL_FRAGE = "Hast du morgen um 15 Uhr Zeit für eine Runde Tennis?";

const ENTITAETEN = [
  ["&apos;", "'"],
  ["&#39;", "'"],
  ["&quot;", '"'],
  ["&amp;", "&"],
];

function ersterSay(xml) {
  const treffer = /<Say[^>]*>([\s\S]*?)<\/Say>/.exec(xml);
  assert.ok(treffer, `kein Say im Dokument: ${xml}`);
  return ENTITAETEN.reduce((text, [von, nach]) => text.replaceAll(von, nach), treffer[1]);
}

function zaehle(text, teil) {
  return text.split(teil).length - 1;
}

for (const language of ["de", "en", "fr"]) {
  test(`V1 /voice/outbound ${language}: erster Redebeitrag nennt Gruss, Anlass, dann den KI-Hinweis mit Namen`, async () => {
    const { body, status } = await runOutbound({ call: { language, goal: ERWARTET[language].anlass } });
    assert.equal(status, HTTP_OK);
    assert.deepEqual(ersterSay(body), ERWARTET[language].text);
  });
}

test("V2 /voice/outbound: ein Auftrag, der selbst eine Frage ist, wird nicht als Anlass gesprochen, der feste Rueckfall steht davor", async () => {
  const { body } = await runOutbound({ call: { language: "de", goal: GOAL_FRAGE } });
  const text = ersterSay(body);
  assert.deepEqual(text, RUECKFALL_DE);
  assert.ok(!text.includes("Tennis"));
  assert.ok(!text.trim().endsWith("?"));
});

test("V2 /voice/outbound: ein Auftrag ohne Ich-Form wird als Anlass mit Bruecke gesprochen, nicht roh", async () => {
  const { body } = await runOutbound({ call: { language: "de", goal: "Termin zur Bremsenprüfung vereinbaren" } });
  const text = ersterSay(body);
  assert.ok(text.startsWith("Hallo, es geht um Folgendes: Termin zur Bremsenprüfung vereinbaren."), text);
  assert.ok(text.indexOf("Termin zur Bremsenprüfung") < text.indexOf("KI-Assistent"), text);
});

test("V3 /voice/outbound: der KI-Hinweis steht genau einmal im ersten Redebeitrag und nach dem Anlass", async () => {
  const { body } = await runOutbound({ call: { language: "de", goal: ERWARTET.de.anlass } });
  const text = ersterSay(body);
  assert.equal(zaehle(text, KI_HINWEIS_DE), 1);
  assert.ok(text.indexOf(ERWARTET.de.anlass.slice(1)) < text.indexOf(KI_HINWEIS_DE), text);
  assert.ok(text.startsWith("Hallo,"), text);
});

test("V3 /voice/outbound: bei leerem Auftrag steht der KI-Hinweis trotzdem im ersten Redebeitrag", async () => {
  const { body } = await runOutbound({ call: { language: "de", goal: "" } });
  const text = ersterSay(body);
  assert.equal(zaehle(text, "KI-Assistent"), 1);
  assert.deepEqual(text, RUECKFALL_DE);
});

test("V4 /voice/outbound an die eigene Nummer des Auftraggebers: Eroeffnung bleibt byte-gleich zum Stand vor der Umstellung", async () => {
  const { body } = await runOutbound({ call: { language: "de", goal: ERWARTET.de.anlass, calleeIsOwner: true } });
  assert.equal(
    ersterSay(body),
    "Hallo Jonas, hier ist dein KI-Assistent. Ich rufe an, um einen Termin zur Bremsenprüfung zu vereinbaren.",
  );
});

const GOAL_FRAGE_MITTEN =
  "Bitte einen Termin zur Bremsenprüfung beim Autohaus Schneider in der Hauptstraße vereinbaren, passt das? Danach bitte kurz zurückrufen";

test("V2 /voice/outbound: ein Fragezeichen mitten im Auftrag macht ihn nicht zur Frage, er wird auf die Wortgrenze gekappt", async () => {
  const { body } = await runOutbound({ call: { language: "de", goal: GOAL_FRAGE_MITTEN } });
  assert.deepEqual(ersterSay(body), "Hallo, es geht um Folgendes: Bitte einen Termin zur Bremsenprüfung beim Autohaus Schneider in der. Ich bin der KI-Assistent von Jonas Beispiel. Das Gespräch wird für meinen Auftraggeber zusammengefasst.");
});

test("V2 /voice/outbound: eine Frage mit Leerraum dahinter am Ende des Auftrags ergibt den festen Rueckfall", async () => {
  const { body } = await runOutbound({ call: { language: "de", goal: `${GOAL_FRAGE}  ` } });
  assert.deepEqual(ersterSay(body), RUECKFALL_DE);
});

test("V3 /voice/outbound: ohne gesetzten Auftrag steht der feste Rueckfall mit dem KI-Hinweis im ersten Redebeitrag", async () => {
  const { body } = await runOutbound({ call: { language: "de", goal: undefined } });
  assert.deepEqual(ersterSay(body), RUECKFALL_DE);
});
