import { VisitorKeys } from "espree";

import { FUNKTIONEN, ZAHL_LESEZIEL, bereichVon, eingebaut, festerName, lesestelle, namenImMuster } from "./ast.mjs";
import { FEHLER_HELFER, statusDeklaration } from "./http-modul.mjs";

const STATUS_LESEZIEL = { ...ZAHL_LESEZIEL, Property: "value" };
const ARGUMENTE = 3;
const OHNE_LADECODE = new Set(["ImportDeclaration", "FunctionDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"]);
const OHNE_LADECODE_ENG = new Set(["ImportDeclaration", "FunctionDeclaration", "ExportAllDeclaration"]);
const GRUNDWERTE = new Set(["Literal", "FunctionExpression", "ArrowFunctionExpression"]);
const LEER = {
  konstanten: { stellen: new Map(), verbraucht: new Set(), anweisungen: new Set(), importiert: new Set() },
  fehler: { aufrufe: new Set(), verbraucht: new Set(), vorlage: undefined },
};

function ohneAlias({ specifiers }) {
  return specifiers.filter((spezifizierer) => spezifizierer.type === "ImportSpecifier" && spezifizierer.imported.name === spezifizierer.local.name);
}

function httpImporte(programm, quelle) {
  const deklarationen = programm.body.filter((anweisung) => anweisung.type === "ImportDeclaration" && quelle(anweisung.source.value));
  return deklarationen.flatMap(ohneAlias);
}

function fundstellenJeName(eintraege, { namen, eigene }) {
  const stellen = eintraege.filter(({ knoten, eltern }) => knoten.type === "Identifier" && namen.has(knoten.name) && !eigene.has(eltern.at(-1)));
  return Map.groupBy(stellen, ({ knoten }) => knoten.name);
}

function nurLesestellen(jeName, name) {
  const stellen = jeName.get(name);
  return stellen !== undefined && stellen.every((eintrag) => lesestelle(eintrag, STATUS_LESEZIEL));
}

function statusImporte({ importe, eintraege, modul }) {
  const kandidaten = importe.filter(({ local: { name } }) => modul.konstanten.has(name));
  const jeName = fundstellenJeName(eintraege, { namen: new Set(kandidaten.map(({ local }) => local.name)), eigene: new Set(kandidaten) });
  const gelesen = kandidaten.filter(({ local: { name } }) => nurLesestellen(jeName, name));
  return {
    stellen: new Map(gelesen.flatMap(({ local: { name } }) => jeName.get(name).map(({ knoten }) => [bereichVon(knoten), modul.konstanten.get(name)]))),
    verbraucht: new Set(gelesen.map(bereichVon)),
    namen: new Set(gelesen.map(({ local: { name } }) => name)),
  };
}

function schlichteEigenschaft(eigenschaft) {
  return eigenschaft.type === "Property" && eigenschaft.kind === "init" && !eigenschaft.computed && !eigenschaft.method;
}

function gefrorenerWert(knoten, stand) {
  const { callee } = knoten;
  const aufruf = knoten.type === "CallExpression" && knoten.arguments.length === 1 && callee.type === "MemberExpression";
  const freeze = aufruf && !callee.computed && callee.object.name === "Object" && callee.property.name === "freeze";
  return freeze && eingebaut(stand, "Object") && wirkungsloserWert(knoten.arguments[0], stand);
}

function wirkungsloserWert(knoten, stand) {
  if (knoten === null || GRUNDWERTE.has(knoten.type)) return true;
  if (knoten.type === "Identifier") return knoten.name === "undefined" && eingebaut(stand, "undefined");
  if (knoten.type === "TemplateLiteral") return knoten.expressions.length === 0;
  if (knoten.type === "ArrayExpression") return knoten.elements.every((element) => wirkungsloserWert(element, stand));
  if (knoten.type === "ObjectExpression") return knoten.properties.every((eigenschaft) => schlichteEigenschaft(eigenschaft) && wirkungsloserWert(eigenschaft.value, stand));
  return gefrorenerWert(knoten, stand);
}

function ohneLadecode(anweisung, stand) {
  const kern = anweisung.type === "ExportNamedDeclaration" && anweisung.declaration ? anweisung.declaration : anweisung;
  if (kern.type !== "VariableDeclaration") return OHNE_LADECODE.has(kern.type);
  return kern.kind === "const" && kern.declarations.every(({ id, init }) => id.type === "Identifier" && init && wirkungsloserWert(init, stand));
}

