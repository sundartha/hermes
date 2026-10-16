import { isDeepStrictEqual } from "node:util";

import { gelesen } from "../syntaxbaum.mjs";

const TESTAUFRUFE = new Set(["test", "it"]);
const ZUSICHERUNG = "assert";
const ERWARTUNG = "expect";
const LEERRAUM = /\s+/g;
const ABSCHALTUNGEN = new Set(["skip", "todo"]);
const FUNKTIONEN = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);
const ABBRUECHE = new Set(["ReturnStatement", "ThrowStatement", "BreakStatement", "ContinueStatement"]);
const KLASSEN = new Set(["ClassDeclaration", "ClassExpression"]);
const AUSSERHALB = "außerhalb";
const STEUERUNG = new Set([
  "IfStatement",
  "LabeledStatement",
  "ConditionalExpression",
  "LogicalExpression",
  "TryStatement",
  "CatchClause",
  "SwitchCase",
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "AwaitExpression",
]);
const MODUL = { ecmaVersion: "latest", sourceType: "module" };
const TESTBIBLIOTHEK = /^(node:)?(test|assert)(\/|$)/;
const DEKLARATIONEN = new Set(["const", "let"]);
const ROHWERTE = new Set(["Literal", "Identifier", ...FUNKTIONEN]);
const FALLRUMPF = "⟨Fall⟩";
const UMWEGE = new Set([
  "require",
  "createRequire",
  "getBuiltinModule",
  "globalThis",
  "global",
  "process",
  "Reflect",
  "Proxy",
  "eval",
  "Function",
  "Object",
  "defineProperty",
  "defineProperties",
  "assign",
  "setPrototypeOf",
  "__proto__",
  "constructor",
]);
const CODEMODULE = /^(node:)?(vm|module|worker_threads|child_process|inspector|repl)$/;
const FRISCHE_WERTE = new Set(["ObjectExpression", "ArrayExpression"]);
const DYNAMISCHER_IMPORT = "import()";
const TESTHUELLEN = new Set(["test", "it", "describe", "suite", "skip", "only", "todo", "before", "after", "beforeEach", "afterEach"]);
const TESTOPTIONEN = new Set(["skip", "todo", "only", "timeout", "signal", "concurrency", "plan"]);
const BERECHNETER_ZUGRIFF = "x[berechnet]";
const AUFRUFE = new Set(["CallExpression", "NewExpression"]);

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

function quelltext(knoten, ziel) {
  return ziel.quelle.slice(...knoten.range).replace(LEERRAUM, " ");
}

function istZusicherung(kette) {
  return kette[0] === ERWARTUNG || kette.includes(ZUSICHERUNG);
}

function prueft(kette, hilfen) {
  return istZusicherung(kette) || hilfen.has(kette[0]);
}

function aufrufForm(knoten, ziel, argumente = knoten.arguments.slice(1)) {
  const optionen = argumente.filter(({ type }) => !FUNKTIONEN.has(type));
  return [knoten.callee, ...optionen].map((teil) => quelltext(teil, ziel)).join(" ");
}

function steuerung(knoten, ziel) {
  const bedingung = knoten.test ?? knoten.left ?? knoten.label;
  return bedingung ? `${knoten.type}(${quelltext(bedingung, ziel)})` : knoten.type;
}

function eintrag({ fall, weg }, text) {
  return `${fall}: ${[...weg, text].join(" > ")}`;
}

function weiter(stand, schritt) {
  return schritt === undefined ? stand : { ...stand, weg: [...stand.weg, schritt] };
}

function schrittDes(knoten, ziel) {
  if (STEUERUNG.has(knoten.type)) return steuerung(knoten, ziel);
  return FUNKTIONEN.has(knoten.type) ? knoten.type : undefined;
}

function sammleTeile(knoten, stand, ziel) {
  for (const teil of Object.values(knoten)) sammle(teil, stand, ziel);
}

