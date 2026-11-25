import assert from "node:assert/strict";
import { test } from "node:test";

import { LOCALES } from "../../src/i18n/locales.ts";

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
    assert.equal(LOCALES[sprache].mcp.consultAnswerAccepted(anzahl), erwartet);
  });
}

const NUTZUNG = [
  ["de", "Monatsnutzung: 42 % des Minuten-Kontingents"],
  ["en", "Monthly usage: 42% of your included minutes"],
  ["fr", "Utilisation mensuelle : 42 % des minutes incluses"],
];

for (const [sprache, erwartet] of NUTZUNG) {
  test(`planUsage(${sprache}): Prozentwert im Text`, () => {
    const { agentStatus } = LOCALES[sprache].mcp;
    assert.equal(agentStatus.planUsage(42), erwartet);
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
    const { agentStatus } = LOCALES[sprache].mcp;
    assert.equal(agentStatus.permissionsAllowed(eintraege), erwartet);
  });
}
