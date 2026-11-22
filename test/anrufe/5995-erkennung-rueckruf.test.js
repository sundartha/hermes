import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCALES } from "../../src/i18n/locales.ts";

const RUECKRUF_PHRASEN = {
  de: ["Gegenseite um einen Rueckruf bittet", "rufen Sie mich morgen um 10 Uhr zurueck", "Typ callback"],
  en: ["other party asks to be called back", "call me back tomorrow at 10", "type callback"],
  fr: ["demande à être rappelée", "rappelez-moi demain à 10 heures", "type callback"],
};

for (const lang of ["de", "en", "fr"]) {
  test(`summaryNextStepsClause (${lang}) weist den Rueckrufwunsch der Gegenseite als callback an, at nur mit Zeitpunkt`, () => {
    const klausel = LOCALES[lang].summaryNextStepsClause;
    for (const phrase of RUECKRUF_PHRASEN[lang]) {
      assert.ok(klausel.includes(phrase), `${lang}: "${phrase}" fehlt in der Klausel`);
    }
  });
}
