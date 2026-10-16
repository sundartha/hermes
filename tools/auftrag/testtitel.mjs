import { gelesen } from "../syntaxbaum.mjs";

const TESTAUFRUFE = new Set(["test", "it"]);
const ZUSICHERUNG = "assert";
const ERWARTUNG = "expect";
const LEERRAUM = /\s+/g;
const MODUL = { ecmaVersion: "latest", sourceType: "module" };

function* knoten(wert) {
  if (Array.isArray(wert)) for (const teil of wert) yield* knoten(teil);
  else if (typeof wert?.type === "string") {
    yield wert;
    for (const teil of Object.values(wert)) yield* knoten(teil);
  }
}

function wurzel(aufgerufen) {
  return aufgerufen.type === "MemberExpression" && !aufgerufen.computed ? wurzel(aufgerufen.object) : aufgerufen;
}

function titelDes({ type, callee, arguments: [erstes] = [] }) {
  if (type !== "CallExpression" || !TESTAUFRUFE.has(wurzel(callee).name)) return [];
  if (typeof erstes?.value === "string") return [erstes.value];
  return erstes?.type === "TemplateLiteral" && erstes.expressions.length === 0 ? erstes.quasis.map(({ value }) => value.cooked) : [];
}

export function testTitel(quelle) {
  return [...knoten(gelesen(quelle, MODUL))].flatMap(titelDes);
}

function namen(ausdruck) {
  if (ausdruck.type === "MemberExpression") return [...namen(ausdruck.object), ausdruck.property.name];
  if (ausdruck.type === "CallExpression") return namen(ausdruck.callee);
  return ausdruck.type === "Identifier" ? [ausdruck.name] : [];
}

function istZusicherung(knoten) {
  if (knoten.type !== "CallExpression") return false;
  const kette = namen(knoten.callee);
  return kette[0] === ERWARTUNG || kette.includes(ZUSICHERUNG);
}

function sammle(wert, fall, ziel) {
  if (Array.isArray(wert)) {
    for (const teil of wert) sammle(teil, fall, ziel);
    return;
  }
  if (typeof wert?.type !== "string") return;
  if (istZusicherung(wert)) {
    ziel.ergebnis.push(`${fall}: ${ziel.quelle.slice(...wert.range).replace(LEERRAUM, " ")}`);
    return;
  }
  const [titel] = titelDes(wert);
  if (titel !== undefined) ziel.ergebnis.push(`Fall ${titel}`);
  for (const teil of Object.values(wert)) sammle(teil, titel ?? fall, ziel);
}

export function zusicherungenJeFall(quelle) {
  const baum = gelesen(quelle, MODUL);
  if (baum === undefined) return null;
  const ziel = { quelle, ergebnis: [] };
  sammle(baum.body, "außerhalb", ziel);
  return ziel.ergebnis.sort();
}
