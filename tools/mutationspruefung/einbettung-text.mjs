import * as espree from "espree";

const OPTIONEN = { ecmaVersion: "latest", sourceType: "module", range: true };
const HELFER_NAMEN = /stry[A-Za-z]+_9fa48/g;
const MUTANT_AUFRUF = /stryMutAct_9fa48\("([^"]+)"\)/g;
const BEKANNTE_HELFER = new Set(["stryMutAct_9fa48", "stryCov_9fa48"]);
const OHNE_NAMEN = "(ohne Namen)";

export function enthaeltHelfer(text) {
  return new RegExp(HELFER_NAMEN.source).test(text);
}

export function mutantenIn(text) {
  return [...new Set([...text.matchAll(MUTANT_AUFRUF)].map(([, kennung]) => kennung))];
}

function besuche(knoten, beiKnoten) {
  if (Array.isArray(knoten)) {
    for (const kind of knoten) besuche(kind, beiKnoten);
    return;
  }
  if (knoten === null || typeof knoten !== "object") return;
  beiKnoten(knoten);
  for (const kind of Object.values(knoten)) besuche(kind, beiKnoten);
}

export function deklarationen(quelltext) {
  const gefunden = new Map();
  besuche(espree.parse(quelltext, OPTIONEN), (knoten) => {
    if (knoten.type !== "FunctionDeclaration" || knoten.id === null) return;
    const [anfang, ende] = knoten.range;
    gefunden.set(knoten.id.name, [...(gefunden.get(knoten.id.name) ?? []), quelltext.slice(anfang, ende)]);
  });
  return gefunden;
}

function originalText(tabelle, name, datei) {
  const treffer = tabelle.get(name) ?? [];
  if (treffer.length === 0) throw new Error(`Einbettung: ${name || OHNE_NAMEN} ist in ${datei} keine Funktionsdeklaration, der Originaltext ist nicht zu finden`);
  if (treffer.length > 1) throw new Error(`Einbettung: ${name} ist in ${datei} mehrdeutig, ${treffer.length} Funktionsdeklarationen tragen den Namen`);
  return treffer[0];
}

function aeussereFunktion(text) {
  let erste;
  besuche(espree.parse(`(${text})`, OPTIONEN), (knoten) => {
    if (erste === undefined && knoten.type === "FunctionExpression") erste = knoten;
  });
  const [anfang, ende] = erste?.range ?? [];
  if (anfang !== 1 || ende !== text.length + 1) throw new Error("Einbettung: eingebettet wird nur eine Funktion mit Rumpf in function-Schreibweise");
  return erste;
}

function einfuegestelle(text) {
  const rumpf = aeussereFunktion(text).body;
  const direktiven = rumpf.body.filter((anweisung) => anweisung.directive !== undefined);
  return direktiven.length === 0 ? rumpf.range[0] : direktiven.at(-1).range[1] - 1;
}

function mitHelfern(text, aktiv) {
  const fremde = text.match(HELFER_NAMEN).filter((name) => !BEKANNTE_HELFER.has(name));
  if (fremde.length > 0) throw new Error(`Einbettung: unbekannter Stryker-Helfer im eingebetteten Text: ${[...new Set(fremde)].join(", ")}`);
  const stelle = einfuegestelle(text);
  const helfer = ` var stryMutAct_9fa48 = function (kennung) { return kennung === ${JSON.stringify(aktiv)}; }; var stryCov_9fa48 = function () {};`;
  return text.slice(0, stelle) + helfer + text.slice(stelle);
}

export function eingebetteterText({ text, name, aktiv, tabelle, datei }) {
  if (mutantenIn(text).includes(aktiv)) return mitHelfern(text, aktiv);
  return originalText(tabelle(), name, datei);
}
