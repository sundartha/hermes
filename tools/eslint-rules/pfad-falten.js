import { posix } from "node:path";

export const VIRTUELLE_WURZEL = "/\u0001wurzel";
export const UNBEKANNT = "\u0000";

const MAX_WERTE = 64;
const MAX_TIEFE = 40;
const PFAD_MODULE = new Set(["path", "node:path"]);
const URL_MODULE = new Set(["url", "node:url"]);
const PFAD_FUNKTIONEN = new Set(["join", "resolve", "dirname"]);
const URL_FUNKTIONEN = new Set(["fileURLToPath"]);
const WURZEL_NAMEN = new Set(["ROOT", "REPO_ROOT"]);
const RUECKRUF_METHODEN = new Set(["map", "flatMap", "filter", "forEach", "some", "every", "find"]);
const ERGEBNIS_IST_RUECKGABE = new Set(["map", "flatMap"]);
const LISTE_BLEIBT = new Set(["filter", "slice", "toSorted", "sort", "reverse", "toReversed"]);
const ELEMENT_METHODEN = new Set(["pop", "shift", "at", "find", "findLast"]);
const OBJEKT_DURCHREICHEN = "freeze";
const GANZES_MODUL = "*";
const RELATIVER_MODULPFAD = ".";
const ORDNER_TRENNER = "/";
const ARGUMENT_ERSTES = 0;
const LEER = new Map();

const alsText = (inhalt) => ({ art: "text", inhalt });
const alsUrl = (inhalt) => ({ art: "url", inhalt });
const alsListe = (elemente) => ({ art: "liste", elemente });
const alsObjekt = (felder) => ({ art: "objekt", felder });

function begrenzt(werte) {
  const gesehen = new Map();
  for (const wert of werte) gesehen.set(JSON.stringify(wert), wert);
  return [...gesehen.values()].slice(0, MAX_WERTE);
}

function kombiniert(links, rechts) {
  return begrenzt(links.flatMap((anfang) => rechts.map((ende) => alsText(anfang + ende)))).map(
    ({ inhalt }) => inhalt,
  );
}

function listenElemente(werte) {
  return werte.filter(({ art }) => art === "liste").flatMap(({ elemente }) => elemente);
}

function variableVon(lauf, bezeichner) {
  for (let scope = lauf.sourceCode.getScope(bezeichner); scope; scope = scope.upper) {
    const variable = scope.set.get(bezeichner.name);
    if (variable !== undefined) return variable;
  }
  return undefined;
}

function literalText(node) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}

function modulAusInit(init) {
  const ausdruck = init?.type === "AwaitExpression" ? init.argument : init;
  if (ausdruck?.type === "ImportExpression") return literalText(ausdruck.source);
  const istRequire = ausdruck?.type === "CallExpression" && ausdruck.callee.name === "require";
  return istRequire ? literalText(ausdruck.arguments[0]) : undefined;
}

function musterName(def) {
  const muster = def.node.id;
  if (muster.type === "Identifier") return GANZES_MODUL;
  const eigenschaft = muster.properties?.find(({ value }) => value === def.name);
  return eigenschaft?.key.name;
}

function importHerkunft(def) {
  const modul = def.parent.source.value;
  const name = def.node.type === "ImportSpecifier" ? def.node.imported.name : GANZES_MODUL;
  return { modul, name };
}

export function herkunft(lauf, bezeichner) {
  const variable = bezeichner?.type === "Identifier" ? variableVon(lauf, bezeichner) : undefined;
  const [def] = variable?.defs ?? [];
  if (def?.type === "ImportBinding") return importHerkunft(def);
  if (def?.type !== "Variable") return undefined;
  const modul = modulAusInit(def.node.init);
  return modul === undefined ? undefined : { modul, name: musterName(def) };
}

function texte(lauf, node, umgebung) {
  const gefunden = werte(lauf, node, umgebung)
    .filter(({ art }) => art === "text")
    .map(({ inhalt }) => inhalt);
  return gefunden.length === 0 ? [UNBEKANNT] : gefunden;
}

function vorlage(lauf, node, umgebung) {
  let ergebnisse = [""];
  for (const [index, teil] of node.quasis.entries()) {
    ergebnisse = ergebnisse.map((anfang) => anfang + (teil.value.cooked ?? UNBEKANNT));
    const ausdruck = node.expressions[index];
    if (ausdruck !== undefined) ergebnisse = kombiniert(ergebnisse, texte(lauf, ausdruck, umgebung));
  }
  return ergebnisse.map(alsText);
}

