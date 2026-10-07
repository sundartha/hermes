import { BESTAND_OPTION, befundSchluessel, bestandDerDatei } from "./bestand.js";
import { alleKnoten } from "./knoten.js";
import { pfadFalter } from "./pfad-falten.js";

const MELDUNG =
  "Prüfung ohne Ergebnis des Codes: Beide Seiten stehen schon im Test fest. Prüf, was der Code liefert.";
const ASSERT_MODULE = new Set(["assert", "node:assert", "assert/strict", "node:assert/strict"]);
const GANZES_MODUL = "*";
const STRENGE_FASSUNG = "strict";
const ASSERT_IM_TESTKONTEXT = "assert";
const WAHRHEITSPRUEFUNG = "ok";
const VERGLEICHE = [
  "equal",
  "strictEqual",
  "deepEqual",
  "deepStrictEqual",
  "notEqual",
  "notStrictEqual",
  "notDeepEqual",
  "notDeepStrictEqual",
  "match",
  "doesNotMatch",
];
const EIN_WERT = 1;
const ZWEI_WERTE = 2;
const WERTE_JE_PRUEFUNG = new Map([
  [WAHRHEITSPRUEFUNG, EIN_WERT],
  ...VERGLEICHE.map((name) => [name, ZWEI_WERTE]),
]);
const START = 0;

function assertName(falter, bezeichner) {
  const quelle = falter.herkunft(bezeichner);
  return ASSERT_MODULE.has(quelle?.modul) ? quelle.name : undefined;
}

function istGanzesAssert(name) {
  return name === GANZES_MODUL || name === STRENGE_FASSUNG;
}

function istAssertObjekt(falter, node) {
  if (node.type === "Identifier") return istGanzesAssert(assertName(falter, node));
  if (node.type !== "MemberExpression" || node.computed) return false;
  if (node.property.name === STRENGE_FASSUNG) return istAssertObjekt(falter, node.object);
  return node.property.name === ASSERT_IM_TESTKONTEXT && node.object.type === "Identifier";
}

function pruefungsName(falter, callee) {
  if (callee.type === "Identifier") {
    const name = assertName(falter, callee);
    return istGanzesAssert(name) ? WAHRHEITSPRUEFUNG : name;
  }
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  return istAssertObjekt(falter, callee.object) ? callee.property.name : undefined;
}

function aufgeloest(sourceCode, bezeichner) {
  const { references } = sourceCode.getScope(bezeichner);
  return references.find(({ identifier }) => identifier === bezeichner)?.resolved;
}

function konstanterAnfangswert(lauf, variable) {
  const [definition, ...weitere] = variable.defs;
  const istConst = definition?.type === "Variable" && definition.parent.kind === "const";
  if (!istConst || weitere.length > 0 || definition.node.id !== definition.name) return false;
  return definition.node.init !== null && konstant(lauf, definition.node.init, false);
}

function konstanteVariable(lauf, variable) {
  if (!variable || lauf.besucht.has(variable)) return false;
  lauf.besucht.add(variable);
  try {
    return konstanterAnfangswert(lauf, variable);
  } finally {
    lauf.besucht.delete(variable);
  }
}

function konstanteEigenschaft(lauf, eigenschaft) {
  const einfacheEigenschaft = eigenschaft.type === "Property" && eigenschaft.kind === "init";
  if (!einfacheEigenschaft || eigenschaft.method) return false;
  const schluesselFest = !eigenschaft.computed || konstant(lauf, eigenschaft.key, false);
  return schluesselFest && konstant(lauf, eigenschaft.value, true);
}

function beideSeiten(lauf, node) {
  return konstant(lauf, node.left, false) && konstant(lauf, node.right, false);
}

const KONSTANTE_KNOTEN = new Map(
  Object.entries({
    Literal: (lauf, node, imAufruf) => imAufruf || node.regex === undefined,
    TemplateLiteral: (lauf, node) => node.expressions.every((teil) => konstant(lauf, teil, false)),
    UnaryExpression: (lauf, node) => konstant(lauf, node.argument, false),
    BinaryExpression: beideSeiten,
    LogicalExpression: beideSeiten,
    Identifier: (lauf, node) => konstanteVariable(lauf, aufgeloest(lauf.sourceCode, node)),
    ArrayExpression: (lauf, node, imAufruf) =>
      imAufruf &&
      node.elements.every((element) => element === null || konstant(lauf, element, true)),
    ObjectExpression: (lauf, node, imAufruf) =>
      imAufruf && node.properties.every((eigenschaft) => konstanteEigenschaft(lauf, eigenschaft)),
  }),
);

function konstant(lauf, node, imAufruf) {
  const pruefer = KONSTANTE_KNOTEN.get(node.type);
  return pruefer !== undefined && pruefer(lauf, node, imAufruf);
}

function istSelbstpruefung(lauf, aufruf) {
  const anzahl = WERTE_JE_PRUEFUNG.get(pruefungsName(lauf.falter, aufruf.callee));
  if (anzahl === undefined) return false;
  const werte = aufruf.arguments.slice(START, anzahl);
  return werte.length === anzahl && werte.every((wert) => konstant(lauf, wert, true));
}

function nachPosition(links, rechts) {
  return links.range[START] - rechts.range[START];
}

export function selbstpruefungen(sourceCode, datei) {
  const lauf = { sourceCode, falter: pfadFalter(sourceCode, datei), besucht: new Set() };
  const aufrufe = alleKnoten(sourceCode).filter(({ type }) => type === "CallExpression");
  return aufrufe.filter((aufruf) => istSelbstpruefung(lauf, aufruf)).sort(nachPosition);
}

export function selbstpruefungsSchluessel(sourceCode, datei, aufruf) {
  return befundSchluessel(datei, sourceCode.getText(aufruf));
}

export default {
  meta: {
    type: "problem",
    schema: [BESTAND_OPTION],
    messages: { selbstpruefung: MELDUNG },
  },
  create(context) {
    return {
      Program() {
        const { sourceCode } = context;
        const bestand = bestandDerDatei(context);
        for (const aufruf of selbstpruefungen(sourceCode, bestand.datei)) {
          if (bestand.eingefroren(selbstpruefungsSchluessel(sourceCode, bestand.datei, aufruf))) {
            continue;
          }
          context.report({ node: aufruf, messageId: "selbstpruefung" });
        }
      },
    };
  },
};
