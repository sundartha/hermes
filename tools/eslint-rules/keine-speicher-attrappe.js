import { BESTAND_OPTION, bestandDerDatei, knotenSchluessel } from "./bestand.js";
import { alleKnoten, festerText, nachAnfang, zugriffsName } from "./knoten.js";

const MELDUNG =
  "Eigene withStoreLock im Test: Eine Attrappe täuscht die echte Speicher-Sperre vor, und der Test bleibt grün, obwohl der Code unter Nebenläufigkeit bricht. Nimm den echten Teststore aus test/pg-helpers.js.";
const SPERRE = "withStoreLock";
const ECHTE_SPERRE = {
  datei: "test/pg-helpers.js",
  modul: "../src/store/pg.js",
  aufruf: "macheSpeicherSperre",
};
const DEFINITIONEN = new Set(["MethodDefinition", "PropertyDefinition"]);

function festerGliedName(knoten) {
  if (knoten.computed) return festerText(knoten.key);
  return knoten.key.type === "Identifier" ? knoten.key.name : festerText(knoten.key);
}

function istEigenschaft(knoten) {
  if (knoten.type === "Property") return knoten.parent?.type === "ObjectExpression";
  return DEFINITIONEN.has(knoten.type);
}

function festerZugriffName(zugriff) {
  return zugriff.computed ? festerText(zugriff.property) : zugriffsName(zugriff);
}

function istZuweisung(knoten) {
  if (knoten.type !== "AssignmentExpression" || knoten.left.type !== "MemberExpression")
    return false;
  return festerZugriffName(knoten.left) === SPERRE;
}

function istAufrufMitName(knoten) {
  if (knoten.type !== "CallExpression") return false;
  return knoten.arguments.some((argument) => festerText(argument) === SPERRE);
}

function istImportDerSperre({ type, node, parent }) {
  if (type !== "ImportBinding" || node.type !== "ImportSpecifier") return false;
  return parent.source.value === ECHTE_SPERRE.modul && node.imported.name === ECHTE_SPERRE.aufruf;
}

function istImportierteSperre(sourceCode, aufgerufen) {
  for (let scope = sourceCode.getScope(aufgerufen); scope; scope = scope.upper) {
    const variable = scope.set.get(aufgerufen.name);
    if (variable === undefined) continue;
    const [definition, ...weitere] = variable.defs;
    return weitere.length === 0 && definition !== undefined && istImportDerSperre(definition);
  }
  return false;
}

function istEchteSperre(sourceCode, knoten, datei) {
  if (datei !== ECHTE_SPERRE.datei || knoten.type !== "AssignmentExpression") return false;
  const { right } = knoten;
  if (right.type !== "CallExpression" || right.callee.type !== "Identifier") return false;
  if (right.callee.name !== ECHTE_SPERRE.aufruf || right.arguments.length > 0) return false;
  return istImportierteSperre(sourceCode, right.callee);
}

function istAttrappe(knoten) {
  if (istEigenschaft(knoten)) return festerGliedName(knoten) === SPERRE;
  return istZuweisung(knoten) || istAufrufMitName(knoten);
}

export function speicherAttrappen(sourceCode, datei) {
  return alleKnoten(sourceCode)
    .filter((knoten) => istAttrappe(knoten) && !istEchteSperre(sourceCode, knoten, datei))
    .sort(nachAnfang);
}

export default {
  meta: {
    type: "problem",
    schema: [BESTAND_OPTION],
    messages: { attrappe: MELDUNG },
  },
  create(context) {
    return {
      Program() {
        const { sourceCode } = context;
        const bestand = bestandDerDatei(context);
        for (const attrappe of speicherAttrappen(sourceCode, bestand.datei)) {
          const schluessel = knotenSchluessel(sourceCode, bestand.datei, attrappe);
          if (!bestand.eingefroren(schluessel)) {
            context.report({ node: attrappe, messageId: "attrappe" });
          }
        }
      },
    };
  },
};