function gebundenDurch(teil) {
  if (teil.type === "VariableDeclarator") return [teil.id, teil.init];
  if (teil.type === "AssignmentExpression") return [teil.left, teil.right];
  if (KLASSEN.has(teil.type)) return [teil.id];
  if (teil.type === "CatchClause") return [teil.param];
  return FUNKTIONEN.has(teil.type) ? [teil.id, ...teil.params] : [];
}

function istPruefname(name, ziel) {
  return ziel.wurzeln.has(name) || ziel.hilfen.has(name);
}

function bindetZusicherung(teil, ziel) {
  return [...knoten(gebundenDurch(teil))].some(({ type, name }) => type === "Identifier" && istPruefname(name, ziel));
}

function bindungsText(teil, ziel) {
  if (teil.type === "CatchClause") return `catch (${quelltext(teil.param, ziel)})`;
  if (!FUNKTIONEN.has(teil.type)) return quelltext(teil, ziel);
  return `Funktion ${teil.id?.name ?? ""}(${teil.params.map((parameter) => quelltext(parameter, ziel)).join(", ")})`;
}

function reichtPruefnamenWeiter(aufruf, ziel) {
  return aufruf.arguments.some((argument) => istPruefname(namen(argument)[0], ziel));
}

function notiereBindung(teil, stand, ziel) {
  if (bindetZusicherung(teil, ziel)) ziel.ergebnis.push(eintrag(stand, bindungsText(teil, ziel)));
}

function sammleFall(aufruf, umgebung, ziel) {
  const [titel] = titelDes(aufruf);
  ziel.ergebnis.push(eintrag({ fall: `Fall ${titel}`, weg: umgebung.weg }, aufrufForm(aufruf, ziel)));
  const stand = { fall: titel, weg: [] };
  for (const teil of aufruf.arguments) {
    notiereBindung(teil, stand, ziel);
    sammle(FUNKTIONEN.has(teil.type) ? teil.body : teil, stand, ziel);
  }
}

function sammleAufruf(knoten, stand, ziel) {
  if (titelDes(knoten).length > 0) {
    sammleFall(knoten, stand, ziel);
    return;
  }
  const kette = namen(knoten.callee);
  if (prueft(kette, ziel.hilfen) || reichtPruefnamenWeiter(knoten, ziel)) {
    ziel.ergebnis.push(eintrag(stand, quelltext(knoten, ziel)));
    return;
  }
  const aufruf = quelltext(knoten.callee, ziel);
  if (ABSCHALTUNGEN.has(kette.at(-1))) ziel.ergebnis.push(eintrag(stand, aufruf));
  sammle(knoten.callee, stand, ziel);
  sammle(knoten.arguments, weiter(stand, `Aufruf(${aufrufForm(knoten, ziel, knoten.arguments)})`), ziel);
}

function sammle(wert, stand, ziel) {
  if (Array.isArray(wert)) {
    for (const teil of wert) sammle(teil, stand, ziel);
    return;
  }
  if (typeof wert?.type !== "string") return;
  if (wert.type === "CallExpression") {
    sammleAufruf(wert, stand, ziel);
    return;
  }
  if (ABBRUECHE.has(wert.type) && (stand.fall !== AUSSERHALB || stand.zusichernd)) ziel.ergebnis.push(eintrag(stand, wert.type));
  notiereBindung(wert, stand, ziel);
  const tiefer = weiter(stand, schrittDes(wert, ziel));
  sammleTeile(wert, FUNKTIONEN.has(wert.type) ? { ...tiefer, zusichernd: enthaeltZusicherung(wert, ziel.hilfen) } : tiefer, ziel);
}

function enthaeltZusicherung(funktion, hilfen) {
  return [...knoten(funktion.body)].some(({ type, callee }) => type === "CallExpression" && prueft(namen(callee), hilfen));
}

