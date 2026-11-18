import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { istBlockierend } from "../../scripts/check-elevenlabs-drift.mjs";
import { ladeVorlage } from "../../scripts/lib/elevenlabs-agent-lesen.mjs";
import { vergleicheBesitz } from "../../scripts/lib/elevenlabs-besitz.mjs";

const VORLAGE = ladeVorlage();
const FELD = "first_message";
const SOLL_PLATZHALTER = "{{eroeffnung}}";
const FESTER_SATZ = "Hi, this is an AI assistant calling for Anna. I am calling about a table.";

function befundMitFirstMessage(text) {
  const live = { conversation_config: { agent: { first_message: text } } };
  return vergleicheBesitz({ vorlage: VORLAGE, live });
}

function abweichungZuFirstMessage(befund) {
  return befund.abweichungen.find((abweichung) => abweichung.feld === FELD);
}

describe("Drift-Gegenprobe 5195: eine gefuellte first_message am Live-Agenten wird gemeldet", () => {
  it("Vorlage: first_message ist die Variable, kein fester Satz", () => {
    const { agent } = VORLAGE.agent.conversation_config;
    assert.equal(agent.first_message, SOLL_PLATZHALTER);
  });

  it("Live-Agent mit festem Satz in first_message: ABWEICHUNG mit Soll und Ist", () => {
    const befund = befundMitFirstMessage(FESTER_SATZ);
    const abweichung = abweichungZuFirstMessage(befund);
    assert.ok(abweichung, "der feste Satz am Live-Agenten wurde nicht als Abweichung gemeldet");
    assert.equal(abweichung.soll.wert, SOLL_PLATZHALTER);
    assert.equal(abweichung.ist.wert, FESTER_SATZ);
    assert.equal(abweichung.ausgenommen, null);
    assert.equal(istBlockierend(befund), true);
    assert.ok(abweichung.zeile.startsWith(`ABWEICHUNG ${FELD} `), abweichung.zeile);
  });

  it("Live-Agent mit der Variable: keine Abweichung an first_message", () => {
    const befund = befundMitFirstMessage(SOLL_PLATZHALTER);
    assert.equal(abweichungZuFirstMessage(befund), undefined);
  });
});