function summe(lauf, node, umgebung) {
  if (node.operator !== "+") return [];
  return kombiniert(texte(lauf, node.left, umgebung), texte(lauf, node.right, umgebung)).map(alsText);
}

function globalerName(lauf, name) {
  if (name === "__dirname") return [alsText(posix.dirname(lauf.datei))];
  if (name === "__filename") return [alsText(lauf.datei)];
  return [];
}

function einmalGeschrieben(variable) {
  return variable.references.filter((referenz) => referenz.isWrite()).length <= 1;
}

function schiebeAufruf(bezeichner) {
  const mitglied = bezeichner.parent;
  const istPush = mitglied.type === "MemberExpression" && mitglied.property.name === "push";
  return istPush && mitglied.parent.type === "CallExpression" ? mitglied.parent : undefined;
}

function argumentWerte(lauf, argument, umgebung) {
  if (argument.type === "SpreadElement") return listenElemente(werte(lauf, argument.argument, umgebung));
  return werte(lauf, argument, umgebung);
}

function geschobeneWerte(lauf, variable, umgebung) {
  const aufrufe = variable.references.map(({ identifier }) => schiebeAufruf(identifier));
  return aufrufe
    .filter(Boolean)
    .flatMap((aufruf) => aufruf.arguments.flatMap((arg) => argumentWerte(lauf, arg, umgebung)));
}

function variablenWerte(lauf, def, umgebung) {
  const schleife = def.parent.parent;
  if (schleife?.type === "ForOfStatement" && schleife.left === def.parent) {
    return def.node.id === def.name ? listenElemente(werte(lauf, schleife.right, umgebung)) : [];
  }
  const variable = variableVon(lauf, def.name);
  if (def.node.id !== def.name || !def.node.init || !einmalGeschrieben(variable)) return [];
  const anfang = werte(lauf, def.node.init, umgebung);
  if (def.node.init.type !== "ArrayExpression") return anfang;
  return [alsListe([...listenElemente(anfang), ...geschobeneWerte(lauf, variable, umgebung)])];
}

function importWerte(def) {
  const { modul, name } = importHerkunft(def);
  const istWurzel = WURZEL_NAMEN.has(name) && modul.startsWith(RELATIVER_MODULPFAD);
  return istWurzel ? [alsText(VIRTUELLE_WURZEL)] : [];
}

function funktionsVariable(lauf, funktion) {
  if (funktion.type === "FunctionDeclaration") {
    return lauf.sourceCode.getDeclaredVariables(funktion).find(({ name }) => name === funktion.id?.name);
  }
  const deklaration = funktion.parent;
  if (deklaration.type !== "VariableDeclarator" || deklaration.init !== funktion) return undefined;
  return lauf.sourceCode.getDeclaredVariables(deklaration)[0];
}

function istAufgerufen(bezeichnerKnoten) {
  const { parent } = bezeichnerKnoten;
  return parent.type === "CallExpression" && parent.callee === bezeichnerKnoten;
}

function aufrufStellen(variable) {
  const bezeichnerKnoten = (variable?.references ?? []).map(({ identifier }) => identifier);
  return bezeichnerKnoten.filter(istAufgerufen).map(({ parent }) => parent);
}

function rueckrufListe(funktion) {
  const aufruf = funktion.parent;
  if (aufruf.type !== "CallExpression" || !aufruf.arguments.includes(funktion)) return undefined;
  const methode = aufruf.callee;
  const istRueckruf = methode.type === "MemberExpression" && RUECKRUF_METHODEN.has(methode.property.name);
  return istRueckruf ? methode.object : undefined;
}

function aufrufArgumente(lauf, funktion, index) {
  const liste = rueckrufListe(funktion);
  if (liste !== undefined) return index === 0 ? listenElemente(werte(lauf, liste, LEER)) : [];
  const argumente = aufrufStellen(funktionsVariable(lauf, funktion)).map(
    (aufruf) => aufruf.arguments[index],
  );
  return argumente
    .filter((argument) => argument !== undefined && argument.type !== "SpreadElement")
    .flatMap((argument) => werte(lauf, argument, LEER));
}

function parameterName(parameter) {
  return parameter.type === "AssignmentPattern" ? parameter.left : parameter;
}

