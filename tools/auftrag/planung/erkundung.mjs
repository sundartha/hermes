import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pid } from "node:process";

import { TEST_FILE } from "../../testgraph.mjs";
import { funktionenIn } from "../../ziele/funktionen.mjs";
import { geschuetzteMuster, istGeschuetzt, istTestdatei, pfadIstSauber } from "../format.mjs";
import { zeilenDes } from "../zeilen.mjs";
import { suchTreffer, testTreffer } from "./suche.mjs";

const JSON_EINRUECKUNG = 2;
export const ROLLEN = ["eingang", "logik", "speicher", "wirkung"];
const PFLICHT_ROLLEN = ["eingang", "wirkung"];
export const ANGABEN = ["weg", "aenderungen", "tests", "schema", "codeowners", "ownerEntscheidung", "eingangImTest", "widersprueche"];
const NICHT_GEFUNDEN = "nicht gefunden";
const WEITERE_AUSWEGE = { aenderungen: "keine Änderung", ownerEntscheidung: "keine", eingangImTest: "nicht erreichbar" };
const AUSWEG = /^(nicht gefunden|keine Änderung|keine|nicht erreichbar), weil(.*)$/su;
const ERREICHBAR = "erreichbar";
export const GRUND = /\p{L}{3,}/u;
const MIT_AENDERUNG = /^[ST]/;
const WENN = /^\s*Wenn\s/;
const IN_BACKTICKS = /`([^`]+)`/g;
const ROUTE = /^(?:GET|POST|PUT|PATCH|DELETE)\s+(\S+)$/;
const WERT = /^[^\s:"]+:\s*("[^"]+")$/;
export const PLATZHALTER = "<AUSFUELLEN>";
export const NUTZEN = "nutzen";
const KEIN_TREFFER_PASST = /^kein Treffer passt, weil(.*)$/su;

export function istObjekt(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

export function istText(wert) {
  return typeof wert === "string" && wert.trim() !== "";
}

export function liste(wert) {
  return Array.isArray(wert) ? wert : [];
}

export function schreibeJsonAtomar(datei, wert) {
  const zwischen = `${datei}.${pid}.tmp`;
  writeFileSync(zwischen, `${JSON.stringify(wert, null, JSON_EINRUECKUNG)}\n`);
  renameSync(zwischen, datei);
}

function istZeile(wert) {
  return Number.isInteger(wert) && wert >= 1;
}

function quelle(kontext, datei) {
  if (!kontext.quellen.has(datei)) kontext.quellen.set(datei, readFileSync(join(kontext.root, datei), "utf8"));
  return kontext.quellen.get(datei);
}

function funktionsnamen(datei, kontext) {
  return funktionenIn(datei, quelle(kontext, datei)).map(({ name }) => name);
}

function auswegBefund({ ort, feld }, wert, kontext) {
  const treffer = AUSWEG.exec(wert);
  if (treffer === null) return `${ort}: ${feld} ist weder eine Angabe noch „${NICHT_GEFUNDEN}, weil …“`;
  const [, art, grund] = treffer;
  if (art !== NICHT_GEFUNDEN && WEITERE_AUSWEGE[feld] !== art) return `${ort}: „${art}, weil …“ ist für ${feld} kein Ausweg`;
  if (!GRUND.test(grund)) return `${ort}: ${feld} nennt „${art}, weil …“ ohne Grund`;
  kontext.annahmen.push({ nummer: kontext.nummer, angabe: feld, text: wert.trim() });
  return null;
}

function zeilenBefund(ort, { von, bis }) {
  return istZeile(von) && istZeile(bis) && von <= bis ? null : `${ort}: Zeilen ${von}-${bis} sind keine Zeilen von-bis`;
}

function funktionBefund(ort, stelle, kontext) {
  const { datei, funktion, von, bis } = stelle;
  const gleichnamig = funktionenIn(datei, quelle(kontext, datei)).filter(({ name }) => name === funktion);
  if (gleichnamig.length === 0) return `${ort}: Funktion ${funktion} fehlt in ${datei}`;
  const zeilen = zeilenBefund(ort, stelle);
  if (zeilen !== null) return zeilen;
  if (gleichnamig.some((gefunden) => gefunden.von <= von && bis <= gefunden.bis)) return null;
  const bereiche = gleichnamig.map((gefunden) => `${gefunden.von}-${gefunden.bis}`).join(", ");
  return `${ort}: Zeilen ${von}-${bis} liegen nicht in der Funktion ${funktion} (${bereiche}) in ${datei}`;
}

function pfadBefund(ort, datei) {
  if (!istText(datei)) return `${ort}: datei fehlt`;
  return pfadIstSauber(datei) ? null : `${ort}: ${datei} muss ein relativer Pfad im Repo sein`;
}

function dateiBefund(ort, { datei, art = "Datei" }, kontext) {
  const befund = pfadBefund(ort, datei);
  if (befund !== null) return befund;
  const pfad = join(kontext.root, datei);
  if (!existsSync(pfad)) return `${ort}: ${art} ${datei} fehlt`;
  return statSync(pfad).isFile() ? null : `${ort}: ${datei} ist keine Datei`;
}

function stelleBefund(ort, stelle, kontext) {
  const befund = dateiBefund(ort, stelle, kontext);
  if (befund !== null) return befund;
  if (!istText(stelle.funktion)) return `${ort}: funktion fehlt`;
  return funktionBefund(ort, stelle, kontext);
}

function teilBefund(ort, stelle, kontext) {
  const { datei, art, von, bis } = stelle;
  const befund = dateiBefund(ort, { datei }, kontext) ?? zeilenBefund(ort, stelle);
  if (befund !== null) return befund;
  const anzahl = zeilenDes(quelle(kontext, datei)).length;
  if (bis > anzahl) return `${ort}: Zeilen ${von}-${bis} gibt es in ${datei} nicht (${anzahl} Zeilen)`;
  const ueberdeckt = funktionenIn(datei, quelle(kontext, datei)).filter((funktion) => funktion.von <= bis && von <= funktion.bis);
  if (ueberdeckt.length === 0) return null;
  const namen = ueberdeckt.map(({ name, von: anfang, bis: ende }) => `${name} (${anfang}-${ende})`).join(", ");
  return `${ort}: Zeilen ${von}-${bis} überdecken die Funktion ${namen} in ${datei}; eine Stelle in einer Funktion nennt funktion statt art ${art}`;
}

function bestehendeStelleBefund(ort, stelle, kontext) {
  return istText(stelle.art) && stelle.funktion === undefined ? teilBefund(ort, stelle, kontext) : stelleBefund(ort, stelle, kontext);
}

function neueDateiBefund(ort, datei, kontext) {
  const befund = pfadBefund(ort, datei);
  if (befund !== null) return befund;
  return existsSync(join(kontext.root, datei)) ? `${ort}: Datei ${datei} gibt es schon` : null;
}

function neueStelleBefund(ort, stelle, kontext) {
  if (stelle.neueZeilen < 1) return `${ort}: eine neue ${stelle.neu} braucht mindestens eine neue Zeile`;
  if (stelle.neu === "datei") return neueDateiBefund(ort, stelle.datei, kontext);
  const befund = dateiBefund(ort, stelle, kontext);
  if (befund !== null) return befund;
  if (!istText(stelle.funktion)) return `${ort}: funktion fehlt`;
  return funktionsnamen(stelle.datei, kontext).includes(stelle.funktion) ? `${ort}: Funktion ${stelle.funktion} gibt es schon in ${stelle.datei}` : null;
}

function wegEintragBefund(ort, eintrag, kontext) {
  if (!istObjekt(eintrag) || !ROLLEN.includes(eintrag.rolle)) return `${ort}: rolle muss eine von ${ROLLEN.join(", ")} sein`;
  if (eintrag.ausweg === undefined && istText(eintrag.datei) && istTestdatei(eintrag.datei)) return `${ort}: Stelle des Wegs liegt in der Testdatei ${eintrag.datei}`;
  if (eintrag.ausweg === undefined) return stelleBefund(ort, eintrag, kontext);
  if (typeof eintrag.ausweg !== "string") return `${ort}: ausweg ist kein Text`;
  return auswegBefund({ ort, feld: `weg ${eintrag.rolle}` }, eintrag.ausweg, kontext);
}

function wegBefunde(ort, weg, kontext) {
  const befunde = weg.map((eintrag, stelle) => wegEintragBefund(`${ort} weg[${stelle}]`, eintrag, kontext)).filter(Boolean);
  const rollen = new Set(weg.map((eintrag) => eintrag?.rolle));
  const fehlend = PFLICHT_ROLLEN.filter((rolle) => !rollen.has(rolle));
  return [...befunde, ...fehlend.map((rolle) => `${ort}: Weg ohne Stelle mit Rolle ${rolle} und ohne Ausweg`)];
}

function trefferJeBegriff(begriff, kontext) {
  if (!kontext.suchen.has(begriff)) kontext.suchen.set(begriff, suchTreffer(begriff, kontext.root));
  return kontext.suchen.get(begriff);
}

const DATEI_ZEILE = /^(.+):(\d+)$/;

function trefferInFundDatei(stelle, gefunden, kontext) {
  const teile = DATEI_ZEILE.exec(typeof stelle === "string" ? stelle : "");
  if (teile === null || !gefunden.some((fund) => fund.startsWith(`${teile[1]}:`))) return false;
  const zeile = Number(teile[2]);
  return istZeile(zeile) && zeile <= zeilenDes(quelle(kontext, teile[1])).length;
}

function istNutzenAngabe(nutzen) {
  return istObjekt(nutzen) && istText(nutzen.datei) && istText(nutzen.funktion);
}

function nutzenBefund(ort, { nutzen, treffer }, kontext) {
  if (!istNutzenAngabe(nutzen)) return `${ort}: urteil „${NUTZEN}“ braucht nutzen mit datei und funktion`;
  if (!treffer.some((stelle) => stelle.startsWith(`${nutzen.datei}:`))) return `${ort}: nutzen nennt ${nutzen.datei}, das unter treffer nicht vorkommt`;
  const befund = dateiBefund(ort, nutzen, kontext);
  if (befund !== null) return befund;
  return funktionsnamen(nutzen.datei, kontext).includes(nutzen.funktion) ? null : `${ort}: Funktion ${nutzen.funktion} fehlt in ${nutzen.datei}`;
}

function urteilBefund(ort, vorhanden, kontext) {
  if (vorhanden.urteil === NUTZEN) return nutzenBefund(ort, vorhanden, kontext);
  const grund = KEIN_TREFFER_PASST.exec(vorhanden.urteil ?? "");
  if (grund === null) return `${ort}: urteil muss „${NUTZEN}“ oder „kein Treffer passt, weil …“ sein`;
  if (!GRUND.test(grund[1])) return `${ort}: „kein Treffer passt, weil …“ ohne Grund`;
  kontext.annahmen.push({ nummer: kontext.nummer, angabe: "vorhanden", text: `${ort}: ${vorhanden.urteil.trim()} (${vorhanden.beleg})` });
  return null;
}

function suchErgebnis(ort, { name, begriffe }, kontext) {
  if (!begriffe.some((begriff) => begriff !== name)) return { befund: `${ort}: vorhanden.suche nennt keinen Suchbegriff außer dem neuen Namen ${name}` };
  const jeBegriff = begriffe.map((begriff) => [begriff, trefferJeBegriff(begriff, kontext)]);
  const ungueltig = jeBegriff.find(([, gefunden]) => gefunden === null);
  if (ungueltig !== undefined) return { befund: `${ort}: Suchbegriff ${ungueltig[0]} ist kein gültiges Muster für suche` };
  if (!jeBegriff.some(([begriff, stellen]) => begriff !== name && stellen.length > 0)) return { befund: `${ort}: die Suche nach ${begriffe.join(", ")} findet im Code nichts; nenn Begriffe der Regel, die im Code vorkommen (Literale, Schlüssel, Feldnamen aus deinem Weg)` };
  return { gefunden: jeBegriff.flatMap(([, stellen]) => stellen) };
}

function trefferBefund(ort, { begriffe, gefunden, treffer }, kontext) {
  const pruefbar = [...gefunden, ...begriffe.flatMap((begriff) => testTreffer(begriff, kontext.root))];
  const erfunden = treffer.filter((stelle) => !trefferInFundDatei(stelle, pruefbar, kontext));
  if (erfunden.length > 0) return `${ort}: treffer ${erfunden.join(", ")} liegt in keiner Datei, in der die Suche nach ${begriffe.join(", ")} etwas findet, oder die Zeile gibt es dort nicht`;
  return treffer.length === 0 ? `${ort}: die Suche nach ${begriffe.join(", ")} hat ${gefunden.length} Treffer, treffer nennt keinen` : null;
}

function vorhandenBefund(ort, stelle, kontext) {
  const name = stelle.neu === "datei" ? stelle.datei : stelle.funktion;
  const { vorhanden } = stelle;
  if (!istObjekt(vorhanden)) return `${ort}: neue ${stelle.neu} ${name} ohne vorhanden; such zuerst mit suche nach Namen, Literalen und der Regel selbst und nenn Suchbegriffe, Treffer und Urteil`;
  const begriffe = liste(vorhanden.suche).filter(istText);
  const { befund, gefunden } = suchErgebnis(ort, { name, begriffe }, kontext);
  if (befund !== undefined) return befund;
  const treffer = liste(vorhanden.treffer);
  const trefferFehler = trefferBefund(ort, { begriffe, gefunden, treffer }, kontext);
  if (trefferFehler !== null) return trefferFehler;
  return urteilBefund(ort, { ...vorhanden, treffer, beleg: `Suche nach ${begriffe.join(", ")}: ${gefunden.length} Funde` }, kontext);
}

function neueAenderungBefund(ort, stelle, kontext) {
  return neueStelleBefund(ort, stelle, kontext) ?? vorhandenBefund(ort, stelle, kontext);
}

function aenderungBefund(ort, stelle, kontext) {
  if (!istObjekt(stelle)) return `${ort}: Änderungsstelle ist kein Objekt`;
  if (!Number.isInteger(stelle.neueZeilen) || stelle.neueZeilen < 0) return `${ort}: neueZeilen fehlt (grobe Schätzung neuer Zeilen)`;
  if (stelle.neu === undefined) return bestehendeStelleBefund(ort, stelle, kontext);
  return ["datei", "funktion"].includes(stelle.neu) ? neueAenderungBefund(ort, stelle, kontext) : `${ort}: neu muss „datei“ oder „funktion“ sein`;
}

function aenderungenBefunde(ort, aenderungen, kontext) {
  const befunde = aenderungen.map((stelle, nr) => aenderungBefund(`${ort} aenderungen[${nr}]`, stelle, kontext)).filter(Boolean);
  if (aenderungen.length === 0 && MIT_AENDERUNG.test(kontext.nummer)) befunde.push(`${ort}: ohne Änderungsstelle und ohne „keine Änderung, weil …“`);
  const gemeldet = new Set(Array.isArray(kontext.angaben.codeowners) ? kontext.angaben.codeowners : []);
  const geschuetzt = aenderungen.map((stelle) => stelle?.datei).filter((datei) => istText(datei) && istGeschuetzt(kontext.muster, datei));
  const ungemeldet = [...new Set(geschuetzt)].filter((datei) => !gemeldet.has(datei));
  return [...befunde, ...ungemeldet.map((datei) => `${ort}: Änderungsdatei ${datei} steht in CODEOWNERS, fehlt unter codeowners`)];
}

function testsBefunde(ort, tests, kontext) {
  if (tests.length === 0) return [`${ort}: tests ist leer; ohne bestehenden Test „${NICHT_GEFUNDEN}, weil …“`];
  return tests.map((test) => (TEST_FILE.test(test) ? dateiBefund(ort, { datei: test, art: "Test" }, kontext) : `${ort}: ${test} ist keine Testdatei test/….test.js`)).filter(Boolean);
}

function codeownersBefunde(ort, dateien, kontext) {
  return dateien.filter((datei) => !pfadIstSauber(datei) || !istGeschuetzt(kontext.muster, datei)).map((datei) => `${ort}: codeowners nennt ${datei}, das nicht in CODEOWNERS steht`);
}

function widerspruchBefunde(ort, widersprueche) {
  const ohneFundstellen = widersprueche.filter((eintrag) => !istText(eintrag?.designDoc) || !istText(eintrag?.code));
  return ohneFundstellen.map(() => `${ort}: Widerspruch ohne beide Fundstellen (designDoc und code)`);
}

function fundstelleBefunde(ort, feld, wert) {
  return istText(wert?.fundstelle) ? [] : [`${ort}: ${feld} braucht eine Fundstelle`];
}

const LISTEN = new Map([
  ["weg", wegBefunde],
  ["aenderungen", aenderungenBefunde],
  ["tests", testsBefunde],
  ["codeowners", codeownersBefunde],
  ["widersprueche", widerspruchBefunde],
]);

function schemaBefunde(ort, schema) {
  return typeof schema?.aenderung === "boolean" ? fundstelleBefunde(ort, "schema", schema) : [`${ort}: schema.aenderung muss ja (true) oder nein (false) sein`];
}

function textBefunde(ort, feld, kontext) {
  const wert = kontext.angaben[feld];
  if (feld === "eingangImTest" && wert === ERREICHBAR) return [];
  return [auswegBefund({ ort, feld }, wert, kontext)].filter(Boolean);
}

function angabeBefunde(ort, feld, kontext) {
  const wert = kontext.angaben[feld];
  if (wert === undefined) return [`${ort}: Angabe ${feld} fehlt`];
  if (istText(wert)) return textBefunde(ort, feld, kontext);
  const listenBefunde = LISTEN.get(feld);
  if (listenBefunde !== undefined) return Array.isArray(wert) ? listenBefunde(ort, wert, kontext) : [`${ort}: ${feld} muss eine Liste sein`];
  if (!istObjekt(wert)) return [`${ort}: ${feld} hat keine gültige Angabe`];
  if (feld === "schema") return schemaBefunde(ort, wert);
  if (feld !== "ownerEntscheidung") return [`${ort}: ${feld} hat keine gültige Angabe`];
  return istText(wert.text) ? fundstelleBefunde(ort, feld, wert) : [`${ort}: ownerEntscheidung braucht den Text der Entscheidung`];
}

export function namenImWenn(text) {
  const wenn = (text ?? "").split("\n").filter((zeile) => WENN.test(zeile));
  return wenn.flatMap((zeile) => [...zeile.matchAll(IN_BACKTICKS)].map(([, name]) => name));
}

function geplanteAuswege(weg, aenderungen) {
  const geaendert = new Set(liste(aenderungen).map((stelle) => stelle?.datei));
  return weg.filter((eintrag) => eintrag?.rolle === "eingang" && typeof eintrag.ausweg === "string" && istText(eintrag.datei) && geaendert.has(eintrag.datei)).map(({ ausweg }) => ausweg);
}

function testTexte(kontext) {
  const tests = liste(kontext.angaben.tests).filter((test) => TEST_FILE.test(test) && dateiBefund("", { datei: test }, kontext) === null);
  return tests.map((test) => quelle(kontext, test));
}

function kommtVor(texte, teile) {
  const gesucht = teile.filter(Boolean);
  return texte.some((text) => gesucht.some((teil) => text.includes(teil)));
}

function wennBefunde(ort, kontext) {
  const { weg, aenderungen } = kontext.angaben;
  const eingaenge = Array.isArray(weg) ? weg.filter((eintrag) => eintrag?.rolle === "eingang" && eintrag.ausweg === undefined) : [];
  const dateien = eingaenge.map(({ datei }) => datei).filter((datei) => istText(datei) && existsSync(join(kontext.root, datei)));
  if (dateien.length === 0) return [];
  const texte = [...dateien.map((datei) => quelle(kontext, datei)), ...geplanteAuswege(weg, aenderungen)];
  const tests = testTexte(kontext);
  const szenario = kontext.soll.get(kontext.nummer);
  const fehlend = namenImWenn(szenario?.text).filter((name) => !kommtVor(texte, [name, ROUTE.exec(name)?.[1]]) && !kommtVor(tests, [name, WERT.exec(name)?.[1]]));
  const weiter = "; steht er schon wörtlich in einer bestehenden Testdatei, melde sie unter tests; entsteht er erst neu, melde ihn als Eingang mit datei und ausweg „nicht gefunden, weil";
  return fehlend.map((name) => `${ort}: \`${name}\` aus dem Wenn steht in keiner gemeldeten Eingangsdatei (${dateien.join(", ")}) und in keiner unter tests gemeldeten Testdatei${weiter} \`${name}\` entsteht neu in <Datei>“ und mit einer Änderung in dieser Datei`);
}