function lokaleKandidaten({ programm, stand, erlaubt }) {
  const kandidaten = programm.body.flatMap((anweisung, index) => {
    const [name, wert] = statusDeklaration(anweisung) ?? [];
    const davor = programm.body.slice(0, index);
    return name && erlaubt.has(name) && davor.every((vorige) => ohneLadecode(vorige, stand)) ? [{ name, wert, anweisung }] : [];
  });
  return new Map(kandidaten.map((kandidat) => [kandidat.name, kandidat]));
}

function lokaleStatus({ programm, eintraege, stand, kreisfrei, erlaubt }) {
  const kandidaten = kreisfrei ? lokaleKandidaten({ programm, stand, erlaubt }) : new Map();
  const eigene = new Set([...kandidaten.values()].flatMap(({ anweisung }) => anweisung.declarations));
  const jeName = fundstellenJeName(eintraege, { namen: new Set(kandidaten.keys()), eigene });
  const gelesen = [...kandidaten.values()].filter(({ name }) => nurLesestellen(jeName, name));
  return {
    stellen: new Map(gelesen.flatMap(({ name, wert }) => jeName.get(name).map(({ knoten }) => [bereichVon(knoten), wert]))),
    anweisungen: new Set(gelesen.map(({ anweisung }) => bereichVon(anweisung))),
  };
}

function bindetConst(anweisung, name) {
  const kern = anweisung.type === "ExportNamedDeclaration" && anweisung.declaration ? anweisung.declaration : anweisung;
  return kern.type === "VariableDeclaration" && kern.kind === "const" && kern.declarations.some(({ id }) => namenImMuster(id).includes(name));
}

function ohneLadecodeEng(anweisung) {
  if (anweisung.type === "ExportNamedDeclaration") return anweisung.source !== null || (anweisung.declaration !== null && ohneLadecodeEng(anweisung.declaration));
  if (anweisung.type !== "VariableDeclaration") return OHNE_LADECODE_ENG.has(anweisung.type);
  return anweisung.kind === "const" && anweisung.declarations.every(({ id, init }) => id.type === "Identifier" && init && GRUNDWERTE.has(init.type));
}

function dateiBindungSicher({ programm, kreisfrei }, { stelle, ueberFunktion }) {
  const index = programm.body.findIndex((anweisung) => bindetConst(anweisung, stelle.name));
  return kreisfrei && ueberFunktion && index >= 0 && programm.body.slice(0, index + 1).every(ohneLadecodeEng);
}

function blockBindungSicher(block, { stelle, ueberFunktion }) {
  const davor = block.body.filter((anweisung) => anweisung.range[1] <= stelle.range[0] && bindetConst(anweisung, stelle.name));
  return !ueberFunktion && davor.length > 0;
}

function bindungSicher(kontext, ahne, lage) {
  if (ahne.type === "BlockStatement") return blockBindungSicher(ahne, lage);
  return ahne.type === "Program" && dateiBindungSicher(kontext, lage);
}

function parameterVon(funktion, name) {
  return funktion.params.flatMap(namenImMuster).includes(name);
}

function verdecktDurchSwitch(ahne, orte) {
  return ahne.type === "SwitchStatement" && ahne.cases.some((zweig) => orte.includes(zweig));
}

function sichererName(kontext, stelle) {
  const orte = kontext.stand.gebunden.get(stelle.name) ?? [];
  let kind = stelle;
  let ueberFunktion = false;
  for (const ahne of kontext.eltern.get(stelle).toReversed()) {
    if (verdecktDurchSwitch(ahne, orte)) return false;
    const funktion = FUNKTIONEN.has(ahne.type);
    if (funktion && orte.includes(ahne)) return kind === ahne.body && parameterVon(ahne, stelle.name);
    if (!funktion && orte.includes(ahne)) return bindungSicher(kontext, ahne, { stelle, ueberFunktion });
    ueberFunktion ||= funktion;
    kind = ahne;
  }
  return false;
}

function unveraenderlicherName(kontext, knoten) {
  return !kontext.stand.geschrieben.has(knoten.name) && sichererName(kontext, knoten);
}

function ohneWirkung(kontext, knoten) {
  if (knoten.type === "Literal") return knoten.regex === undefined;
  return knoten.type === "Identifier" && (kontext.gelesen.has(bereichVon(knoten)) || unveraenderlicherName(kontext, knoten));
}

function passt(kontext, aufruf) {
  const [empfaenger, status, text] = aufruf.arguments;
  return aufruf.arguments.length === ARGUMENTE && festerName(kontext.stand, empfaenger) && ohneWirkung(kontext, status) && ohneWirkung(kontext, text);
}

function aufrufVon(knoten, elter) {
  return elter.type === "CallExpression" && elter.callee === knoten ? elter : undefined;
}