function parameterWerte(lauf, def, umgebung) {
  const funktion = def.node;
  const index = funktion.params.findIndex((parameter) => parameterName(parameter) === def.name);
  if (index === -1) return [];
  const parameter = funktion.params[index];
  const vorgabe = parameter.type === "AssignmentPattern" ? werte(lauf, parameter.right, umgebung) : [];
  return [...vorgabe, ...aufrufArgumente(lauf, funktion, index)];
}

const DEFINITIONEN = new Map(Object.entries({
  Variable: variablenWerte,
  ImportBinding: (lauf, def) => importWerte(def),
  Parameter: parameterWerte,
}));

function bezeichner(lauf, node, umgebung) {
  const variable = variableVon(lauf, node);
  if (variable === undefined || variable.defs.length === 0) return globalerName(lauf, node.name);
  if (umgebung.has(variable)) return umgebung.get(variable);
  return variable.defs.flatMap((def) => DEFINITIONEN.get(def.type)?.(lauf, def, umgebung) ?? []);
}

function istImportMeta(node) {
  return node.type === "MetaProperty" && node.meta.name === "import";
}

function importMeta(lauf, name) {
  if (name === "url") return [alsUrl(lauf.datei)];
  if (name === "dirname") return [alsText(posix.dirname(lauf.datei))];
  if (name === "filename") return [alsText(lauf.datei)];
  return [];
}

function eigenschaft(wert, name) {
  if (wert.art === "objekt") return wert.felder.get(name) ?? [];
  if (wert.art !== "url") return [];
  if (name === "pathname") return [alsText(wert.inhalt)];
  return name === "href" ? [wert] : [];
}

function mitglied(lauf, node, umgebung) {
  if (node.computed) return [];
  const name = node.property.name;
  if (istImportMeta(node.object)) return importMeta(lauf, name);
  return werte(lauf, node.object, umgebung).flatMap((wert) => eigenschaft(wert, name));
}

function verbunden(teile) {
  let ergebnisse = [""];
  for (const teil of teile) {
    ergebnisse = begrenzt(
      ergebnisse.flatMap((anfang) => teil.map((stueck) => alsText(posix.join(anfang, stueck)))),
    ).map(({ inhalt }) => inhalt);
  }
  return ergebnisse;
}

function aufgeloest(teile) {
  let ergebnisse = [VIRTUELLE_WURZEL];
  for (const teil of teile) {
    const schritt = (anfang, stueck) =>
      stueck.startsWith(ORDNER_TRENNER) || stueck.startsWith(UNBEKANNT)
        ? stueck
        : posix.join(anfang, stueck);
    ergebnisse = begrenzt(
      ergebnisse.flatMap((anfang) => teil.map((stueck) => alsText(schritt(anfang, stueck)))),
    ).map(({ inhalt }) => inhalt);
  }
  return ergebnisse;
}

const PFAD_AUFRUFE = new Map(Object.entries({
  join: (teile) => verbunden(teile).map(alsText),
  resolve: (teile) => aufgeloest(teile).map(alsText),
  dirname: ([teil = []]) => teil.map((stueck) => alsText(posix.dirname(stueck))),
}));

function importiertePfadFunktion(lauf, callee) {
  const quelle = herkunft(lauf, callee);
  const bekannt = PFAD_MODULE.has(quelle?.modul) && PFAD_FUNKTIONEN.has(quelle.name);
  const umUrl = URL_MODULE.has(quelle?.modul) && URL_FUNKTIONEN.has(quelle.name);
  return bekannt || umUrl ? quelle.name : undefined;
}

function pfadMethode(lauf, callee) {
  const name = callee.property.name;
  if (callee.object.name === "process" && name === "cwd") return name;
  const quelle = herkunft(lauf, callee.object);
  const ausPfad = PFAD_MODULE.has(quelle?.modul) && quelle.name === GANZES_MODUL;
  return ausPfad && PFAD_FUNKTIONEN.has(name) ? name : undefined;
}

function pfadFunktion(lauf, callee) {
  if (callee.type === "Identifier") return importiertePfadFunktion(lauf, callee);
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  return pfadMethode(lauf, callee);
}

function pfadAufruf(lauf, { node, name }, umgebung) {
  if (name === "cwd") return [alsText(VIRTUELLE_WURZEL)];
  if (name === "fileURLToPath") {
    const [ziel] = node.arguments;
    return werte(lauf, ziel, umgebung)
      .filter(({ art }) => art === "url")
      .map(({ inhalt }) => alsText(inhalt));
  }
  const teile = node.arguments.map((argument) => texte(lauf, argument, umgebung));
  return PFAD_AUFRUFE.get(name)(teile);
}

