import { BESTAND_OPTION, bestandDerDatei, knotenSchluessel } from "./bestand.js";
import { alleKnoten, nachAnfang, schluesselName, zugriffsName } from "./knoten.js";

const MELDUNG =
  "Anfrage ohne Antwortfrist: nutze abrufMitFrist oder mitAntwortfrist aus test/gemeinsam/antwortfrist.mjs oder anfrageMitFrist aus test/gemeinsam/anfrage-mit-frist.mjs, sonst hängt der Test bei einem Mutanten bis zum Zeitlimit.";
const MELDUNG_PRODUKT =
  "Anfrage nach außen ohne Antwortfrist: gib `signal: AbortSignal.timeout(<benannte Frist in ms>)` mit, sonst hängt der Aufruf endlos, wenn die Gegenseite nicht antwortet.";
const TEST_ORDNER = "test/";
const HTTP_MODULE = new Set(["http", "node:http", "https", "node:https"]);
const HTTP_FUNKTIONEN = new Set(["request", "get"]);
const GLOBALE_HUELLEN = new Set(["globalThis", "global"]);
const FRIST_ERZEUGER = new Set(["timeout"]);
const SIGNAL_VERKNUEPFUNG = new Set(["any"]);
const HUELLE_FUER_HTTP = "mitAntwortfrist";
const FRIST_FUNKTION = "fristSignal";
const SIGNAL_OPTION = "signal";
const ERSTES_ARGUMENT = 0;
const ZWEITES_ARGUMENT = 1;

function bindung(scope, name) {
  for (let aktuell = scope; aktuell !== null; aktuell = aktuell.upper) {
    const gefunden = aktuell.set.get(name);
    if (gefunden !== undefined) return gefunden;
  }
  return undefined;
}

function definitionen(scope, name) {
  return bindung(scope, name)?.defs ?? [];
}

function istGlobal(scope, name) {
  return definitionen(scope, name).length === 0;
}

function istZugriffAuf(knoten, objektName, namen) {
  return (
    knoten.type === "MemberExpression" &&
    knoten.object.type === "Identifier" &&
    knoten.object.name === objektName &&
    namen.has(zugriffsName(knoten))
  );
}

function istGlobaleHuelle(scope, knoten) {
  return (
    knoten?.type === "Identifier" &&
    GLOBALE_HUELLEN.has(knoten.name) &&
    istGlobal(scope, knoten.name)
  );
}

function istEchtesFetch(scope, ausdruck) {
  if (ausdruck.type === "Identifier") return ausdruck.name === "fetch" && istGlobal(scope, "fetch");
  return (
    ausdruck.type === "MemberExpression" &&
    istGlobaleHuelle(scope, ausdruck.object) &&
    zugriffsName(ausdruck) === "fetch"
  );
}

function weistZu({ identifier }) {
  const { parent } = identifier;
  if (parent.type === "VariableDeclarator") return parent.id === identifier;
  return (
    (parent.type === "AssignmentExpression" || parent.type === "AssignmentPattern") &&
    parent.left === identifier
  );
}

function entpacktFetchAusHuelle({ identifier, writeExpr, from }) {
  const ziel = identifier.parent.type === "AssignmentPattern" ? identifier.parent : identifier;
  const eigenschaft = ziel.parent;
  return (
    eigenschaft.type === "Property" &&
    eigenschaft.parent.type === "ObjectPattern" &&
    schluesselName(eigenschaft) === "fetch" &&
    istGlobaleHuelle(from, writeExpr)
  );
}

function istAliasVonFetch(variable, besucht) {
  if (besucht.has(variable)) return false;
  besucht.add(variable);
  return variable.references.some(
    (zugriff) =>
      zugriff.isWrite() &&
      ((weistZu(zugriff) && istGlobalesFetch(zugriff.from, zugriff.writeExpr, besucht)) ||
        entpacktFetchAusHuelle(zugriff)),
  );
}

function istGlobalesFetch(scope, ausdruck, besucht = new Set()) {
  if (istEchtesFetch(scope, ausdruck)) return true;
  if (ausdruck.type !== "Identifier") return false;
  const variable = bindung(scope, ausdruck.name);
  return variable !== undefined && istAliasVonFetch(variable, besucht);
}

function enthaeltFrist(signale) {
  return (
    signale?.type === "ArrayExpression" &&
    signale.elements.some((signal) => signal !== null && istFrist(signal))
  );
}

