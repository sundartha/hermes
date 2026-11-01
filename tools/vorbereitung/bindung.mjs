import { FUNKTIONEN, NAME_ALS_SCHLUESSEL, bereichVon, geschriebeneKnoten, namenImMuster } from "./ast.mjs";

const BLOECKE = new Set([
  "BlockStatement",
  "Program",
  "StaticBlock",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "SwitchStatement",
]);
const VAR_GRENZEN = new Set([...FUNKTIONEN, "StaticBlock", "Program"]);
const KLASSEN = new Set(["ClassDeclaration", "ClassExpression"]);
const IMPORTE = new Set(["ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier"]);
const MARKEN = new Set(["LabeledStatement", "BreakStatement", "ContinueStatement"]);

export function umfasst(aussen, innen) {
  return aussen.range[0] <= innen.range[0] && innen.range[1] <= aussen.range[1];
}

function breite({ range }) {
  return range[1] - range[0];
}

function naechster(eltern, arten) {
  return eltern.findLast((elter) => arten.has(elter.type));
}

function eintrag({ name, key, art }, knoten) {
  return { name, key, art, knoten };
}

function funktionsDeklarationen(funktion, eltern) {
  const deklariert = funktion.type === "FunctionDeclaration";
  const ort = deklariert ? naechster(eltern, BLOECKE) : funktion;
  const art = deklariert ? "funktion" : "funktionsname";
  const eigener = funktion.id ? [eintrag({ name: funktion.id.name, key: ort, art }, funktion)] : [];
  const parameter = funktion.params.flatMap(namenImMuster);
  return [
    ...eigener,
    ...parameter.map((name) => eintrag({ name, key: funktion, art: "param" }, funktion)),
  ];
}

function variablenDeklarationen(deklaration, eltern) {
  const key = naechster(eltern, deklaration.kind === "var" ? VAR_GRENZEN : BLOECKE);
  const namen = deklaration.declarations.flatMap(({ id }) => namenImMuster(id));
  return namen.map((name) => eintrag({ name, key, art: deklaration.kind }, deklaration));
}

function klassenDeklaration(klasse, eltern) {
  const key = klasse.type === "ClassDeclaration" ? naechster(eltern, BLOECKE) : klasse;
  return klasse.id ? [eintrag({ name: klasse.id.name, key, art: "klasse" }, klasse)] : [];
}

function sonstigeDeklarationen(knoten, eltern) {
  if (KLASSEN.has(knoten.type)) return klassenDeklaration(knoten, eltern);
  if (IMPORTE.has(knoten.type))
    return [eintrag({ name: knoten.local.name, key: eltern[0], art: "import" }, knoten)];
  if (knoten.type !== "CatchClause") return [];
  return namenImMuster(knoten.param).map((name) =>
    eintrag({ name, key: knoten, art: "catch" }, knoten),
  );
}

function deklarationenVon({ knoten, eltern }) {
  if (FUNKTIONEN.has(knoten.type)) return funktionsDeklarationen(knoten, eltern);
  if (knoten.type === "VariableDeclaration") return variablenDeklarationen(knoten, eltern);
  return sonstigeDeklarationen(knoten, eltern);
}

function jeName(eintraege) {
  const tabelle = new Map();
  for (const [name, wert] of eintraege) tabelle.set(name, [...(tabelle.get(name) ?? []), wert]);
  return tabelle;
}

export function aufloesen(tabelle, stelle) {
  const treffer = (tabelle.get(stelle.name) ?? []).filter(({ key }) => umfasst(key, stelle));
  if (treffer.length === 0) return undefined;
  const innerster = treffer.reduce((links, rechts) =>
    breite(rechts.key) < breite(links.key) ? rechts : links,
  );
  return { key: innerster.key, deklarationen: treffer.filter(({ key }) => key === innerster.key) };
}

export function bindungsId(name, key) {
  return `${name}@${key.type}@${bereichVon(key)}`;
}

function istBezug({ knoten, eltern }) {
  const elter = eltern.at(-1);
  if (knoten.type !== "Identifier" || MARKEN.has(elter?.type)) return false;
  const schluessel = NAME_ALS_SCHLUESSEL[elter?.type];
  return !(schluessel && elter[schluessel] === knoten && !elter.computed);
}

function geschriebeneBindungen(schreibungen, tabelle) {
  const ids = schreibungen
    .map((stelle) => [stelle, aufloesen(tabelle, stelle)])
    .filter(([, bindung]) => bindung);
  return new Set(ids.map(([stelle, bindung]) => bindungsId(stelle.name, bindung.key)));
}

export function weltAus(programm, eintraege) {
  const alle = eintraege.flatMap(deklarationenVon);
  const tabelle = jeName(alle.map((eins) => [eins.name, eins]));
  const schreibungen = eintraege.flatMap(({ knoten }) => geschriebeneKnoten(knoten));
  const bezeichner = eintraege.filter(({ knoten }) => knoten.type === "Identifier");
  return {
    programm,
    alle,
    tabelle,
    bezuege: eintraege.filter(istBezug),
    bezeichner: jeName(bezeichner.map((eins) => [eins.knoten.name, eins])),
    geschriebeneIds: geschriebeneBindungen(schreibungen, tabelle),
  };
}
