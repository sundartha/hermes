import { BESTAND_OPTION, befundSchluessel, bestandDerDatei } from "./bestand.js";
import { alleKnoten } from "./knoten.js";

const MELDUNG =
  "Dynamischer Import mit Platzhalter: Die Importregel für Tests sieht ihn nicht. Schreib den Pfad als festen Text.";
const ANFANG = 0;

function istFesterText(quelle) {
  if (quelle.type === "Literal") return typeof quelle.value === "string";
  return quelle.type === "TemplateLiteral" && quelle.expressions.length === 0;
}

function istImportMitPlatzhalter(node) {
  return node.type === "ImportExpression" && !istFesterText(node.source);
}

function nachAnfang(links, rechts) {
  return links.range[ANFANG] - rechts.range[ANFANG];
}

export function importeMitPlatzhalter(sourceCode) {
  return alleKnoten(sourceCode).filter(istImportMitPlatzhalter).sort(nachAnfang);
}

export function importSchluessel(sourceCode, datei, importAusdruck) {
  return befundSchluessel(datei, sourceCode.getText(importAusdruck));
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
          const schluessel = importSchluessel(sourceCode, bestand.datei, importAusdruck);
          if (!bestand.eingefroren(schluessel)) {
            context.report({ node: importAusdruck, messageId: "platzhalter" });
          }
        }
      },
    };
  },
};
