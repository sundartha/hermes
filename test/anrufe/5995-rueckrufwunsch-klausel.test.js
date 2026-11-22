import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCALES } from "../../src/i18n/locales.ts";

const ANWEISUNG = {
  de: 'Bittet die Gegenseite um einen Rueckruf, ist das ein Schritt vom Typ "callback"; der Zeitpunkt der Bitte kommt nach "at", sobald er genannt wurde.',
  en: 'If the other party asks to be called back, that is a step of type "callback"; the requested time goes into "at" as soon as it was stated.',
  fr: 'Si l\'interlocuteur demande à être rappelé, c\'est une étape de type "callback" ; le moment demandé va dans "at" dès qu\'il est indiqué.',
};

for (const lang of ["de", "en", "fr"]) {
  test(`Zusammenfassung (${lang}) weist den Rueckrufwunsch der Gegenseite als callback an`, () => {
    assert.ok(LOCALES[lang].summaryNextStepsClause.includes(ANWEISUNG[lang]));
  });
}