function benannteFunktion(teil) {
  if (teil.type === "FunctionDeclaration" && teil.id) return [[teil.id.name, teil]];
  const funktion = teil.type === "VariableDeclarator" && teil.id.type === "Identifier" && FUNKTIONEN.has(teil.init?.type);
  return funktion ? [[teil.id.name, teil.init]] : [];
}

function hilfenMitZusicherung(baum) {
  const kandidaten = [...knoten(baum)].flatMap(benannteFunktion);
  const hilfen = new Set();
  let bekannt = -1;
  while (hilfen.size !== bekannt) {
    bekannt = hilfen.size;
    for (const [name, funktion] of kandidaten) if (enthaeltZusicherung(funktion, hilfen)) hilfen.add(name);
  }
  return hilfen;
}

function wurzelnDerZusicherungen(baum) {
  const ketten = [...knoten(baum)].filter(({ type }) => type === "CallExpression").map(({ callee }) => namen(callee));
  return new Set(ketten.filter(istZusicherung).map(([wurzel]) => wurzel));
}

function bringtZusicherung({ source, specifiers }) {
  return String(source.value).includes(ZUSICHERUNG) || specifiers.some(({ local }) => [ZUSICHERUNG, ERWARTUNG].includes(local.name));
}

function zusicherungsImporte(baum, ziel) {
  const importe = baum.body.filter((teil) => teil.type === "ImportDeclaration" && bringtZusicherung(teil));
  return importe.map((teil) => eintrag({ fall: AUSSERHALB, weg: [] }, quelltext(teil, ziel)));
}

function zusicherungenJeFall(quelle) {
  const baum = gelesen(quelle, MODUL);
  if (baum === undefined) return null;
  const ziel = { quelle, ergebnis: [], wurzeln: wurzelnDerZusicherungen(baum), hilfen: hilfenMitZusicherung(baum) };
  sammle(baum.body, { fall: AUSSERHALB, weg: [] }, ziel);
  return [...ziel.ergebnis, ...zusicherungsImporte(baum, ziel)].sort();
}

function fallFunktionen(wert) {
  const faelle = [...knoten(wert)].filter((teil) => titelDes(teil).length > 0);
  const funktionen = faelle.flatMap(({ arguments: argumente }) => argumente.filter(({ type }) => FUNKTIONEN.has(type)));
  return funktionen.sort((links, rechts) => links.range[0] - rechts.range[0]);
}

function fallRuempfe(anweisung) {
  const ruempfe = fallFunktionen(anweisung);
  const innen = (rumpf) => ruempfe.some((aussen) => aussen !== rumpf && aussen.range[0] <= rumpf.range[0] && rumpf.range[1] <= aussen.range[1]);
  return ruempfe.filter((rumpf) => !innen(rumpf));
}

function geruest(anweisung, quelle) {
  const teile = [];
  let stelle = anweisung.range[0];
  for (const rumpf of fallRuempfe(anweisung)) {
    teile.push(quelle.slice(stelle, rumpf.range[0]), FALLRUMPF);
    stelle = rumpf.range[1];
  }
  const text = [...teile, quelle.slice(stelle, anweisung.range[1])].join("");
  return text.replace(LEERRAUM, " ");
}

function rein(ausdruck) {
  if (ausdruck === null || ROHWERTE.has(ausdruck.type)) return true;
  if (ausdruck.type === "TemplateLiteral") return ausdruck.expressions.length === 0;
  if (ausdruck.type === "UnaryExpression") return ausdruck.operator === "-" && ausdruck.argument.type === "Literal";
  if (ausdruck.type === "ArrayExpression") return ausdruck.elements.every(rein);
  return ausdruck.type === "ObjectExpression" && ausdruck.properties.every(({ type, kind, computed, value }) => type === "Property" && kind === "init" && !computed && rein(value));
}

function schluessel({ key }) {
  return key.type === "Identifier" ? key.name : String(key.value);
}

function gleicherText(vorher, nachher, quellen) {
  const text = (teil, quelle) => (teil ? quelle.slice(...teil.range).replace(LEERRAUM, " ") : "");
  return text(vorher, quellen.alt) === text(nachher, quellen.neu);
}

