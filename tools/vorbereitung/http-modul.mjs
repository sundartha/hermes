import { EINZIGE, einzigesArgument } from "./ast.mjs";

export const FEHLER_HELFER = "antworteFehler";
const STATUS_NAME = /^HTTP_[A-Z]+(?:_[A-Z]+)*$/;
const STATUS_MIN = 100;
const STATUS_MAX = 599;
const PARAMETER = 3;

function istName(knoten, name) {
  return knoten?.type === "Identifier" && knoten.name === name;
}

function objektVon(zugriff, name) {
  const passt = zugriff?.type === "MemberExpression" && !zugriff.computed && istName(zugriff.property, name);
  return passt ? zugriff.object : undefined;
}

function aufrufVon(knoten) {
  return knoten?.type === "CallExpression" ? knoten : undefined;
}

function fehlerKoerper(knoten, text) {
  if (knoten?.type !== "ObjectExpression" || knoten.properties.length !== EINZIGE) return false;
  const [eigenschaft] = knoten.properties;
  return !eigenschaft.computed && istName(eigenschaft.key, "error") && istName(eigenschaft.value, text);
}

function antwortKette(ausdruck, [empfaenger, status, text]) {
  const json = aufrufVon(ausdruck);
  const statusAufruf = aufrufVon(objektVon(json?.callee, "json"));
  const statusArgument = statusAufruf && einzigesArgument(statusAufruf);
  const kette = json && statusAufruf && istName(objektVon(statusAufruf.callee, "status"), empfaenger) && istName(statusArgument, status);
  return kette && einzigesArgument(json) !== undefined && fehlerKoerper(einzigesArgument(json), text) ? json : undefined;
}

function parameterNamen(deklaration) {
  const namen = deklaration.params.map(({ name }) => name);
  return namen.length === PARAMETER && !namen.includes(undefined) ? namen : undefined;
}

function fehlerHelfer(deklaration) {
  const namen = deklaration.async || deklaration.generator ? undefined : parameterNamen(deklaration);
  const [anweisung, ...rest] = deklaration.body.body;
  const ausdruck = rest.length === 0 && anweisung?.type === "ReturnStatement" && namen ? antwortKette(anweisung.argument, namen) : undefined;
  return ausdruck ? { ausdruck } : undefined;
}

function statuszahl(init) {
  return Number.isInteger(init?.value) && init.value >= STATUS_MIN && init.value <= STATUS_MAX;
}

function einzelneConst(deklaration) {
  const einzeln = deklaration?.type === "VariableDeclaration" && deklaration.kind === "const";
  return einzeln && deklaration.declarations.length === EINZIGE ? deklaration.declarations[0] : undefined;
}

export function statusDeklaration(deklaration) {
  const { id, init } = einzelneConst(deklaration) ?? {};
  return id?.type === "Identifier" && STATUS_NAME.test(id.name) && statuszahl(init) ? [id.name, init] : undefined;
}

function eintragAus(anweisung) {
  const deklaration = anweisung.type === "ExportNamedDeclaration" ? anweisung.declaration : undefined;
  const konstante = statusDeklaration(deklaration);
  if (konstante) return { konstante };
  if (deklaration?.type !== "FunctionDeclaration") return undefined;
  if (deklaration.id.name !== FEHLER_HELFER) return { funktion: true };
  const helfer = fehlerHelfer(deklaration);
  return helfer ? { helfer } : undefined;
}

export function httpModul(programm, { geschrieben, unsicher }) {
  const eintraege = programm.body.map(eintragAus);
  if (unsicher || geschrieben.size > 0 || eintraege.includes(undefined)) return undefined;
  return {
    konstanten: new Map(eintraege.flatMap(({ konstante }) => (konstante ? [konstante] : []))),
    fehlerHelfer: eintraege.find(({ helfer }) => helfer)?.helfer,
  };
}
