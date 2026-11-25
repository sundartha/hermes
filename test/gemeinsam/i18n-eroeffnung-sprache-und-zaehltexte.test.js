import assert from "node:assert/strict";
import { test } from "node:test";

import {
  besitzerEroeffnung,
  besitzerFrage,
  drittEroeffnung,
  kiHinweisKernFor,
  kiHinweisRahmenFor,
} from "../../src/i18n/eroeffnung.js";
import { MCP_TEXTS } from "../../src/i18n/mcp-texts.js";

const UNBEKANNT = "xx";
const MELDUNG = /^Unbekannte Sprache: xx$/;

const AUFRUFE_MIT_UNBEKANNTER_SPRACHE = [
  ["kiHinweisKernFor", () => kiHinweisKernFor(UNBEKANNT)],
  ["kiHinweisRahmenFor", () => kiHinweisRahmenFor(UNBEKANNT)],
  ["besitzerFrage", () => besitzerFrage(UNBEKANNT)],
  ["besitzerEroeffnung", () => besitzerEroeffnung({ language: UNBEKANNT, firstName: "Anna" })],
  [
    "drittEroeffnung",
    () => drittEroeffnung({ language: UNBEKANNT, ownerName: "Anna", firstName: "Ben", reason: "Termin" }),
  ],
];

for (const [name, aufruf] of AUFRUFE_MIT_UNBEKANNTER_SPRACHE) {
  test(`${name}: eine unbekannte Sprache bricht mit TypeError und benannter Sprache ab`, () => {
    assert.throws(aufruf, (fehler) => fehler instanceof TypeError && MELDUNG.test(fehler.message));
  });
}

test("besitzerEroeffnung: ohne Vornamen bleibt die Eroeffnung leer, auch bei unbekannter Sprache", () => {
  assert.equal(besitzerEroeffnung({ language: UNBEKANNT, firstName: "" }), "");
});

const RAHMEN = [
  ["de", "ich bin Hermes, der KI-Assistent von ", ""],
  ["en", "I am Hermes, the AI assistant of ", ""],
  ["fr", "je suis Hermes, l'assistant IA de ", ""],
];

for (const [sprache, pre, post] of RAHMEN) {
  test(`kiHinweisRahmenFor(${sprache}): Text vor und nach dem Namen`, () => {
    assert.deepEqual(kiHinweisRahmenFor(sprache), { pre, post });
  });
}

const ANGABEN = [
  ["de", 1, "1 Angabe an den Anruf uebergeben."],
  ["de", 2, "2 Angaben an den Anruf uebergeben."],
  ["en", 1, "1 detail passed on to the call."],
  ["en", 2, "2 details passed on to the call."],
  ["fr", 1, "1 information transmise à l'appel."],
  ["fr", 2, "2 informations transmises à l'appel."],
];

for (const [sprache, anzahl, erwartet] of ANGABEN) {
  test(`consultAnswerAccepted(${sprache}, ${anzahl}): Angaben im Singular oder Plural`, () => {
    assert.equal(MCP_TEXTS[sprache].consultAnswerAccepted(anzahl), erwartet);
  });
}

const NUTZUNG = [
  ["de", "Monatsnutzung: 42 % des Minuten-Kontingents"],
  ["en", "Monthly usage: 42% of your included minutes"],
  ["fr", "Utilisation mensuelle : 42 % des minutes incluses"],
];

for (const [sprache, erwartet] of NUTZUNG) {
  test(`planUsage(${sprache}): Prozentwert im Text`, () => {
    assert.equal(MCP_TEXTS[sprache].agentStatus.planUsage(42), erwartet);
  });
}

const ERLAUBT = [
  ["de", ["A"], "Darf A weitergeben"],
  ["de", ["A", "B"], "Darf A und B weitergeben"],
  ["de", ["A", "B", "C"], "Darf A, B und C weitergeben"],
  ["en", ["A", "B", "C"], "May share A, B and C"],
  ["fr", ["A", "B", "C"], "Peut partager A, B et C"],
];

for (const [sprache, eintraege, erwartet] of ERLAUBT) {
  test(`permissionsAllowed(${sprache}, ${eintraege.length}): Aufzaehlung mit letztem Verbinder`, () => {
    assert.equal(MCP_TEXTS[sprache].agentStatus.permissionsAllowed(eintraege), erwartet);
  });
}