function nummerBefunde(nummer, angaben, kontext) {
  if (!istObjekt(angaben)) return [`${nummer}: Angaben fehlen`];
  const eigener = { ...kontext, nummer, angaben };
  return [...ANGABEN.flatMap((feld) => angabeBefunde(nummer, feld, eigener)), ...wennBefunde(nummer, eigener)];
}

export function erkundungBefunde(bericht, { gruppe, soll, root }) {
  const annahmen = [];
  const nummern = bericht?.nummern;
  if (!istObjekt(nummern)) return { befunde: ["nummern fehlt: je Nummer der Gruppe ein Objekt mit den Angaben"], annahmen };
  const kontext = { root, soll, annahmen, muster: geschuetzteMuster(root), quellen: new Map(), suchen: new Map() };
  const befunde = gruppe.filter((nummer) => !Object.hasOwn(nummern, nummer)).map((nummer) => `${nummer}: Nummer der Gruppe fehlt im Bericht`);
  for (const [nummer, angaben] of Object.entries(nummern)) {
    if (gruppe.includes(nummer) && !soll.has(nummer)) befunde.push(`${nummer}: steht nicht in den Soll-Nummern`);
    else if (gruppe.includes(nummer)) befunde.push(...nummerBefunde(nummer, angaben, kontext));
    else befunde.push(`${nummer}: gehört nicht zur Gruppe ${gruppe.join(", ")}`);
  }
  for (const nummer of gruppe.filter((eigene) => Object.hasOwn(nummern, eigene))) befunde.push(...platzhalterBefunde(nummer, nummern[nummer]));
  return { befunde, annahmen };
}

