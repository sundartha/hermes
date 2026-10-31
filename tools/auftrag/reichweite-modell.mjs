import { baumText } from "../syntaxbaum.mjs";

import { bezuegeIn, lies } from "./abhaengigkeitsgraph.mjs";

const ANONYM = "*default*";
const STANDARD = "default";
const STERN = "*";
const EVAL = "eval";
const AUSFUEHREND = new Set([
  "CallExpression",
  "NewExpression",
  "TaggedTemplateExpression",
  "AwaitExpression",
  "ImportExpression",
  "YieldExpression",
  "UpdateExpression",
  "AssignmentExpression",
]);
const TRAEGE = new Set(["FunctionExpression", "ArrowFunctionExpression"]);
const KLASSE = new Set(["ClassExpression", "ClassDeclaration"]);
const BENANNT = new Set(["FunctionDeclaration", "ClassDeclaration"]);
const LEER = Object.freeze({ einheiten: [], modulcode: [], importe: [], exporte: [], sterne: [] });
export const ALLES = Object.freeze({ alle: true, namen: [] });

export function nameVon(knoten) {
  return knoten.type === "Identifier" ? knoten.name : knoten.value;
}

function bindungen(muster) {
  if (muster === null) return [];
  if (muster.type === "Identifier") return [muster.name];
  if (muster.type === "ObjectPattern") return muster.properties.flatMap((eintrag) => bindungen(eintrag.value ?? eintrag.argument));
  if (muster.type === "ArrayPattern") return muster.elements.flatMap(bindungen);
  if (muster.type === "AssignmentPattern") return bindungen(muster.left);
  return muster.type === "RestElement" ? bindungen(muster.argument) : [];
}

function istGefroren({ callee }) {
  return callee.type === "MemberExpression" && !callee.computed && callee.object.name === "Object" && callee.property.name === "freeze";
}

function klasseLaeuft(klasse) {
  const fremdeBasis = klasse.superClass !== null && klasse.superClass.type !== "Identifier";
  return fremdeBasis || klasse.body.body.some((glied) => glied.computed || glied.type === "StaticBlock" || (glied.static && glied.type === "PropertyDefinition"));
}

function laeuft(knoten) {
  if (knoten === null || typeof knoten !== "object") return false;
  if (Array.isArray(knoten)) return knoten.some(laeuft);
  if (TRAEGE.has(knoten.type)) return false;
  if (KLASSE.has(knoten.type)) return klasseLaeuft(knoten);
  if (knoten.type === "CallExpression" && istGefroren(knoten)) return laeuft(knoten.arguments);
  if (AUSFUEHREND.has(knoten.type)) return true;
  return Object.entries(knoten).some(([schluessel, kind]) => schluessel !== "range" && laeuft(kind));
}

function einheit(namen, knoten, { veraenderlich, ausfuehrend }) {
  return { namen, json: `${baumText(knoten)}|${veraenderlich}|${ausfuehrend}`, bezuege: bezuegeIn(knoten), veraenderlich, ausfuehrend };
}

function deklariere(deklaration) {
  if (deklaration.type !== "VariableDeclaration") {
    const name = deklaration.id === null ? ANONYM : deklaration.id.name;
    const ausfuehrend = deklaration.type === "ClassDeclaration" && klasseLaeuft(deklaration);
    return { ...LEER, einheiten: [einheit([name], deklaration, { veraenderlich: false, ausfuehrend })], exporte: [[name, { lokal: name }]] };
  }
  const veraenderlich = deklaration.kind !== "const";
  const einheiten = deklaration.declarations.map((eintrag) => einheit(bindungen(eintrag.id), { kind: deklaration.kind, eintrag }, { veraenderlich, ausfuehrend: laeuft(eintrag.init) || laeuft(eintrag.id) }));
  return { ...LEER, einheiten, exporte: einheiten.flatMap(({ namen }) => namen.map((name) => [name, { lokal: name }])) };
}

function ohneExporte(teil) {
  return { ...teil, exporte: [] };
}

function importiere(anweisung) {
  const quelle = anweisung.source.value;
  if (anweisung.specifiers.length === 0) return { ...LEER, modulcode: [{ json: `import ${quelle}`, bezuege: new Set() }] };
  const art = { ImportDefaultSpecifier: STANDARD, ImportNamespaceSpecifier: STERN };
  return { ...LEER, importe: anweisung.specifiers.map((angabe) => [angabe.local.name, { quelle, importiert: art[angabe.type] ?? nameVon(angabe.imported) }]) };
}

function exportiereBenannt(anweisung) {
  if (anweisung.declaration !== null) return deklariere(anweisung.declaration);
  const quelle = anweisung.source?.value;
  const exporte = anweisung.specifiers.map((angabe) => {
    const lokal = nameVon(angabe.local);
    return [nameVon(angabe.exported), quelle === undefined ? { lokal } : { quelle, importiert: lokal }];
  });
  return { ...LEER, exporte };
}

function exportiereStandard({ declaration }) {
  if (BENANNT.has(declaration.type) && declaration.id !== null) {
    const teil = deklariere(declaration);
    return { ...teil, exporte: [[STANDARD, { lokal: declaration.id.name }]] };
  }
  const ausfuehrend = KLASSE.has(declaration.type) ? klasseLaeuft(declaration) : laeuft(declaration);
  return { ...LEER, einheiten: [einheit([ANONYM], declaration, { veraenderlich: false, ausfuehrend })], exporte: [[STANDARD, { lokal: ANONYM }]] };
}

