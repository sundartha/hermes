const MELDUNG =
  "Anfrage ohne Antwortfrist: nutze abrufMitFrist oder mitAntwortfrist aus test/gemeinsam/antwortfrist.mjs oder anfrageMitFrist aus test/gemeinsam/anfrage-mit-frist.mjs, sonst hängt der Test bei einem Mutanten bis zum Zeitlimit.";
const HTTP_MODULE = new Set(["http", "node:http", "https", "node:https"]);
const HTTP_FUNKTIONEN = new Set(["request", "get"]);
const GLOBALE_HUELLEN = new Set(["globalThis", "global"]);
const FRIST_ERZEUGER = new Set(["timeout", "any"]);
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

function zugriffsName(zugriff) {
  if (!zugriff.computed) return zugriff.property.name;
  return zugriff.property.type === "Literal" ? zugriff.property.value : undefined;
}

function istZugriffAuf(knoten, objektName, namen) {
  return (
    knoten.type === "MemberExpression" &&
    knoten.object.type === "Identifier" &&
    knoten.object.name === objektName &&
    namen.has(zugriffsName(knoten))
  );
}

function istGlobalesFetch(scope, ausdruck) {
  if (ausdruck.type === "Identifier") return ausdruck.name === "fetch" && istGlobal(scope, "fetch");
  if (ausdruck.type !== "MemberExpression" || ausdruck.object.type !== "Identifier") return false;
  const { name } = ausdruck.object;
  return GLOBALE_HUELLEN.has(name) && istGlobal(scope, name) && zugriffsName(ausdruck) === "fetch";
}

function schluesselName(eigenschaft) {
  if (eigenschaft.type !== "Property" || eigenschaft.computed) return undefined;
  return eigenschaft.key.type === "Identifier" ? eigenschaft.key.name : eigenschaft.key.value;
}

function istFristErzeuger({ callee }) {
  if (callee.type === "Identifier") return callee.name === FRIST_FUNKTION;
  return istZugriffAuf(callee, "AbortSignal", FRIST_ERZEUGER);
}

function hatFristSignal(optionen) {
  if (optionen?.type !== "ObjectExpression") return false;
  return optionen.properties.some(
    (eigenschaft) =>
      schluesselName(eigenschaft) === SIGNAL_OPTION &&
      eigenschaft.value.type === "CallExpression" &&
      istFristErzeuger(eigenschaft.value),
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

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: { ohneFrist: MELDUNG },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (fehltFrist(context.sourceCode.getScope(node), node)) {
          context.report({ node, messageId: "ohneFrist" });
        }
      },
    };
  },
};