function rueckgabeAusdruecke(lauf, funktion) {
  if (funktion.body.type !== "BlockStatement") return [funktion.body];
  const gefunden = [];
  const offen = [funktion.body];
  while (offen.length > 0) {
    const node = offen.pop();
    if (node.type === "ReturnStatement" && node.argument) gefunden.push(node.argument);
    if (node.type.includes("Function")) continue;
    for (const schluessel of lauf.sourceCode.visitorKeys[node.type] ?? []) {
      offen.push(...[node[schluessel]].flat().filter(Boolean));
    }
  }
  return gefunden;
}

function aufrufUmgebung(lauf, funktion, argumente) {
  const umgebung = new Map();
  const variablen = lauf.sourceCode.getDeclaredVariables(funktion);
  for (const [index, parameter] of funktion.params.entries()) {
    const name = parameterName(parameter);
    const variable = variablen.find((kandidat) => kandidat.identifiers.includes(name));
    if (variable === undefined) continue;
    const gegeben = argumente[index] ?? [];
    const vorgabe =
      gegeben.length === 0 && parameter.type === "AssignmentPattern"
        ? werte(lauf, parameter.right, umgebung)
        : [];
    umgebung.set(variable, [...gegeben, ...vorgabe]);
  }
  return umgebung;
}

function rueckgabeWerte(lauf, funktion, argumente) {
  const umgebung = aufrufUmgebung(lauf, funktion, argumente);
  return rueckgabeAusdruecke(lauf, funktion).flatMap((ausdruck) => werte(lauf, ausdruck, umgebung));
}

function lokaleFunktion(lauf, callee) {
  const [def] = variableVon(lauf, callee)?.defs ?? [];
  if (def?.type === "FunctionName") return def.node;
  const init = def?.type === "Variable" ? def.node.init : undefined;
  return init?.type.includes("Function") ? init : undefined;
}

function lokalerAufruf(lauf, node, umgebung) {
  const funktion = lokaleFunktion(lauf, node.callee);
  if (funktion === undefined) return [];
  const argumente = node.arguments.map((argument) => argumentWerte(lauf, argument, umgebung));
  return rueckgabeWerte(lauf, funktion, argumente);
}

function objektMethode(lauf, node, umgebung) {
  const name = node.callee.property.name;
  const objekte = werte(lauf, node.arguments[ARGUMENT_ERSTES], umgebung).filter(
    ({ art }) => art === "objekt",
  );
  if (name === OBJEKT_DURCHREICHEN) return werte(lauf, node.arguments[ARGUMENT_ERSTES], umgebung);
  if (name === "values") return [alsListe(objekte.flatMap(({ felder }) => [...felder.values()].flat()))];
  if (name === "keys") return [alsListe(objekte.flatMap(({ felder }) => [...felder.keys()].map(alsText)))];
  return [];
}

function listenMethode(lauf, node, umgebung) {
  const name = node.callee.property.name;
  const elemente = listenElemente(werte(lauf, node.callee.object, umgebung));
  if (LISTE_BLEIBT.has(name)) return [alsListe(elemente)];
  if (ELEMENT_METHODEN.has(name)) return elemente;
  const rueckruf = node.arguments[ARGUMENT_ERSTES];
  if (!ERGEBNIS_IST_RUECKGABE.has(name) || !rueckruf?.type.includes("Function")) return [];
  const ergebnis = rueckgabeWerte(lauf, rueckruf, [elemente]);
  return [alsListe(name === "flatMap" ? [...ergebnis, ...listenElemente(ergebnis)] : ergebnis)];
}

function methode(lauf, node, umgebung) {
  const { object, property } = node.callee;
  if (object.type === "Identifier" && object.name === "Object") return objektMethode(lauf, node, umgebung);
  if (property.name === "toString") return werte(lauf, object, umgebung);
  return listenMethode(lauf, node, umgebung);
}

function aufruf(lauf, node, umgebung) {
  const name = pfadFunktion(lauf, node.callee);
  if (name !== undefined) return pfadAufruf(lauf, { node, name }, umgebung);
  const { callee } = node;
  if (callee.type === "MemberExpression" && !callee.computed) return methode(lauf, node, umgebung);
  if (callee.type !== "Identifier") return [];
  if (callee.name === "String") return werte(lauf, node.arguments[ARGUMENT_ERSTES], umgebung);
  return lokalerAufruf(lauf, node, umgebung);
}