function exportiereAlles(anweisung) {
  if (anweisung.exported === null) return { ...LEER, sterne: [anweisung.source.value] };
  return { ...LEER, exporte: [[nameVon(anweisung.exported), { quelle: anweisung.source.value, importiert: STERN }]] };
}

const ANWEISUNGEN = new Map(Object.entries({
  ImportDeclaration: importiere,
  ExportNamedDeclaration: exportiereBenannt,
  ExportDefaultDeclaration: exportiereStandard,
  ExportAllDeclaration: exportiereAlles,
  FunctionDeclaration: (anweisung) => ohneExporte(deklariere(anweisung)),
  ClassDeclaration: (anweisung) => ohneExporte(deklariere(anweisung)),
  VariableDeclaration: (anweisung) => ohneExporte(deklariere(anweisung)),
}));

function teilVon(anweisung) {
  const bearbeite = ANWEISUNGEN.get(anweisung.type);
  if (bearbeite !== undefined) return bearbeite(anweisung);
  return { ...LEER, modulcode: [{ json: baumText(anweisung), bezuege: bezuegeIn(anweisung) }] };
}

function zuKarte(paare) {
  const karte = new Map(paare);
  return karte.size === paare.length ? karte : null;
}

function ablaufVon(teil) {
  const quellen = new Set(teil.importe.map(([, ziel]) => ziel.quelle));
  return [
    ...[...quellen].map((quelle) => `I:${quelle}`),
    ...teil.exporte.filter(([, ziel]) => ziel.quelle !== undefined).map(([, ziel]) => `R:${ziel.quelle}`),
    ...teil.sterne.map((quelle) => `S:${quelle}`),
    ...teil.modulcode.map(({ json }) => `M:${json}`),
    ...teil.einheiten.map(({ namen }) => `D:${namen.join(",")}`),
  ];
}

export function modell(text) {
  const baum = lies(text);
  if (baum === null) return null;
  const teile = baum.body.map(teilVon);
  const alle = (feld) => teile.flatMap((teil) => teil[feld]);
  const einheiten = zuKarte(alle("einheiten").flatMap((eintrag) => eintrag.namen.map((name) => [name, eintrag])));
  const exporte = zuKarte(alle("exporte"));
  const importe = zuKarte(alle("importe"));
  if (einheiten === null || exporte === null || importe === null) return null;
  return { einheiten, importe, exporte, modulcode: alle("modulcode"), ablauf: teile.flatMap(ablaufVon), dynamisch: bezuegeIn(baum).has(EVAL) };
}

function ladenBetroffen(stand, betroffen) {
  const getroffen = [...new Set(stand.einheiten.values())].filter((eintrag) => eintrag.namen.some((name) => betroffen.has(name)));
  const code = getroffen.some((eintrag) => eintrag.veraenderlich || eintrag.ausfuehrend);
  return code || stand.modulcode.some(({ bezuege }) => [...bezuege].some((name) => betroffen.has(name)));
}

function erweitere(stand, anfang) {
  const einheiten = [...new Set(stand.einheiten.values())];
  const betroffen = new Set(anfang);
  const hinzu = () => einheiten.filter((eintrag) => eintrag.namen.some((name) => !betroffen.has(name)) && [...eintrag.bezuege].some((name) => betroffen.has(name)));
  for (let neue = hinzu(); neue.length > 0; neue = hinzu()) for (const eintrag of neue) for (const name of eintrag.namen) betroffen.add(name);
  return betroffen;
}

export function huelle(stand, anfang) {
  const betroffen = erweitere(stand, anfang);
  if (ladenBetroffen(stand, betroffen)) return ALLES;
  const namen = [...stand.exporte].filter(([, ziel]) => ziel.lokal !== undefined && betroffen.has(ziel.lokal)).map(([name]) => name);
  return { alle: false, namen };
}

function unterschiedlicheSchluessel(links, rechts, wert) {
  return [...new Set([...links.keys(), ...rechts.keys()])].filter((schluessel) => wert(links.get(schluessel)) !== wert(rechts.get(schluessel)));
}

function gemeinsamerAblauf(liste, andere) {
  return JSON.stringify(liste.filter((schritt) => !schritt.startsWith("D:") || andere.includes(schritt)));
}

function gleicherAblauf(alt, neu) {
  return gemeinsamerAblauf(alt.ablauf, neu.ablauf) === gemeinsamerAblauf(neu.ablauf, alt.ablauf);
}

function unsicher(alt, neu) {
  return alt === null || neu === null || alt.dynamisch || neu.dynamisch || !gleicherAblauf(alt, neu);
}

export function unterschied(altText, neuText) {
  const alt = modell(altText);
  const neu = modell(neuText);
  if (unsicher(alt, neu)) return ALLES;
  const beschreibung = (eintrag) => JSON.stringify(eintrag ?? null);
  const anfang = [...unterschiedlicheSchluessel(alt.einheiten, neu.einheiten, (eintrag) => eintrag?.json), ...unterschiedlicheSchluessel(alt.importe, neu.importe, beschreibung)];
  const direkt = unterschiedlicheSchluessel(alt.exporte, neu.exporte, beschreibung);
  if (altText !== neuText && anfang.length === 0 && direkt.length === 0) return ALLES;
  const seiten = [huelle(alt, anfang), huelle(neu, anfang)];
  if (seiten.some(({ alle }) => alle)) return ALLES;
  return { alle: false, namen: [...new Set([...direkt, ...seiten.flatMap(({ namen }) => namen)])].sort() };
}