function platzhalterFelder(wert, feld) {
  if (typeof wert === "string") return wert.includes(PLATZHALTER) ? [feld] : [];
  if (Array.isArray(wert)) return wert.flatMap((eintrag, stelle) => platzhalterFelder(eintrag, `${feld}[${stelle}]`));
  return istObjekt(wert) ? Object.entries(wert).flatMap(([name, inhalt]) => platzhalterFelder(inhalt, `${feld}.${name}`)) : [];
}

function platzhalterBefunde(nummer, angaben) {
  const felder = istObjekt(angaben) ? Object.entries(angaben).flatMap(([feld, wert]) => platzhalterFelder(wert, feld)) : [];
  return felder.map((feld) => `${nummer}: ${feld} enthält noch den Platzhalter ${PLATZHALTER}`);
}

function geruestStelle(rolle) {
  return { rolle, datei: PLATZHALTER, funktion: PLATZHALTER, von: PLATZHALTER, bis: PLATZHALTER };
}

function geruestAngaben() {
  return {
    weg: [geruestStelle("eingang"), geruestStelle("wirkung")],
    aenderungen: [{ datei: PLATZHALTER, funktion: PLATZHALTER, von: PLATZHALTER, bis: PLATZHALTER, neueZeilen: PLATZHALTER }],
    tests: [PLATZHALTER],
    schema: { aenderung: PLATZHALTER, fundstelle: PLATZHALTER },
    codeowners: [PLATZHALTER],
    ownerEntscheidung: PLATZHALTER,
    eingangImTest: PLATZHALTER,
    widersprueche: [PLATZHALTER],
  };
}

