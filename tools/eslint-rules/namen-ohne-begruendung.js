const BEGRUENDUNGSWOERTER = new Set([
  "weil",
  "damit",
  "wegen",
  "sonst",
  "falls",
  "because",
  "otherwise",
  "workaround",
  "hack",
  "todo",
  "fixme",
]);
const MELDUNG =
  "Ein Name sagt, was etwas ist, nicht warum es so ist. Begründungen gehören in die Commit-Nachricht.";
const KLEIN_GROSS = /(\p{Ll})(\p{Lu})/gu;
const GROSS_WORTANFANG = /(\p{Lu})(\p{Lu}\p{Ll})/gu;
const TRENNER = /[^\p{L}]+/u;
const GETRENNT = "$1 $2";

export function wortteile(name) {
  const getrennt = name.replace(KLEIN_GROSS, GETRENNT).replace(GROSS_WORTANFANG, GETRENNT);
  const teile = getrennt.split(TRENNER).filter(Boolean);
  return teile.map((teil) => teil.toLowerCase());
}

export function enthaeltBegruendung(name) {
  return wortteile(name).some((teil) => BEGRUENDUNGSWOERTER.has(teil));
}

function musterNamen(muster) {
  if (!muster) return [];
  if (muster.type === "Identifier") return [{ name: muster.name, node: muster }];
  if (muster.type === "AssignmentPattern") return musterNamen(muster.left);
  if (muster.type === "RestElement") return musterNamen(muster.argument);
  if (muster.type === "ArrayPattern") return muster.elements.flatMap(musterNamen);
  if (muster.type !== "ObjectPattern") return [];
  return muster.properties.flatMap((teil) => musterNamen(teil.type === "Property" ? teil.value : teil));
}

function schluesselName(schluessel) {
  if (schluessel.type === "Identifier" || schluessel.type === "PrivateIdentifier") {
    return [{ name: schluessel.name, node: schluessel }];
  }
  const istText = schluessel.type === "Literal" && typeof schluessel.value === "string";
  return istText ? [{ name: schluessel.value, node: schluessel }] : [];
}

function funktionsNamen(node) {
  return [...musterNamen(node.id), ...node.params.flatMap(musterNamen)];
}

function eigenerSchluessel(node) {
  return node.computed ? [] : schluesselName(node.key);
}

function objektSchluessel(node) {
  const imLiteral = node.parent.type === "ObjectExpression";
  return imLiteral && !node.shorthand ? eigenerSchluessel(node) : [];
}

function importName(node) {
  const umbenannt = node.imported === undefined || node.imported.name !== node.local.name;
  return umbenannt ? musterNamen(node.local) : [];
}

const BINDUNGEN = {
  VariableDeclarator: (node) => musterNamen(node.id),
  FunctionDeclaration: funktionsNamen,
  FunctionExpression: funktionsNamen,
  ArrowFunctionExpression: funktionsNamen,
  ClassDeclaration: (node) => musterNamen(node.id),
  ClassExpression: (node) => musterNamen(node.id),
  MethodDefinition: eigenerSchluessel,
  PropertyDefinition: eigenerSchluessel,
  Property: objektSchluessel,
  CatchClause: (node) => musterNamen(node.param),
  ImportSpecifier: importName,
  ImportDefaultSpecifier: importName,
  ImportNamespaceSpecifier: importName,
};

export function gebundeneNamen(node) {
  return BINDUNGEN[node.type]?.(node) ?? [];
}

export const GEBUNDENE_KNOTEN = Object.keys(BINDUNGEN);

export default {
  meta: {
    type: "suggestion",
    schema: [],
    messages: { begruendung: MELDUNG },
  },
  create(context) {
    const pruefen = (node) => {
      for (const gebunden of gebundeneNamen(node)) {
        if (enthaeltBegruendung(gebunden.name)) {
          context.report({ node: gebunden.node, messageId: "begruendung" });
        }
      }
    };
    return Object.fromEntries(GEBUNDENE_KNOTEN.map((typ) => [typ, pruefen]));
  },
};
