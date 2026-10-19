import { BESTAND_OPTION, bestandDerDatei, knotenSchluessel } from "./bestand.js";
import { alleKnoten, festerText, nachAnfang } from "./knoten.js";

const MELDUNG =
  "Dynamischer Import mit Platzhalter: Die Importregel für Tests sieht ihn nicht. Schreib den Pfad als festen Text.";

function istImportMitPlatzhalter(node) {
  return node.type === "ImportExpression" && festerText(node.source) === undefined;
}

export function importeMitPlatzhalter(sourceCode) {
  return alleKnoten(sourceCode).filter(istImportMitPlatzhalter).sort(nachAnfang);
}

export default {
  meta: {
    type: "problem",
    schema: [BESTAND_OPTION],
    messages: { platzhalter: MELDUNG },
  },
  create(context) {
    return {
      Program() {
        const { sourceCode } = context;
        const bestand = bestandDerDatei(context);
        for (const importAusdruck of importeMitPlatzhalter(sourceCode)) {
          const schluessel = knotenSchluessel(sourceCode, bestand.datei, importAusdruck);
          if (!bestand.eingefroren(schluessel)) {
            context.report({ node: importAusdruck, messageId: "platzhalter" });
          }
        }
      },
    };
  },
};