function urlBasis(inhalt) {
  return inhalt.endsWith(ORDNER_TRENNER) ? inhalt : `${posix.dirname(inhalt)}${ORDNER_TRENNER}`;
}

function urlAufgeloest(basis, relativ) {
  if (relativ.startsWith(ORDNER_TRENNER) || relativ.startsWith(UNBEKANNT)) return alsUrl(relativ);
  const ziel = posix.normalize(`${urlBasis(basis)}${relativ}`);
  const ordnerZiel = /(?:^|\/)\.{0,2}$/.test(relativ) && !ziel.endsWith(ORDNER_TRENNER);
  return alsUrl(ordnerZiel ? `${ziel}${ORDNER_TRENNER}` : ziel);
}

function neu(lauf, node, umgebung) {
  const [relativ, basis] = node.arguments;
  const istUrl = node.callee.type === "Identifier" && node.callee.name === "URL";
  if (!istUrl || basis === undefined) return [];
  const basen = werte(lauf, basis, umgebung).filter(({ art }) => art === "url");
  const ziele = texte(lauf, relativ, umgebung);
  return basen.flatMap(({ inhalt }) => ziele.map((ziel) => urlAufgeloest(inhalt, ziel)));
}

function feldName(eigenschaftsKnoten) {
  const { key, computed } = eigenschaftsKnoten;
  if (computed) return undefined;
  return key.type === "Identifier" ? key.name : key.value;
}

function objektLiteral(lauf, node, umgebung) {
  const felder = new Map();
  for (const eigenschaftsKnoten of node.properties) {
    const name = eigenschaftsKnoten.type === "Property" ? feldName(eigenschaftsKnoten) : undefined;
    if (name !== undefined) felder.set(name, werte(lauf, eigenschaftsKnoten.value, umgebung));
  }
  return [alsObjekt(felder)];
}

function listenLiteral(lauf, node, umgebung) {
  const elemente = node.elements
    .filter(Boolean)
    .flatMap((element) => argumentWerte(lauf, element, umgebung));
  return [alsListe(elemente)];
}

const AUSWERTER = new Map(Object.entries({
  Literal: (lauf, node) => (typeof node.value === "string" ? [alsText(node.value)] : []),
  TemplateLiteral: vorlage,
  BinaryExpression: summe,
  Identifier: bezeichner,
  MemberExpression: mitglied,
  CallExpression: aufruf,
  NewExpression: neu,
  ArrayExpression: listenLiteral,
  ObjectExpression: objektLiteral,
  ConditionalExpression: (lauf, node, umgebung) => [
    ...werte(lauf, node.consequent, umgebung),
    ...werte(lauf, node.alternate, umgebung),
  ],
  LogicalExpression: (lauf, node, umgebung) => [
    ...werte(lauf, node.left, umgebung),
    ...werte(lauf, node.right, umgebung),
  ],
  ChainExpression: (lauf, node, umgebung) => werte(lauf, node.expression, umgebung),
}));

function werte(lauf, node, umgebung) {
  const auswerter = AUSWERTER.get(node?.type);
  if (auswerter === undefined || lauf.aktiv.has(node) || lauf.aktiv.size > MAX_TIEFE) return [];
  lauf.aktiv.add(node);
  try {
    return begrenzt(auswerter(lauf, node, umgebung));
  } finally {
    lauf.aktiv.delete(node);
  }
}

export function pfadFalter(sourceCode, dateiImRepo) {
  const zustand = {
    sourceCode,
    datei: posix.join(VIRTUELLE_WURZEL, dateiImRepo),
    aktiv: new Set(),
  };
  return {
    werte: (node) => werte(zustand, node, LEER),
    herkunft: (node) => herkunft(zustand, node),
  };
}

function pfadText(wert) {
  if (wert.art === "url") return wert.inhalt;
  if (wert.art !== "text" || wert.inhalt.startsWith(UNBEKANNT)) return undefined;
  return wert.inhalt.startsWith(ORDNER_TRENNER)
    ? wert.inhalt
    : posix.join(VIRTUELLE_WURZEL, wert.inhalt);
}

export function pfadImRepo(wert) {
  const text = pfadText(wert);
  const pfad = text === undefined ? "" : posix.normalize(text);
  const anfang = `${VIRTUELLE_WURZEL}${ORDNER_TRENNER}`;
  return pfad.startsWith(anfang) ? pfad.slice(anfang.length) : undefined;
}