function istFrist(ausdruck) {
  if (ausdruck.type !== "CallExpression") return false;
  const { callee, arguments: argumente } = ausdruck;
  if (callee.type === "Identifier") return callee.name === FRIST_FUNKTION;
  if (istZugriffAuf(callee, "AbortSignal", FRIST_ERZEUGER)) return true;
  return (
    istZugriffAuf(callee, "AbortSignal", SIGNAL_VERKNUEPFUNG) &&
    enthaeltFrist(argumente[ERSTES_ARGUMENT])
  );
}

function hatFristSignal(optionen) {
  if (optionen?.type !== "ObjectExpression") return false;
  return optionen.properties.some(
    (eigenschaft) => schluesselName(eigenschaft) === SIGNAL_OPTION && istFrist(eigenschaft.value),
  );
}

function ladtHttp(ausdruck) {
  const knoten = ausdruck?.type === "AwaitExpression" ? ausdruck.argument : ausdruck;
  if (knoten?.type === "ImportExpression") return HTTP_MODULE.has(knoten.source.value);
  const istRequire = knoten?.type === "CallExpression" && knoten.callee.name === "require";
  return istRequire && HTTP_MODULE.has(knoten.arguments[ERSTES_ARGUMENT]?.value);
}

function istHttpModul(definition) {
  if (definition.type === "ImportBinding") {
    const { type } = definition.node;
    const istModul = type === "ImportDefaultSpecifier" || type === "ImportNamespaceSpecifier";
    return istModul && HTTP_MODULE.has(definition.parent.source.value);
  }
  return (
    definition.type === "Variable" &&
    definition.node.id.type === "Identifier" &&
    ladtHttp(definition.node.init)
  );
}

function istHttpFunktion(definition) {
  if (definition.type === "ImportBinding") {
    const importiert = definition.node.imported;
    const name = importiert?.name ?? importiert?.value;
    return HTTP_FUNKTIONEN.has(name) && HTTP_MODULE.has(definition.parent.source.value);
  }
  const { node } = definition;
  if (definition.type !== "Variable" || node.id.type !== "ObjectPattern") return false;
  const eigenschaft = node.id.properties.find(
    ({ value }) => value?.type === "Identifier" && value.name === definition.name.name,
  );
  return (
    eigenschaft !== undefined &&
    HTTP_FUNKTIONEN.has(schluesselName(eigenschaft)) &&
    ladtHttp(node.init)
  );
}

function istHttpAufruf(scope, aufgerufen) {
  if (aufgerufen.type === "Identifier") {
    return definitionen(scope, aufgerufen.name).some(istHttpFunktion);
  }
  if (aufgerufen.type !== "MemberExpression" || !HTTP_FUNKTIONEN.has(zugriffsName(aufgerufen))) {
    return false;
  }
  const { object } = aufgerufen;
  if (object.type !== "Identifier") return ladtHttp(object);
  return definitionen(scope, object.name).some(istHttpModul);
}

function istInHuelle(aufruf) {
  const { parent } = aufruf;
  return (
    parent.type === "CallExpression" &&
    parent.callee.type === "Identifier" &&
    parent.callee.name === HUELLE_FUER_HTTP &&
    parent.arguments[ERSTES_ARGUMENT] === aufruf
  );
}

function fehltFrist(scope, aufruf) {
  const { callee, arguments: argumente } = aufruf;
  if (istGlobalesFetch(scope, callee)) return !hatFristSignal(argumente[ZWEITES_ARGUMENT]);
  return istHttpAufruf(scope, callee) && !istInHuelle(aufruf);
}

export function anfragenOhneFrist(sourceCode) {
  return alleKnoten(sourceCode)
    .filter(
      (knoten) =>
        knoten.type === "CallExpression" && fehltFrist(sourceCode.getScope(knoten), knoten),
    )
    .sort(nachAnfang);
}

export default {
  meta: {
    type: "problem",
    schema: [BESTAND_OPTION],
    messages: { ohneFrist: MELDUNG, ohneFristImProdukt: MELDUNG_PRODUKT },
  },
  create(context) {
    return {
      Program() {
        const { sourceCode } = context;
        const bestand = bestandDerDatei(context);
        const messageId = bestand.datei.startsWith(TEST_ORDNER) ? "ohneFrist" : "ohneFristImProdukt";
        for (const aufruf of anfragenOhneFrist(sourceCode)) {
          const schluessel = knotenSchluessel(sourceCode, bestand.datei, aufruf);
          if (!bestand.eingefroren(schluessel)) context.report({ node: aufruf, messageId });
        }
      },
    };
  },
};