function objektErgaenzt(vorher, nachher, quellen) {
  const neue = new Map(nachher.properties.map((eigenschaft) => [schluessel(eigenschaft), eigenschaft]));
  if (neue.size !== nachher.properties.length) return false;
  return vorher.properties.every((eigenschaft) => neue.has(schluessel(eigenschaft)) && enthaelt(eigenschaft.value, neue.get(schluessel(eigenschaft)).value, quellen));
}

function enthaelt(vorher, nachher, quellen) {
  if (vorher?.type === "ObjectExpression" && nachher?.type === "ObjectExpression") return objektErgaenzt(vorher, nachher, quellen);
  if (vorher?.type === "ArrayExpression" && nachher?.type === "ArrayExpression") {
    return nachher.elements.length >= vorher.elements.length && vorher.elements.every((element, stelle) => gleicherText(element, nachher.elements[stelle], quellen));
  }
  return gleicherText(vorher, nachher, quellen);
}

function wertErgaenzt(vorher, nachher, quellen) {
  const gleicherName = vorher.id.type === "Identifier" && nachher.id.type === "Identifier" && vorher.id.name === nachher.id.name;
  return gleicherName && rein(vorher.init) && rein(nachher.init) && enthaelt(vorher.init, nachher.init, quellen);
}

function bezeichner(wert) {
  return [...knoten(wert)].filter(({ type }) => type === "Identifier").map(({ name }) => name);
}

function rueckrufe({ arguments: argumente }) {
  return argumente.filter(({ type }) => FUNKTIONEN.has(type));
}

function bindungen(teil) {
  if (teil.type === "VariableDeclarator") return [[teil.id, teil.init]];
  if (teil.type === "FunctionDeclaration") return [[teil.id, teil]];
  if (teil.type === "ForOfStatement" || teil.type === "ForInStatement") return [[teil.left, teil.right]];
  return teil.type === "CallExpression" ? rueckrufe(teil).map(({ params }) => [params, teil.callee]) : [];
}

function herkunft(baum) {
  const werte = new Map();
  for (const [ziel, wert] of [...knoten(baum)].flatMap(bindungen)) for (const name of bezeichner(ziel)) werte.set(name, [...(werte.get(name) ?? []), wert]);
  return werte;
}

function mitHerkunft(namen, baum) {
  const werte = herkunft(baum);
  for (const name of namen) for (const wert of werte.get(name) ?? []) for (const weiter of bezeichner(wert)) namen.add(weiter);
  return namen;
}

function testOptionen(baum) {
  const huellen = [...knoten(baum)].filter(({ type, callee }) => type === "CallExpression" && TESTHUELLEN.has(namen(callee).at(-1)));
  const argumente = huellen.flatMap(({ arguments: liste }) => liste.filter(({ type }) => !FUNKTIONEN.has(type)));
  return mitHerkunft(new Set(argumente.flatMap(bezeichner)), baum);
}

function argumenteDerKette(ausdruck) {
  if (ausdruck.type === "MemberExpression") return argumenteDerKette(ausdruck.object);
  return ausdruck.type === "CallExpression" ? [...ausdruck.arguments, ...argumenteDerKette(ausdruck.callee)] : [];
}

function* ausserhalbVonAufrufen(wert) {
  if (Array.isArray(wert)) for (const teil of wert) yield* ausserhalbVonAufrufen(teil);
  else if (typeof wert?.type === "string") {
    if (wert.type === "Identifier") yield wert.name;
    yield* ausserhalbVonAufrufen(AUFRUFE.has(wert.type) ? wert.callee : Object.values(wert));
  }
}

function erwartungen(baum) {
  const hilfen = hilfenMitZusicherung(baum);
  const zusicherungen = [...knoten(baum)].filter(({ type, callee }) => type === "CallExpression" && prueft(namen(callee), hilfen));
  return mitHerkunft(new Set(zusicherungen.flatMap((aufruf) => [...ausserhalbVonAufrufen(argumenteDerKette(aufruf))])), baum);
}

