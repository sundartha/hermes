import { VisitorKeys } from "espree";

const POSITIONSFELDER = new Set(["range", "start", "end", "loc", "comments", "tokens"]);
const REINE_OPERATOREN = new Set(["typeof", "!", "===", "!==", "&&", "||"]);
const NIE_SYMBOL = new Set(["Literal", "TemplateLiteral", "UnaryExpression", "BinaryExpression", "UpdateExpression"]);
const ZWEIG_PAARE = { LogicalExpression: ["left", "right"], ConditionalExpression: ["consequent", "alternate"] };
const BINDUNG_IN_LISTE = { ObjectPattern: "properties", ArrayPattern: "elements" };
const BINDUNG_IN_FELD = { Property: "value", AssignmentPattern: "left", RestElement: "argument" };
const FUNKTIONEN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const NUR_NAME = { VariableDeclarator: "id", ClassDeclaration: "id", ClassExpression: "id", CatchClause: "param" };
const IMPORTE = new Set(["ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier"]);
const EXPORTE = new Set(["ExportNamedDeclaration", "ExportDefaultDeclaration"]);
const SCHLEIFEN = new Set(["ForInStatement", "ForOfStatement"]);
const UNSICHERE_NAMEN = new Set(["eval", "arguments"]);
const VAR_GRENZEN = new Set([...FUNKTIONEN, "StaticBlock", "Program"]);
const EINZIGE = 1;
const ZWEI = 2;
const LAENGE = "length";

function namenImMuster(muster) {
  if (!muster) return [];
  if (muster.type === "Identifier") return [muster.name];
  const liste = BINDUNG_IN_LISTE[muster.type];
  if (liste) return muster[liste].flatMap(namenImMuster);
  const feld = BINDUNG_IN_FELD[muster.type];
  return feld ? namenImMuster(muster[feld]) : [];
}

function mitEltern(knoten, eltern = [], gesammelt = []) {
  gesammelt.push({ knoten, eltern });
  for (const schluessel of VisitorKeys[knoten.type] ?? []) {
    for (const kind of [knoten[schluessel]].flat().filter(Boolean)) mitEltern(kind, [...eltern, knoten], gesammelt);
  }
  return gesammelt;
}

function umgebung(eltern, tiefe) {
  const elter = eltern.at(-tiefe);
  return EXPORTE.has(elter?.type) ? eltern.at(-tiefe - EINZIGE) : elter;
}

function bindungsOrt(knoten, eltern) {
  if (knoten.type === "ClassDeclaration") return umgebung(eltern, EINZIGE);
  if (knoten.type !== "VariableDeclarator") return knoten;
  if (eltern.at(-EINZIGE).kind !== "var") return umgebung(eltern, ZWEI);
  const grenze = eltern.findLast((vorfahr) => VAR_GRENZEN.has(vorfahr.type));
  return FUNKTIONEN.has(grenze.type) ? grenze.body : grenze;
}

function gebundeneNamen({ knoten, eltern }) {
  const mitOrt = (namen, ort) => namen.map((name) => ({ name, ort }));
  if (FUNKTIONEN.has(knoten.type)) {
    const ortDesNamens = knoten.type === "FunctionDeclaration" ? umgebung(eltern, EINZIGE) : knoten;
    return [...mitOrt(namenImMuster(knoten.id), ortDesNamens), ...mitOrt(knoten.params.flatMap(namenImMuster), knoten)];
  }
  if (IMPORTE.has(knoten.type)) return mitOrt([knoten.local.name], eltern[0]);
  const feld = NUR_NAME[knoten.type];
  return feld ? mitOrt(namenImMuster(knoten[feld]), bindungsOrt(knoten, eltern)) : [];
}

function geschriebeneNamen(knoten) {
  if (knoten.type === "AssignmentExpression") return namenImMuster(knoten.left);
  if (knoten.type === "UpdateExpression") return namenImMuster(knoten.argument);
  return SCHLEIFEN.has(knoten.type) && knoten.left.type !== "VariableDeclaration" ? namenImMuster(knoten.left) : [];
}

