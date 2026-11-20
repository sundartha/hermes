import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { istBlockierend } from "../../scripts/check-elevenlabs-drift.mjs";
import { ladeVorlage } from "../../scripts/lib/elevenlabs-agent-lesen.mjs";
import { setzeAnPfad, vergleicheBesitz, wertAnPfad } from "../../scripts/lib/elevenlabs-besitz.mjs";

const VORLAGE = ladeVorlage();
const BESITZ_FELDER = VORLAGE._besitz.felder;
const DOKU_PRAEFIX = "_";
const LIVE_WERKZEUGE = "conversation_config.agent.prompt.tools";
const FELD = "first_message";
const FOLGE_FELD = "dynamic_variables";
const LIVE_FIRST_MESSAGE = "conversation_config.agent.first_message";
const SOLL_PLATZHALTER = "{{eroeffnung}}";
const FESTER_SATZ = "Hi, this is an AI assistant calling for Anna. I am calling about a table.";
const AUSNAHME_TAGE = BESITZ_FELDER.filter((eintrag) => eintrag.ausgenommen)
  .map((eintrag) => eintrag.ausgenommen.seit)
  .sort();
const EIN_TAG = 1;
const HEUTE = new Date(`${AUSNAHME_TAGE[AUSNAHME_TAGE.length - 1]}T00:00:00Z`);
HEUTE.setUTCDate(HEUTE.getUTCDate() + EIN_TAG);
const JE_EINTRAG = BESITZ_FELDER.filter((eintrag) => eintrag.je_eintrag_live);

function liveWerkzeuge() {
  return Object.entries(VORLAGE.tools)
    .filter(([name]) => !name.startsWith(DOKU_PRAEFIX))
    .map(([name, werkzeug]) => {
      const live = { name };
      for (const eintrag of JE_EINTRAG) {
        const treffer = wertAnPfad(werkzeug, eintrag.je_eintrag);
        if (treffer.gefunden) setzeAnPfad(live, eintrag.je_eintrag_live, treffer.wert);
      }
      return live;
    });
}

function baueUebereinstimmendenLiveAgenten() {
  const live = {};
  for (const eintrag of BESITZ_FELDER) {
    for (const [platz, vorlagePfad] of eintrag.vorlage.entries()) {
      const treffer = wertAnPfad(VORLAGE, vorlagePfad);
      if (treffer.gefunden) setzeAnPfad(live, eintrag.live[platz], treffer.wert);
    }
  }
  setzeAnPfad(live, LIVE_WERKZEUGE, liveWerkzeuge());
  return live;
}

function befundMitFirstMessage(text) {
  const live = baueUebereinstimmendenLiveAgenten();
  setzeAnPfad(live, LIVE_FIRST_MESSAGE, text);
  return vergleicheBesitz({ vorlage: VORLAGE, live, heute: HEUTE });
}

describe("Drift-Gegenprobe 5328: first_message entscheidet allein ueber Blockade", () => {
  it("Live-Attrappe mit Variable: nichts abweichend, nicht unvollstaendig, nicht blockierend", () => {
    const befund = befundMitFirstMessage(SOLL_PLATZHALTER);
    assert.deepEqual(befund.fehler, []);
    assert.deepEqual(befund.nichtPruefbar, []);
    assert.deepEqual(befund.abweichungen, []);
    assert.equal(istBlockierend(befund), false);
  });

  it("Live-Attrappe mit festem Satz: first_message (und die daraus folgende Variablenliste) weicht ab und blockiert", () => {
    const befund = befundMitFirstMessage(FESTER_SATZ);
    assert.deepEqual(befund.fehler, []);
    assert.deepEqual(befund.nichtPruefbar, []);
    assert.deepEqual(
      befund.abweichungen.map((abweichung) => abweichung.feld).sort(),
      [FOLGE_FELD, FELD],
    );
    const abweichung = befund.abweichungen.find((eintrag) => eintrag.feld === FELD);
    assert.equal(abweichung.soll.wert, SOLL_PLATZHALTER);
    assert.equal(abweichung.ist.wert, FESTER_SATZ);
    assert.equal(istBlockierend(befund), true);
  });
});