function deklarationErgaenzt(vorher, nachher, quellen) {
  const beide = vorher.type === "VariableDeclaration" && nachher.type === "VariableDeclaration";
  if (!beide || vorher.kind !== nachher.kind || !DEKLARATIONEN.has(vorher.kind)) return false;
  if (vorher.declarations.some(({ id }) => bezeichner(id).some((name) => quellen.gesperrt.has(name)))) return false;
  const { declarations: neue } = nachher;
  return vorher.declarations.length === neue.length && vorher.declarations.every((deklaration, stelle) => wertErgaenzt(deklaration, neue[stelle], quellen));
}

function entspricht(vorher, nachher, quellen) {
  return geruest(vorher, quellen.alt) === geruest(nachher, quellen.neu) || deklarationErgaenzt(vorher, nachher, quellen);
}

function zugelasseneForm(anweisung) {
  if (anweisung.type === "ImportDeclaration") return anweisung.specifiers.length > 0 && !TESTBIBLIOTHEK.test(String(anweisung.source.value));
  if (anweisung.type === "FunctionDeclaration") return true;
  return anweisung.type === "VariableDeclaration" && anweisung.kind === "const" && anweisung.declarations.every(({ id, init }) => id.type === "Identifier" && rein(init));
}

function neueNamen(anweisung) {
  if (anweisung.type === "ImportDeclaration") return anweisung.specifiers.flatMap(({ local }) => bezeichner(local));
  return bezeichner(anweisung.type === "FunctionDeclaration" ? anweisung.id : anweisung.declarations.map(({ id }) => id));
}

function zugelassenNeu(anweisung, alteNamen) {
  return zugelasseneForm(anweisung) && !neueNamen(anweisung).some((name) => alteNamen.has(name));
}

function obersteEbeneGleich(alte, neue, quellen) {
  const alteNamen = new Set(bezeichner(alte));
  let offen = 0;
  for (const anweisung of neue) {
    if (offen < alte.length && entspricht(alte[offen], anweisung, quellen)) offen += 1;
    else if (!zugelassenNeu(anweisung, alteNamen)) return false;
  }
  return offen === alte.length;
}

function fallKopf({ range: [anfang], body }, quelle) {
  const kopf = quelle.slice(anfang, body.range[0]);
  return `${body.type} ${kopf.replace(LEERRAUM, " ")}`;
}

function anweisungen({ body }) {
  return body.type === "BlockStatement" ? body.body : [body];
}

function rumpfGleich(vorher, nachher, quellen) {
  const [alte, neue] = [anweisungen(vorher), anweisungen(nachher)];
  if (fallKopf(vorher, quellen.alt) !== fallKopf(nachher, quellen.neu) || alte.length !== neue.length) return false;
  return alte.every((anweisung, stelle) => entspricht(anweisung, neue[stelle], quellen));
}

function faelleGleich(altBaum, neuBaum, quellen) {
  const [alte, neue] = [fallFunktionen(altBaum), fallFunktionen(neuBaum)];
  return alte.length === neue.length && alte.every((fall, stelle) => rumpfGleich(fall, neue[stelle], quellen));
}

function aufbauGleich(vorher, nachher) {
  const [altBaum, neuBaum] = [gelesen(vorher, MODUL), gelesen(nachher, MODUL)];
  const gesperrt = [altBaum, neuBaum].flatMap((baum) => [...testOptionen(baum), ...erwartungen(baum)]);
  const quellen = { alt: vorher, neu: nachher, gesperrt: new Set(gesperrt) };
  return obersteEbeneGleich(altBaum.body, neuBaum.body, quellen) && faelleGleich(altBaum, neuBaum, quellen);
}

function benannterUmweg({ type, name, value }) {
  const wort = type === "Identifier" ? name : value;
  return UMWEGE.has(wort) ? [wort] : [];
}

