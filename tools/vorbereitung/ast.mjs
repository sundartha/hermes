import { VisitorKeys } from "espree";

export const EINZIGE = 1;
export const ZWEI = 2;
export const FUNKTIONEN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
export const EXPORTE = new Set(["ExportNamedDeclaration", "ExportDefaultDeclaration"]);
export const NAME_ALS_SCHLUESSEL = {
  MemberExpression: "property",
  Property: "key",
  MethodDefinition: "key",
  PropertyDefinition: "key",
};
const SCHLEIFEN = new Set(["ForInStatement", "ForOfStatement"]);
const BINDUNG_IN_LISTE = { ObjectPattern: "properties", ArrayPattern: "elements" };
const BINDUNG_IN_FELD = { Property: "value", AssignmentPattern: "left", RestElement: "argument" };
const ZAHL_DURCHLASS = new Set(["BinaryExpression", "LogicalExpression", "UnaryExpression", "ConditionalExpression"]);
export const ZAHL_LESEZIEL = {
  CallExpression: "arguments",
  NewExpression: "arguments",
  ReturnStatement: "argument",
  ArrowFunctionExpression: "body",
  IfStatement: "test",
};

export function knotenImMuster(muster) {
  if (!muster) return [];
  if (muster.type === "Identifier") return [muster];
  const liste = BINDUNG_IN_LISTE[muster.type];
  if (liste) return muster[liste].flatMap(knotenImMuster);
  const feld = BINDUNG_IN_FELD[muster.type];
  return feld ? knotenImMuster(muster[feld]) : [];
}

export function namenImMuster(muster) {
  return knotenImMuster(muster).map(({ name }) => name);
}

export function geschriebeneKnoten(knoten) {
  if (knoten.type === "AssignmentExpression") return knotenImMuster(knoten.left);
  if (knoten.type === "UpdateExpression") return knotenImMuster(knoten.argument);
  return SCHLEIFEN.has(knoten.type) && knoten.left.type !== "VariableDeclaration"
    ? knotenImMuster(knoten.left)
    : [];
}

export function geschriebeneNamen(knoten) {
  return geschriebeneKnoten(knoten).map(({ name }) => name);
}

export function mitEltern(knoten, eltern = [], gesammelt = []) {
  gesammelt.push({ knoten, eltern });
  for (const schluessel of VisitorKeys[knoten.type] ?? []) {
    for (const kind of [knoten[schluessel]].flat().filter(Boolean)) mitEltern(kind, [...eltern, knoten], gesammelt);
  }
  return gesammelt;
}

export function bereichVon(knoten) {
  return String(knoten.range);
}

export function einmalGebunden(stand, name) {
  return stand.gebunden.get(name)?.length === EINZIGE;
}

export function lokalAn(stand, stelle) {
  if (stand.unsicher || !stelle.range) return false;
  const orte = stand.gebunden.get(stelle.name) ?? [];
  return orte.some(({ range: bereich }) => bereich[0] <= stelle.range[0] && stelle.range[1] <= bereich[1]);
}

export function festerName(stand, stelle) {
  return lokalAn(stand, stelle) && !stand.geschrieben.has(stelle.name);
}

export function eingebaut(stand, name) {
  return !stand.gebunden.has(name) && !stand.geschrieben.has(name) && !stand.unsicher;
}

export function einzigesArgument(aufruf) {
  const [argument, ...rest] = aufruf.arguments;
  return rest.length === 0 && argument !== undefined && argument.type !== "SpreadElement" ? argument : undefined;
}

function imFeld(elter, feld, kind) {
  return feld !== undefined && [elter[feld]].flat().includes(kind);
}

function wertEinesObjekts(elter, naechster) {
  return elter.type !== "Property" || naechster?.type === "ObjectExpression";
}

export function lesestelle({ knoten, eltern }, ziele) {
  let kind = knoten;
  const vorfahren = eltern.toReversed();
  for (const [stelle, elter] of vorfahren.entries()) {
    if (imFeld(elter, ziele[elter.type], kind) && wertEinesObjekts(elter, vorfahren[stelle + EINZIGE])) return true;
    if (!ZAHL_DURCHLASS.has(elter.type)) return false;
    kind = elter;
  }
  return false;
}
