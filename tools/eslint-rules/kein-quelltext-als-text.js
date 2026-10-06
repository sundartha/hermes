import { BESTAND_OPTION, befundSchluessel, bestandDerDatei } from "./bestand.js";
import { UNBEKANNT, pfadFalter, pfadImRepo } from "./pfad-falten.js";

const MELDUNG =
  "Tests prüfen Verhalten, nicht Quelltext: Lies keine Datei unter src/ oder docs/ und keine .md-Datei als Text. Ruf den Code auf und prüfe, was er tut.";
const LESE_FUNKTIONEN = new Set([
  "readFileSync",
  "readFile",
  "readdirSync",
  "readdir",
  "createReadStream",
]);
const FS_MODULE = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);
const GANZES_MODUL = "*";
const VERSPRECHEN = "promises";
const VERBOTENE_ORDNER = new Set(["src", "docs"]);
const ERLAUBTER_ORDNER = "test/fixtures/";
const MARKDOWN = ".md";
const ORDNER_TRENNER = "/";

function istFsModul(falter, node) {
  if (node.type === "MemberExpression" && !node.computed && node.property.name === VERSPRECHEN) {
    return istFsModul(falter, node.object);
  }
  const quelle = falter.herkunft(node);
  return FS_MODULE.has(quelle?.modul) && quelle.name === GANZES_MODUL;
}

function istLeseAufruf(falter, { callee }) {
  if (callee.type === "Identifier") {
    const quelle = falter.herkunft(callee);
    return FS_MODULE.has(quelle?.modul) && LESE_FUNKTIONEN.has(quelle.name);
  }
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  return LESE_FUNKTIONEN.has(callee.property.name) && istFsModul(falter, callee.object);
}

export function istVerbotenesZiel(pfad) {
  if (pfad === undefined || pfad.startsWith(ERLAUBTER_ORDNER)) return false;
  const [ordner] = pfad.split(ORDNER_TRENNER);
  if (ordner.includes(UNBEKANNT)) return false;
  return VERBOTENE_ORDNER.has(ordner) || pfad.endsWith(MARKDOWN);
}

function aufrufe(sourceCode) {
  const gefunden = [];
  const offen = [sourceCode.ast];
  while (offen.length > 0) {
    const node = offen.pop();
    if (node.type === "CallExpression") gefunden.push(node);
    for (const schluessel of sourceCode.visitorKeys[node.type] ?? []) {
      offen.push(...[node[schluessel]].flat().filter(Boolean));
    }
  }
  return gefunden.reverse();
}

export function quelltextLesestellen(sourceCode, datei) {
  const falter = pfadFalter(sourceCode, datei);
  return aufrufe(sourceCode)
    .filter((aufruf) => istLeseAufruf(falter, aufruf))
    .filter((aufruf) => falter.werte(aufruf.arguments[0]).some((wert) => istVerbotenesZiel(pfadImRepo(wert))));
}

export function lesestellenSchluessel(sourceCode, datei, aufruf) {
  return befundSchluessel(datei, sourceCode.getText(aufruf));
}

export default {
  meta: {
    type: "problem",
    schema: [BESTAND_OPTION],
    messages: { quelltextAlsText: MELDUNG },
  },
  create(context) {
    return {
      Program() {
        const { sourceCode } = context;
        const bestand = bestandDerDatei(context);
        for (const aufruf of quelltextLesestellen(sourceCode, bestand.datei)) {
          if (bestand.eingefroren(lesestellenSchluessel(sourceCode, bestand.datei, aufruf))) continue;
          context.report({ node: aufruf, messageId: "quelltextAlsText" });
        }
      },
    };
  },
};