function obersteDeklarationen(programm) {
  return programm.body.map((anweisung) => (EXPORTE.has(anweisung.type) ? anweisung.declaration : anweisung));
}

function reinerAusdruck(knoten, parameter) {
  if (knoten.type === "Literal") return knoten.regex === undefined;
  if (knoten.type === "Identifier") return knoten.name === parameter;
  if (!REINE_OPERATOREN.has(knoten.operator)) return false;
  if (knoten.type === "UnaryExpression") return reinerAusdruck(knoten.argument, parameter);
  const zweistellig = knoten.type === "BinaryExpression" || knoten.type === "LogicalExpression";
  return zweistellig && reinerAusdruck(knoten.left, parameter) && reinerAusdruck(knoten.right, parameter);
}

function zuerstGelesen(ausdruck, parameter) {
  let knoten = ausdruck;
  while (knoten.type !== "Identifier") {
    const naechster = knoten.type === "UnaryExpression" ? knoten.argument : knoten.left;
    if (!naechster) return false;
    knoten = naechster;
  }
  return knoten.name === parameter;
}

function einfacheFunktion(deklaration) {
  if (deklaration?.type !== "FunctionDeclaration" || !deklaration.id) return false;
  return !deklaration.async && !deklaration.generator && deklaration.params.length === EINZIGE;
}

function rueckgabe(rumpf) {
  const [anweisung, ...rest] = rumpf.body;
  return rest.length === 0 && anweisung?.type === "ReturnStatement" ? anweisung.argument : undefined;
}

function hilfeAus(deklaration) {
  if (!einfacheFunktion(deklaration)) return undefined;
  const [parameter] = deklaration.params;
  const ausdruck = rueckgabe(deklaration.body);
  if (parameter.type !== "Identifier" || !ausdruck) return undefined;
  return zuerstGelesen(ausdruck, parameter.name) && reinerAusdruck(ausdruck, parameter.name)
    ? { name: deklaration.id.name, parameter: parameter.name, ausdruck }
    : undefined;
}

function konstantenAus(deklarationen) {
  const konstanten = deklarationen.filter((deklaration) => deklaration?.type === "VariableDeclaration" && deklaration.kind === "const");
  const mitWert = konstanten.flatMap(({ declarations }) => declarations).filter(({ id, init }) => id.type === "Identifier" && init);
  return new Map(mitWert.map(({ id, init }) => [id.name, init]));
}

function orteJeName(bindungen) {
  const orte = new Map();
  for (const { name, ort } of bindungen) orte.set(name, [...(orte.get(name) ?? []), ort]);
  return orte;
}

export function fakten(programm) {
  const eintraege = mitEltern(programm);
  const knoten = eintraege.map((eintrag) => eintrag.knoten);
  const deklarationen = obersteDeklarationen(programm);
  const hilfen = deklarationen.map(hilfeAus).filter(Boolean);
  return {
    gebunden: orteJeName(eintraege.flatMap(gebundeneNamen)),
    geschrieben: new Set(knoten.flatMap(geschriebeneNamen)),
    konstanten: konstantenAus(deklarationen),
    hilfen: new Map(hilfen.map((hilfe) => [hilfe.name, hilfe])),
    unsicher: knoten.some(({ type, name }) => type === "WithStatement" || UNSICHERE_NAMEN.has(name)),
  };
}

function einmalGebunden(stand, name) {
  return stand.gebunden.get(name)?.length === EINZIGE;
}

function lokalAn(stand, stelle) {
  if (stand.unsicher || !stelle.range) return false;
  const orte = stand.gebunden.get(stelle.name) ?? [];
  return orte.some(({ range: bereich }) => bereich[0] <= stelle.range[0] && stelle.range[1] <= bereich[1]);
}

