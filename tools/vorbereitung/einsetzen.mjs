import { VisitorKeys } from "espree";

import { bereichVon } from "./ast.mjs";

const NAME_ALS_SCHLUESSEL = {
  MemberExpression: "property",
  Property: "key",
  MethodDefinition: "key",
  PropertyDefinition: "key",
};
export function keineZerlegung() {
  return { plaene: new Map(), helfer: new Set(), eingesetzt: new Set() };
}

function bezugsstelle({ elter, schluessel }) {
  const name = NAME_ALS_SCHLUESSEL[elter?.type];
  return name === undefined || name !== schluessel || elter.computed;
}

function umbenannterName(knoten, abbildung, lage) {
  const neu = abbildung.get(knoten.name);
  return neu !== undefined && bezugsstelle(lage) ? { ...knoten, name: neu } : knoten;
}

function kurzschrift(knoten, kopie) {
  if (knoten.type !== "Property" || !knoten.shorthand) return kopie;
  const wert = kopie.value.left ?? kopie.value;
  return { ...kopie, shorthand: knoten.key.name === wert.name };
}

function umbenannt(knoten, abbildung, lage = {}) {
  if (Array.isArray(knoten)) return knoten.map((teil) => umbenannt(teil, abbildung, lage));
  if (!knoten || typeof knoten.type !== "string") return knoten;
  if (knoten.type === "Identifier") return umbenannterName(knoten, abbildung, lage);
  const kopie = { ...knoten };
  for (const schluessel of VisitorKeys[knoten.type] ?? []) {
    kopie[schluessel] = umbenannt(knoten[schluessel], abbildung, { elter: knoten, schluessel });
  }
  return kurzschrift(knoten, kopie);
}

function ersatzFuer(plan, anweisung) {
  const abbildung = new Map(plan.parameter.map((name, stelle) => [name, plan.argumente[stelle]]));
  const wert = plan.wert && umbenannt(plan.wert, abbildung);
  return [...umbenannt(plan.rumpf, abbildung), ...plan.schluss(plan, anweisung, wert)];
}

function aufrufErhalten(anweisung, plan) {
  const aufruf = plan.aufrufIn(anweisung);
  const gleich =
    aufruf?.type === "CallExpression" &&
    aufruf.callee.type === "Identifier" &&
    aufruf.callee.name === plan.name;
  return gleich && aufruf.arguments.map(({ name }) => name).join() === plan.argumente.join();
}

function planFuer(anweisung, zerlegung) {
  const plan = zerlegung.plaene.get(bereichVon(anweisung));
  return plan && aufrufErhalten(anweisung, plan) ? plan : undefined;
}

function rumpfEinsetzen(knoten, zerlegung) {
  if (knoten.type !== "BlockStatement") return undefined;
  const plaene = knoten.body.map((anweisung) => planFuer(anweisung, zerlegung));
  if (plaene.every((plan) => plan === undefined)) return undefined;
  for (const plan of plaene.filter(Boolean)) zerlegung.eingesetzt.add(plan.name);
  const ersetzt = (anweisung, stelle) =>
    plaene[stelle] ? ersatzFuer(plaene[stelle], anweisung) : [anweisung];
  return { ...knoten, body: knoten.body.flatMap(ersetzt) };
}

function gestrichen(anweisung, zerlegung) {
  return anweisung.type === "FunctionDeclaration" && zerlegung.eingesetzt.has(anweisung.id.name);
}

function hilfenStreichen(knoten, zerlegung) {
  if (knoten.type !== "Program") return undefined;
  const body = knoten.body.filter((anweisung) => !gestrichen(anweisung, zerlegung));
  return body.length === knoten.body.length ? undefined : { ...knoten, body };
}

export function hilfeZerlegen(knoten, stand) {
  return rumpfEinsetzen(knoten, stand.zerlegung) ?? hilfenStreichen(knoten, stand.zerlegung);
}