function fehlerAufrufe({ importe, programm, eintraege, stand, modul, kreisfrei, gelesen }) {
  const kandidat = modul.fehlerHelfer && importe.find(({ local }) => local.name === FEHLER_HELFER);
  if (!kandidat) return LEER.fehler;
  const stellen = fundstellenJeName(eintraege, { namen: new Set([FEHLER_HELFER]), eigene: new Set([kandidat]) }).get(FEHLER_HELFER) ?? [];
  const aufrufe = stellen.map(({ knoten, eltern }) => aufrufVon(knoten, eltern.at(-1)));
  const kontext = { programm, stand, kreisfrei, gelesen, eltern: new Map(eintraege.map((eintrag) => [eintrag.knoten, eintrag.eltern])) };
  if (aufrufe.length === 0 || !aufrufe.every((aufruf) => aufruf && passt(kontext, aufruf))) return LEER.fehler;
  return { aufrufe: new Set(aufrufe.map(bereichVon)), verbraucht: new Set([bereichVon(kandidat)]), vorlage: modul.fehlerHelfer.ausdruck };
}

function konstantenAus(angaben) {
  const importiert = statusImporte(angaben);
  const lokal = lokaleStatus(angaben);
  return { stellen: new Map([...importiert.stellen, ...lokal.stellen]), verbraucht: importiert.verbraucht, anweisungen: lokal.anweisungen, importiert: importiert.namen };
}

export function httpFakten({ programm, eintraege, stand, kreisfrei, http, lokalErlaubt = new Set() }) {
  if (!http?.modul || stand.unsicher) return LEER;
  const importe = httpImporte(programm, http.quelle);
  const angaben = { importe, programm, eintraege, stand, kreisfrei, modul: http.modul, erlaubt: lokalErlaubt };
  const konstanten = konstantenAus(angaben);
  return { konstanten, fehler: fehlerAufrufe({ ...angaben, gelesen: konstanten.stellen }) };
}

function ohneVerbrauchte(anweisung, verbraucht) {
  if (anweisung.type !== "ImportDeclaration") return [anweisung];
  const uebrig = anweisung.specifiers.filter((spezifizierer) => !verbraucht.has(bereichVon(spezifizierer)));
  if (uebrig.length === anweisung.specifiers.length) return [anweisung];
  return uebrig.length === 0 ? [] : [{ ...anweisung, specifiers: uebrig }];
}

function programmOhne(programm, { verbraucht, anweisungen = new Set() }) {
  if (verbraucht.size === 0 && anweisungen.size === 0) return undefined;
  const uebrige = programm.body.filter((anweisung) => !anweisungen.has(bereichVon(anweisung)));
  const body = uebrige.flatMap((anweisung) => ohneVerbrauchte(anweisung, verbraucht));
  const gleich = body.length === programm.body.length && body.every((anweisung, index) => anweisung === programm.body[index]);
  return gleich ? undefined : { ...programm, body };
}

export function statusKonstante(knoten, http) {
  const wert = knoten.type === "Identifier" ? http.konstanten.stellen.get(bereichVon(knoten)) : undefined;
  return wert && { ...wert, range: knoten.range };
}

export function statusImporteEntfernt(knoten, http) {
  return knoten.type === "Program" ? programmOhne(knoten, http.konstanten) : undefined;
}

function neu(knoten, felder) {
  return { ...knoten, ...felder, range: undefined };
}

function ohnePosition(knoten) {
  if (Array.isArray(knoten)) return knoten.map(ohnePosition);
  if (!knoten || typeof knoten.type !== "string") return knoten;
  const kopie = { ...knoten, range: undefined };
  for (const schluessel of VisitorKeys[knoten.type] ?? []) kopie[schluessel] = ohnePosition(knoten[schluessel]);
  return kopie;
}

function ausgeklappt(quellvorlage, [empfaenger, status, text], range) {
  const vorlage = ohnePosition(quellvorlage);
  const statusAufruf = vorlage.callee.object;
  const koerper = vorlage.arguments[0];
  const aufruf = neu(vorlage, {
    callee: neu(vorlage.callee, { object: neu(statusAufruf, { callee: neu(statusAufruf.callee, { object: empfaenger }), arguments: [status] }) }),
    arguments: [neu(koerper, { properties: [neu(koerper.properties[0], { value: text })] })],
  });
  return { ...aufruf, range };
}

export function fehlerantwort(knoten, http) {
  const helfer = knoten.type === "CallExpression" && knoten.callee.type === "Identifier" && knoten.callee.name === FEHLER_HELFER;
  if (!helfer || !http.fehler.aufrufe.has(bereichVon(knoten))) return undefined;
  return ausgeklappt(http.fehler.vorlage, knoten.arguments, knoten.range);
}

export function fehlerImportEntfernt(knoten, http) {
  return knoten.type === "Program" ? programmOhne(knoten, http.fehler) : undefined;
}
