import assert from "node:assert/strict";
import { test } from "node:test";

import { urteilen } from "../../scripts/anruf-probe/urteil.mjs";

const AUFTRAGGEBER = "Probe GmbH";
const VORNAME = "Anna";

const LOCALES = {
  de: {
    inboundEroeffnung: (name) => `Hallo, hier ist der KI-Assistent von ${name}. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?`,
    inboundEroeffnungOwner: () => "Hey, hier ist Hermes, dein KI-Assistent. Wie kann ich dir helfen?",
    disclosure: (name) => `Guten Tag, hier spricht ein KI-Assistent im Auftrag von ${name}. Das Gespräch wird für meinen Auftraggeber zusammengefasst.`,
  },
  en: {
    inboundEroeffnung: (name) => `Hello, this is ${name}'s AI assistant. This call is transcribed and summarised. How can I help?`,
    inboundEroeffnungOwner: () => "Hey, it's Hermes, your AI assistant. How can I help you?",
    disclosure: (name) => `Hello, this is an AI assistant calling on behalf of ${name}. This conversation will be summarised for the person I represent.`,
  },
  fr: {
    inboundEroeffnung: (name) => `Bonjour, ici l'assistant IA de ${name}. Cet appel est transcrit et résumé. Comment puis-je aider ?`,
    inboundEroeffnungOwner: () => "Salut, c'est Hermes, ton assistant IA. Comment je peux t'aider ?",
    disclosure: (name) => `Bonjour, ceci est un assistant IA mandaté par ${name}. Cette conversation sera résumée pour mon mandant.`,
  },
};

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
    test(`Eröffnung ${sprache}: ${name}`, () => {
      assert.deepEqual(urteilen(messung(sprache, abweichung)).gerissen, erwartet);
    });
  }
}

test("Eröffnung: ohne Richtung gilt weiter der Satz für ausgehende Anrufe, der Satz für eingehende genügt dann nicht", () => {
  const ohneRichtung = { ...messung("de"), richtung: undefined };
  assert.deepEqual(urteilen(ohneRichtung).gerissen, ["offenlegung"]);
  const ausgehend = { ...ohneRichtung, begruessung: LOCALES.de.disclosure(AUFTRAGGEBER) };
  assert.deepEqual(urteilen(ausgehend).gerissen, []);
});
