import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const VORLAGE = JSON.parse(readFileSync("elevenlabs/agent_configs/outbound-agent.template.json", "utf8"));
const KONFIG = VORLAGE.agent.conversation_config;
const PROMPT = KONFIG.agent.prompt.prompt;
const TEILE = PROMPT.split("HOW YOU SPEAK:\n");
const ABSCHNITT = TEILE[1].split("\n")[0];

test("Eroeffnungs-Regel verbietet nur die unaufgeforderte Wiederholung", () => {
  assert.match(ABSCHNITT, /unprompted|unasked|unless asked/i);
  assert.doesNotMatch(ABSCHNITT, /never repeat or rephrase any of it\./);
});

test("Eroeffnungs-Regel laesst auf Nachfrage die KI-Angabe zu", () => {
  assert.match(ABSCHNITT, /asked[^.]*AI|AI[^.]*asked/i);
});

test("Eroeffnungs-Regel gibt dem Rueckfall aus callee_relation Vorrang", () => {
  assert.doesNotMatch(ABSCHNITT, /callee_relation/);
  assert.match(ABSCHNITT, /any instruction above about dialling your own principal's number takes precedence over this rule/);
});

function abschnittMitWert(wert) {
  const gerendert = PROMPT.replaceAll("{{callee_relation}}", wert);
  const nachUeberschrift = gerendert.split("HOW YOU SPEAK:\n")[1];
  return nachUeberschrift.split("\n")[0];
}

test("Eroeffnungs-Regel ist bei Drittnummer und eigener Nummer byte-gleich", () => {
  const eigeneNummer = "YOU ARE CALLING YOUR OWN PRINCIPAL. Disclosure sentence block.";
  assert.equal(abschnittMitWert(""), abschnittMitWert(eigeneNummer));
  assert.doesNotMatch(abschnittMitWert(""), /in {2}takes/);
  assert.doesNotMatch(abschnittMitWert(eigeneNummer), /YOU ARE CALLING YOUR OWN PRINCIPAL/);
});

test("Platzhalter callee_relation bleibt in der Persona", () => {
  assert.match(PROMPT.split("HOW YOU SPEAK:\n")[0], /\{\{callee_relation\}\}/);
});

function ganzerAbschnittMitWert(wert) {
  const gerendert = PROMPT.replaceAll("{{callee_relation}}", wert);
  const nachUeberschrift = gerendert.split("HOW YOU SPEAK:\n")[1];
  return nachUeberschrift.split("\n\n")[0];
}

test("Ganzer Abschnitt HOW YOU SPEAK ist bei leerer und gefuellter Beziehung gleich", () => {
  const eigeneNummer = "YOU ARE CALLING YOUR OWN PRINCIPAL. Disclosure sentence block.";
  assert.ok(ganzerAbschnittMitWert("").split("\n").length >= 2);
  assert.equal(ganzerAbschnittMitWert(""), ganzerAbschnittMitWert(eigeneNummer));
});