export function berichtsGeruest(nummern) {
  return { nummern: Object.fromEntries(nummern.map((nummer) => [nummer, geruestAngaben()])), hinweise: [] };
}

export function aenderungsStellen(berichte) {
  return berichte.flatMap((bericht) =>
    Object.entries(bericht?.nummern ?? {}).flatMap(([nummer, angaben]) => {
      const aenderungen = Array.isArray(angaben?.aenderungen) ? angaben.aenderungen : [];
      return aenderungen.filter((stelle) => istText(stelle?.datei)).map((stelle) => ({ ...stelle, nummer }));
    }),
  );
}

function istNutzen(vorhanden) {
  return vorhanden?.urteil === NUTZEN && istNutzenAngabe(vorhanden.nutzen);
}

function gibtNutzenWeiter(stelle) {
  return stelle.neu !== undefined && istNutzen(stelle.vorhanden);
}

function nutzenDerStelle(stelle, dateien) {
  if (!dateien.includes(stelle.datei) || !gibtNutzenWeiter(stelle)) return [];
  const { datei, funktion } = stelle.vorhanden.nutzen;
  return [{ datei, funktion, fuer: stelle.funktion ?? stelle.datei }];
}

export function nutzenOhneAuftrag(berichte, auftraege) {
  const genannt = new Set(auftraege.flatMap((auftrag) => liste(auftrag.erwarteteDateien)));
  const verwaist = aenderungsStellen(berichte).filter((stelle) => gibtNutzenWeiter(stelle) && !genannt.has(stelle.datei));
  return verwaist.map(({ nummer, datei, funktion, vorhanden: { nutzen } }) => `${nummer}: neue Stelle ${funktion ?? datei} in ${datei} soll ${nutzen.datei}:${nutzen.funktion} nutzen, aber kein Auftrag nennt ${datei} unter erwarteteDateien`);
}

export function nutzenFuer(berichte, dateien) {
  const eintraege = aenderungsStellen(berichte).flatMap((stelle) => nutzenDerStelle(stelle, dateien));
  const schluessel = (eintrag) => `${eintrag.datei}:${eintrag.funktion}`;
  return eintraege.filter((eintrag, stelle) => eintraege.findIndex((frueher) => schluessel(frueher) === schluessel(eintrag)) === stelle);
}