function einzigesArgument(aufruf) {
  const [argument, ...rest] = aufruf.arguments;
  return rest.length === 0 && argument !== undefined && argument.type !== "SpreadElement" ? argument : undefined;
}

function eingebauterAufruf(knoten, name, stand) {
  if (knoten.type !== "CallExpression" || knoten.optional || knoten.callee.type !== "Identifier") return false;
  const eingebaut = !stand.gebunden.has(name) && !stand.geschrieben.has(name) && !stand.unsicher;
  return knoten.callee.name === name && eingebaut && einzigesArgument(knoten) !== undefined;
}

function konstanteNieSymbol(knoten, stand, besucht) {
  if (knoten.type !== "Identifier" || besucht.has(knoten.name) || !einmalGebunden(stand, knoten.name)) return false;
  const wert = stand.konstanten.get(knoten.name);
  return wert !== undefined && nieSymbol(wert, stand, new Set([...besucht, knoten.name]));
}

function nieSymbol(knoten, stand, besucht = new Set()) {
  if (NIE_SYMBOL.has(knoten.type) || eingebauterAufruf(knoten, "String", stand)) return true;
  const zweige = ZWEIG_PAARE[knoten.type];
  if (zweige) return zweige.every((feld) => nieSymbol(knoten[feld], stand, besucht));
  return konstanteNieSymbol(knoten, stand, besucht);
}

function vorlageString(knoten, stand) {
  if (knoten.type !== "TemplateLiteral") return undefined;
  const passt = (teil) => eingebauterAufruf(teil, "String", stand) && nieSymbol(teil.arguments[0], stand);
  if (!knoten.expressions.some(passt)) return undefined;
  return { ...knoten, expressions: knoten.expressions.map((teil) => (passt(teil) ? teil.arguments[0] : teil)) };
}

function nicht(knoten) {
  return knoten?.type === "UnaryExpression" && knoten.operator === "!" ? knoten.argument : undefined;
}

function wahrheitswert(knoten, stand) {
  if (eingebauterAufruf(knoten, "Boolean", stand)) return knoten.arguments[0];
  return nicht(knoten)?.type === "UnaryExpression" ? nicht(nicht(knoten)) : undefined;
}

function literal(wert) {
  return { type: "Literal", value: wert, raw: String(wert) };
}

function booleanVerknuepfung(knoten, stand) {
  if (knoten.type !== "LogicalExpression" || knoten.operator === "??") return undefined;
  const test = wahrheitswert(knoten.left, stand);
  if (test === undefined) return undefined;
  const und = knoten.operator === "&&";
  return {
    type: "ConditionalExpression",
    test,
    consequent: und ? knoten.right : literal(true),
    alternate: und ? literal(false) : knoten.right,
  };
}

function laengeVon(zugriff, name) {
  if (zugriff?.type !== "MemberExpression" || zugriff.computed || zugriff.optional) return false;
  const { object: objekt, property: eigenschaft } = zugriff;
  return eigenschaft.type === "Identifier" && eigenschaft.name === LAENGE && objekt.type === "Identifier" && objekt.name === name;
}

function laengeOptional(knoten, stand) {
  if (knoten.type !== "LogicalExpression" || knoten.operator !== "||" || stand.unsicher) return undefined;
  const name = nicht(knoten.left);
  if (name?.type !== "Identifier" || !lokalAn(stand, name)) return undefined;
  const zugriff = nicht(knoten.right);
  if (!laengeVon(zugriff, name.name)) return undefined;
  return { ...knoten.right, argument: { type: "ChainExpression", expression: { ...zugriff, optional: true } } };
}

function eingesetzt(ausdruck, parameter, argument) {
  if (ausdruck.type === "Identifier" && ausdruck.name === parameter) return { ...argument };
  const kopie = { ...ausdruck };
  for (const schluessel of VisitorKeys[ausdruck.type] ?? []) {
    if (kopie[schluessel]) kopie[schluessel] = eingesetzt(kopie[schluessel], parameter, argument);
  }
  return kopie;
}