function umweg(teil) {
  if (teil.type === "Identifier" || teil.type === "Literal") return benannterUmweg(teil);
  if (teil.type === "Property") return TESTOPTIONEN.has(schluessel(teil)) ? [`Testoption ${schluessel(teil)}`] : [];
  return modulUmweg(teil);
}

function modulUmweg(teil) {
  if (teil.type === "ImportExpression") return [DYNAMISCHER_IMPORT];
  if (teil.type === "ImportDeclaration") return CODEMODULE.test(String(teil.source.value)) ? [`import ${teil.source.value}`] : [];
  return teil.type === "MemberExpression" && teil.computed && teil.property.type !== "Literal" ? [BERECHNETER_ZUGRIFF] : [];
}

function* eigene(wert) {
  if (Array.isArray(wert)) for (const teil of wert) yield* eigene(teil);
  else if (typeof wert?.type === "string") {
    yield wert;
    if (!FUNKTIONEN.has(wert.type)) for (const teil of Object.values(wert)) yield* eigene(teil);
  }
}

function bereiche(baum) {
  const funktionen = [...knoten(baum)].filter(({ type }) => FUNKTIONEN.has(type));
  return [baum.body, ...funktionen.map(({ params, body }) => [...params, body])];
}

function ziele(muster) {
  if (muster === null) return [];
  if (muster.type === "MemberExpression") return [muster];
  if (muster.type === "ObjectPattern") return muster.properties.flatMap((teil) => ziele(teil.type === "RestElement" ? teil.argument : teil.value));
  if (muster.type === "ArrayPattern") return muster.elements.flatMap(ziele);
  if (muster.type === "RestElement") return ziele(muster.argument);
  return muster.type === "AssignmentPattern" ? ziele(muster.left) : [];
}

function veraendert(teil) {
  if (teil.type === "AssignmentExpression") return ziele(teil.left);
  if (teil.type === "UpdateExpression") return ziele(teil.argument);
  if (teil.type === "UnaryExpression" && teil.operator === "delete") return ziele(teil.argument);
  return teil.type === "ForInStatement" || teil.type === "ForOfStatement" ? ziele(teil.left) : [];
}

function basis(ausdruck) {
  return ausdruck.type === "MemberExpression" ? basis(ausdruck.object) : ausdruck;
}

function frischeBindung({ type, id, init }) {
  return type === "VariableDeclarator" && id.type === "Identifier" && (init === null || (FRISCHE_WERTE.has(init.type) && rein(init)));
}

function fremdeVeraenderungen(teile, quelle) {
  const lokal = new Set([...eigene(teile)].filter(frischeBindung).map(({ id }) => id.name));
  const fremd = (teil) => veraendert(teil).some((ziel) => !lokal.has(basis(ziel).name));
  return [...eigene(teile)].filter(fremd).map((teil) => `Veränderung ${quelle.slice(...teil.range).replace(LEERRAUM, " ")}`);
}

function umwegeDer(quelle) {
  const baum = gelesen(quelle, MODUL);
  const eintraege = [...[...knoten(baum)].flatMap(umweg), ...bereiche(baum).flatMap((teile) => fremdeVeraenderungen(teile, quelle))];
  const zahl = new Map();
  for (const eintrag of eintraege) zahl.set(eintrag, (zahl.get(eintrag) ?? 0) + 1);
  return zahl;
}

function keineNeuenUmwege(vorher, nachher) {
  const alt = umwegeDer(vorher);
  return [...umwegeDer(nachher)].every(([eintrag, zahl]) => zahl <= (alt.get(eintrag) ?? 0));
}

export function zusicherungenGleich(vorher, nachher) {
  const alt = zusicherungenJeFall(vorher);
  const gleich = alt !== null && isDeepStrictEqual(alt, zusicherungenJeFall(nachher));
  return gleich && aufbauGleich(vorher, nachher) && keineNeuenUmwege(vorher, nachher);
}
