import { gelesen } from "../syntaxbaum.mjs";

const TESTAUFRUFE = new Set(["test", "it"]);
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
