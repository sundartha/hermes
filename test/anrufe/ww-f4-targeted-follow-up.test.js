import { test } from "node:test";
import assert from "node:assert/strict";
import {
  announcesConsultAction,
  announcesToolAction,
  followUpToolChoiceFor,
} from "../../src/tool-follow-up.ts";
import { LLM_TOOL_CHOICE, forcedTool } from "../../src/llm/tool-choice.ts";

const CONSULT = "get_consult";
const TAKE_MESSAGE = "take_message";
const LANGUAGES = ["de", "en", "fr"];
const CONSULT_ANNOUNCEMENT = "Da müsste ich noch Rücksprache mit Jonas halten.";
const MESSAGE_ANNOUNCEMENT = "Ich gebe Jonas die Option aber gern weiter.";
const BESCHEID_ANNOUNCEMENT = "Ich gebe Jonas aber gerne Bescheid: Donnerstag ginge auch.";

test("WW-F4-6 followUpToolChoiceFor: benannt NUR bei Ruecksprache UND angebotenem Werkzeug", () => {
  const withConsult = [{ name: TAKE_MESSAGE }, { name: CONSULT }];
  const withoutConsult = [{ name: TAKE_MESSAGE }];
  const choiceFor = (text, candidateTools) =>
    followUpToolChoiceFor({ text, language: "de", candidateTools, consultToolName: CONSULT });

  assert.deepEqual(
    choiceFor(CONSULT_ANNOUNCEMENT, withConsult),
    forcedTool(CONSULT),
    "Ruecksprache + Werkzeug im Zug",
  );
  assert.equal(
    choiceFor(MESSAGE_ANNOUNCEMENT, withConsult),
    LLM_TOOL_CHOICE.REQUIRED,
    "Nachricht wird nicht umgebogen",
  );
  assert.equal(
    choiceFor(BESCHEID_ANNOUNCEMENT, withConsult),
    LLM_TOOL_CHOICE.REQUIRED,
    "auch die neue Bescheid-Form ist eine Nachricht",
  );
  assert.equal(
    choiceFor(CONSULT_ANNOUNCEMENT, withoutConsult),
    LLM_TOOL_CHOICE.REQUIRED,
    "ohne angebotenes get_consult bleibt es beim Sammel-Zwang",
  );
  assert.deepEqual(
    choiceFor("Ich frage bei Jonas nach und gebe Ihnen dann Bescheid.", withConsult),
    forcedTool(CONSULT),
    "beide Klassen im Text -> die Rueckfrage gewinnt",
  );
});

test("WW-F4-7 die neuen Marker tragen in allen drei Sprachen - und ein harmloser Satz loest NICHTS aus", () => {
  const cases = {
    de: {
      hits: [BESCHEID_ANNOUNCEMENT, "Ich sage Jonas Bescheid.", "Ich werde Jonas Bescheid geben."],
      misses: [
        "Sagen Sie mir gerne Bescheid, wenn sich etwas ändert.",
        "Da weiß ich Bescheid, das passt.",
        "Donnerstag um siebzehn Uhr passt gut.",
      ],
    },
    en: {
      hits: ["I'll let Jonas know.", "I will let him know today."],
      misses: ["Please let me know if anything changes.", "Thursday at five works fine."],
    },
    fr: {
      hits: ["Je le tiens au courant.", "Je vais le tenir au courant."],
      misses: ["Pouvez-vous me tenir au courant ?", "Jeudi dix-sept heures, cela convient."],
    },
  };
  for (const lang of LANGUAGES) {
    for (const hit of cases[lang].hits) {
      assert.equal(announcesToolAction(hit, lang), true, `${lang}: nicht erkannt - ${hit}`);
      assert.equal(
        announcesConsultAction(hit, lang),
        false,
        `${lang}: als Rueckfrage missverstanden - ${hit}`,
      );
    }
    for (const miss of cases[lang].misses)
      assert.equal(announcesToolAction(miss, lang), false, `${lang}: falsch erkannt - ${miss}`);
  }
});
