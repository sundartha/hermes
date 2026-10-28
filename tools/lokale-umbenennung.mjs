import { besucheSyntaxbaum } from "./ziele/funktionen.mjs";

const ES_MODUL = /\.m?js$/;
const OBERSTE_EBENE = new Set(["global", "module"]);
const GIBT_NAMEN = new Set(["FunctionName", "ClassName"]);
const UNSICHERE_NAMEN = new Set(["eval", "arguments"]);
const OHNE_VERGLEICH = new Set(["parent", "range", "loc", "start", "end", "comments", "tokens"]);
const FREI_IM_VERGLEICH = { Identifier: "name", Property: "shorthand" };
const ANONYM = new Set(["ArrowFunctionExpression", "FunctionExpression", "ClassExpression"]);
const WERT_DES_ZIELS = { VariableDeclarator: "init", AssignmentExpression: "right", AssignmentPattern: "right" };

function fundstellen(variable) {
  return [...variable.identifiers, ...variable.references.map(({ identifier }) => identifier)];
}

function benenntWert({ parent: elter }) {
  const wert = elter[WERT_DES_ZIELS[elter.type]];
  return ANONYM.has(wert?.type) && !wert.id;
}

function umbenennbar(scope, variable) {
  if (OBERSTE_EBENE.has(scope.type) || variable.defs.some(({ type }) => GIBT_NAMEN.has(type))) return false;
  return !fundstellen(variable).some(benenntWert);
}

function bindungenIn({ scopes }) {
  const bindungen = new Map();
  for (const scope of scopes) {
    for (const variable of scope.variables) {
      const bindung = { variable, umbenennbar: umbenennbar(scope, variable) };
      for (const knoten of fundstellen(variable)) bindungen.set(knoten, [...(bindungen.get(knoten) ?? []), bindung]);
    }
  }
  return bindungen;
}

function gelesen(pfad, text) {
  let stand;
  besucheSyntaxbaum(pfad, text, (context) => ({
    "Program:exit": (programm) => {
      stand = { programm, bindungen: bindungenIn(context.sourceCode.scopeManager) };
    },
  }));
  return stand;
}

function istKnoten(wert) {
  return typeof wert === "object" && wert !== null;
}

function verglichen(knoten) {
  return Object.keys(knoten).filter((feld) => !OHNE_VERGLEICH.has(feld) && FREI_IM_VERGLEICH[knoten.type] !== feld);
}

function gleichBisAufNamen(links, rechts, paare) {
  if (!istKnoten(links) || !istKnoten(rechts)) return Object.is(links, rechts);
  paare.push([links, rechts]);
  const [felder, andere] = [verglichen(links), verglichen(rechts)];
  return felder.length === andere.length && felder.every((feld) => gleichBisAufNamen(links[feld], rechts[feld], paare));
}

function zugeordnet(links, rechts, { hin, her }) {
  const [frueher, spaeter] = [hin.get(links.variable) ?? rechts.variable, her.get(rechts.variable) ?? links.variable];
  hin.set(links.variable, rechts.variable);
  her.set(rechts.variable, links.variable);
  return frueher === rechts.variable && spaeter === links.variable;
}

function gleichGebunden(vorher, nachher, zuordnung) {
  return vorher.length === nachher.length && vorher.every((bindung, stelle) => zugeordnet(bindung, nachher[stelle], zuordnung));
}

function umbenanntePaare(paare, alt, neu) {
  const zuordnung = { hin: new Map(), her: new Map() };
  const umbenannt = new Set();
  for (const [links, rechts] of paare) {
    const [vorher, nachher] = [alt.bindungen.get(links) ?? [], neu.bindungen.get(rechts) ?? []];
    if (UNSICHERE_NAMEN.has(links.name) || !gleichGebunden(vorher, nachher, zuordnung)) return undefined;
    if (links.name === rechts.name) continue;
    if (vorher.length === 0 || !vorher.every((bindung) => bindung.umbenennbar)) return undefined;
    for (const { variable } of vorher) umbenannt.add(variable);
  }
  return umbenannt.size;
}

export function lokaleUmbenennung({ pfad, vorher, nachher }) {
  if (!ES_MODUL.test(pfad)) return null;
  const [alt, neu] = [gelesen(pfad, vorher), gelesen(pfad, nachher)];
  if (alt === undefined || neu === undefined) return null;
  const paare = [];
  const namen = gleichBisAufNamen(alt.programm, neu.programm, paare) ? umbenanntePaare(paare, alt, neu) : undefined;
  return namen > 0 ? { namen } : null;
}
