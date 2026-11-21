import assert from "node:assert/strict";
import { test } from "node:test";

import { LOCALES } from "../../src/i18n/locales.ts";
import { urteilen } from "../../scripts/anruf-probe/urteil.mjs";

const AUFTRAGGEBER = "Probe GmbH";
const VORNAME = "Anna";

function messung(sprache, abweichung = {}) {
  const locale = LOCALES[sprache];
  return {
    annahmeSekunden: 3,
    begruessung: locale.inboundEroeffnung(AUFTRAGGEBER),
    sprache,
    auftraggeber: AUFTRAGGEBER,
    vorname: VORNAME,
    richtung: "eingehend",
    dauerSekunden: 20,
    status: "completed",
    ...abweichung,
  };
}

for (const sprache of ["de", "en", "fr"]) {
  const locale = LOCALES[sprache];
  const TABELLE = [
    ["Eröffnung für Fremde", { begruessung: locale.inboundEroeffnung(AUFTRAGGEBER) }, []],
    ["Eröffnung für Fremde mit Anhang und Leerraum", { begruessung: `  ${locale.inboundEroeffnung(AUFTRAGGEBER)} Zusatz` }, []],
    ["Eröffnung für den Auftraggeber", { begruessung: locale.inboundEroeffnungOwner(VORNAME) }, []],
    ["Satz für ausgehende Anrufe", { begruessung: locale.disclosure(AUFTRAGGEBER) }, ["offenlegung"]],
    ["Eröffnung für Fremde mit anderem Auftraggeber", { begruessung: locale.inboundEroeffnung("Andere AG") }, ["offenlegung"]],
    ["Eröffnung für den Auftraggeber ohne Vornamen in der Messung", { begruessung: locale.inboundEroeffnungOwner(VORNAME), vorname: undefined }, ["offenlegung"]],
    ["beliebiger Text ohne Vornamen in der Messung", { begruessung: "Hallo Welt", vorname: undefined }, ["offenlegung"]],
    ["unbekannte Richtung", { richtung: "seitwaerts" }, ["offenlegung"]],
  ];
  for (const [name, abweichung, erwartet] of TABELLE) {
    test(`Eröffnung aus LOCALES ${sprache}: ${name}`, () => {
      assert.deepEqual(urteilen(messung(sprache, abweichung)).gerissen, erwartet);
    });
  }
}

test("Eröffnung aus LOCALES: ohne Richtung gilt weiter der Satz für ausgehende Anrufe, der Satz für eingehende genügt dann nicht", () => {
  const ohneRichtung = { ...messung("de"), richtung: undefined };
  assert.deepEqual(urteilen(ohneRichtung).gerissen, ["offenlegung"]);
  const ausgehend = { ...ohneRichtung, begruessung: LOCALES.de.disclosure(AUFTRAGGEBER) };
  assert.deepEqual(urteilen(ausgehend).gerissen, []);
});