function festerName(stand, stelle) {
  return lokalAn(stand, stelle) && !stand.geschrieben.has(stelle.name);
}

function hilfeZu(knoten, stand) {
  if (knoten.type !== "CallExpression" || knoten.optional || stand.unsicher) return undefined;
  return knoten.callee.type === "Identifier" ? stand.hilfen.get(knoten.callee.name) : undefined;
}

function hilfeEinsetzen(knoten, stand) {
  const hilfe = hilfeZu(knoten, stand);
  const argument = hilfe ? einzigesArgument(knoten) : undefined;
  if (!hilfe || argument?.type !== "Identifier") return undefined;
  const fest = einmalGebunden(stand, hilfe.name) && !stand.geschrieben.has(hilfe.name) && festerName(stand, argument);
  return fest ? eingesetzt(hilfe.ausdruck, hilfe.parameter, argument) : undefined;
}

export const REGELN = {
  "vorlage-string": vorlageString,
  "boolean-verknuepfung": booleanVerknuepfung,
  "laenge-optional": laengeOptional,
  "hilfe-einsetzen": hilfeEinsetzen,
};

function regelAnwenden(knoten, lauf) {
  for (const [id, regel] of Object.entries(REGELN)) {
    const ersetzt = regel(knoten, lauf.stand);
    if (ersetzt === undefined) continue;
    lauf.genutzt.set(id, (lauf.genutzt.get(id) ?? 0) + EINZIGE);
    return ersetzt;
  }
  return undefined;
}

function kinderUmgeformt(knoten, lauf) {
  const kopie = { ...knoten };
  for (const schluessel of VisitorKeys[knoten.type] ?? []) {
    const getaggt = knoten.type === "TaggedTemplateExpression" && schluessel === "quasi";
    kopie[schluessel] = getaggt ? kinderUmgeformt(kopie.quasi, lauf) : umgeformt(kopie[schluessel], lauf);
  }
  return kopie;
}

function umgeformt(knoten, lauf) {
  if (Array.isArray(knoten)) return knoten.map((teil) => umgeformt(teil, lauf));
  if (!knoten || typeof knoten.type !== "string") return knoten;
  const kopie = kinderUmgeformt(knoten, lauf);
  const ersetzt = regelAnwenden(kopie, lauf);
  return ersetzt === undefined ? kopie : umgeformt(ersetzt, lauf);
}

export function normalform(programm) {
  const lauf = { stand: fakten(programm), genutzt: new Map() };
  return { baum: umgeformt(programm, lauf), genutzt: lauf.genutzt };
}

export function vergleichstext(wert) {
  if (typeof wert === "bigint") return JSON.stringify(`${wert}n`);
  if (wert instanceof RegExp) return JSON.stringify(String(wert));
  if (Array.isArray(wert)) return `[${wert.map(vergleichstext).join(",")}]`;
  if (wert === null || typeof wert !== "object") return JSON.stringify(wert) ?? "null";
  const felder = Object.keys(wert).filter((schluessel) => !POSITIONSFELDER.has(schluessel)).toSorted();
  return `{${felder.map((schluessel) => `${JSON.stringify(schluessel)}:${vergleichstext(wert[schluessel])}`).join(",")}}`;
}

function gleicheForm(links, rechts) {
  if (!links || !rechts || typeof links !== "object" || typeof rechts !== "object") return false;
  return Array.isArray(links) ? links.length === rechts.length : links.type === rechts.type;
}

export function ersteAbweichung(links, rechts, ort = rechts) {
  if (vergleichstext(links) === vergleichstext(rechts)) return undefined;
  const hier = rechts?.range === undefined ? ort : rechts;
  if (!gleicheForm(links, rechts)) return hier;
  const felder = Object.keys(rechts).filter((feld) => !POSITIONSFELDER.has(feld));
  return felder.map((feld) => ersteAbweichung(links[feld], rechts[feld], hier)).find(Boolean) ?? hier;
}
