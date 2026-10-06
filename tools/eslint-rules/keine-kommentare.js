import { alleKnoten } from "./knoten.js";

const KOMMENTAR_ARTEN = new Set(["Line", "Block"]);
const STARTZEILE = "Shebang";
const ERLAUBTE_STARTZEILE = "/usr/bin/env node";
const ERLAUBTE_DIREKTIVE = "use strict";
const DIREKTIVE = "Directive";
const MELDUNG =
  "Kommentare sind in diesem Repo verboten, ohne Ausnahme. Mach die Absicht im Code sichtbar: besserer Name, eigene Funktion, Typ, benannte Konstante oder ein Test, dessen Name die Regel ausspricht. Entscheidungsgeschichte gehört in die Commit-Nachricht oder nach docs/entscheidungen/, offene Befunde in ein Ticket.";

function istTextDirektive({ type, directive }) {
  return type === "ExpressionStatement" && directive !== undefined && directive !== ERLAUBTE_DIREKTIVE;
}

function textDirektiven(sourceCode) {
  return alleKnoten(sourceCode)
    .filter(istTextDirektive)
    .map(({ directive, loc, range }) => ({ type: DIREKTIVE, value: directive, loc, range }));
}

function istPruefbar({ type, value }) {
  return KOMMENTAR_ARTEN.has(type) || (type === STARTZEILE && value !== ERLAUBTE_STARTZEILE);
}

function pruefbareKommentare(sourceCode) {
  const kommentare = sourceCode.getAllComments().filter(istPruefbar);
  const alle = [...kommentare, ...textDirektiven(sourceCode)];
  return alle.toSorted((links, rechts) => links.range[0] - rechts.range[0]);
}

export default {
  meta: {
    type: "suggestion",
    schema: [],
    messages: { kommentar: MELDUNG },
  },
  create(context) {
    return {
      Program() {
        for (const kommentar of pruefbareKommentare(context.sourceCode)) {
          context.report({ loc: kommentar.loc, messageId: "kommentar" });
        }
      },
    };
  },
};
