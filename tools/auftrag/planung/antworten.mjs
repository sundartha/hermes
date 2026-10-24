import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { istKennung, istUmbau, pfadIstSauber } from "../format.mjs";
import { abschnitte } from "./abschnitte.mjs";
import { GRUND, istObjekt, istText, liste } from "./erkundung.mjs";

const FUNDSTELLEN = /\(Fundstellen:\s*(.+)\)\s*$/;
const FUNDSTELLEN_TRENNER = ";";
const MINDESTENS_FUNDSTELLEN = 2;
const DOKUMENT_STELLE = /^(pitch\.md|design\.md|sicherheit\.md),\s*(\S.*)$/;
const DATEI_STELLE = /^(.+):([1-9]\d*)$/;
const FORM_DATEI = "<Datei>:<Zeile>";
const FORM_DOKUMENT = "<pitch.md|design.md|sicherheit.md>, <Überschrift>";
const ERFUELLT = "erfüllt";
const BEFUND = "befund";
const TRIFFT_NICHT_ZU = /^trifft nicht zu, weil(.*)$/su;
const KORRIGIERT = /^korrigiert:\s*\S/u;
const MIT_AUFTRAG = new Set(["durchstich", "umbau", "nie-saetze", "bereichsgrund", "allein-gruen", "nicht-zusammengelegt", "falsche-angabe"]);
const B_NUMMER = /^B/;
const WEG = "weg";
const OHNE_AUFTRAEGE = {};
export const DURCHSTICH_ZEILE = "durchstich:a1";
const SCHNITT_LISTEN = ["annahmen", "ownerAufgaben", "fehlendeSzenarien", "gemeinsameNamen"];
const GRUNDLAGE = /^Grundlage:/;
const FEHLERFAELLE = /^Fehlerfälle:/;
const BERECHNETE_ZEILE = /^(Aufträge|Reihenfolge):/m;
const LETZTER_ZEILENUMBRUCH = /\n$/;
const KUERZEL = /^t[1-9]\d*$/u;
const TEIL_LISTEN = ["nummern", "tWege", "dateien", "abhaengigVon"];

function dokumentStelleBefund(fundstelle, [, name, ueberschrift], dokumente) {
  const text = dokumente[name];
  if (text === undefined) return `Fundstelle „${fundstelle}“: ${name} gibt es nicht`;
  const { befunde } = abschnitte(text, [ueberschrift]);
  return befunde.length === 0 ? null : `Fundstelle „${fundstelle}“: die Überschrift steht nicht genau einmal in ${name}`;
}

function zeilenzahl(text) {
  return text === "" ? 0 : text.replace(LETZTER_ZEILENUMBRUCH, "").split("\n").length;
}

function dateiStelleBefund(fundstelle, [, datei, zeile], root) {
  const pfad = join(root, datei);
  if (!pfadIstSauber(datei) || !existsSync(pfad) || !statSync(pfad).isFile()) return `Fundstelle „${fundstelle}“: ${datei} ist keine Datei im Repo`;
  const zeilen = zeilenzahl(readFileSync(pfad, "utf8"));
  return Number(zeile) <= zeilen ? null : `Fundstelle „${fundstelle}“: ${datei} hat keine Zeile ${zeile}`;
}

export function fundstelleBefund(fundstelle, { root, dokumente }) {
  if (!istText(fundstelle)) return "Fundstelle fehlt";
  const text = fundstelle.trim();
  const dokument = DOKUMENT_STELLE.exec(text);
  if (dokument) return dokumentStelleBefund(text, dokument, dokumente);
  const datei = DATEI_STELLE.exec(text);
  if (datei) return dateiStelleBefund(text, datei, root);
  return `Fundstelle „${text}“ ist weder ${FORM_DATEI} noch ${FORM_DOKUMENT}`;
}

export function zerlegungBefunde(zeile, kontext) {
  const treffer = FUNDSTELLEN.exec(zeile);
  const fundstellen = treffer ? treffer[1].split(FUNDSTELLEN_TRENNER).map((teil) => teil.trim()) : [];
  if (fundstellen.length < MINDESTENS_FUNDSTELLEN) return ["„Zerlegung passt nicht“ nennt nicht zwei Fundstellen in der Form (Fundstellen: <Fundstelle>; <Fundstelle>)"];
  return fundstellen.map((fundstelle) => fundstelleBefund(fundstelle, kontext)).filter(Boolean);
}

function istTextListe(wert) {
  return Array.isArray(wert) && wert.every(istText);
}

function gruppeFelderBefunde(gruppe, ort) {
  const befunde = [];
  if (liste(gruppe.nummern).length === 0 || !istTextListe(gruppe.nummern)) befunde.push(`${ort}: nummern muss eine Liste von Nummern sein`);
  if (!istText(gruppe.eingang)) befunde.push(`${ort}: eingang fehlt`);
  if (!istTextListe(gruppe.fragen)) befunde.push(`${ort}: fragen muss eine Liste von Texten sein`);
  return befunde;
}

function ueberschriftenBefunde(ueberschriften, ort, designText) {
  if (!istTextListe(ueberschriften)) return [`${ort}: ueberschriften muss eine Liste von Überschriften sein`];
  if (designText === undefined && ueberschriften.length > 0) return [`${ort}: es gibt kein Design Doc, aus dem Überschriften stammen könnten`];
  return abschnitte(designText ?? "", ueberschriften).befunde.map((befund) => `${ort}: ${befund}`);
}

function gruppeFormBefunde(gruppe, ort, designText) {
  if (!istObjekt(gruppe)) return [`${ort}: ist kein Objekt`];
  return [...gruppeFelderBefunde(gruppe, ort), ...ueberschriftenBefunde(gruppe.ueberschriften, ort, designText)];
}

export function gliederungBefunde(gliederung, soll, designText) {
  const gruppen = gliederung?.gruppen;
  if (!Array.isArray(gruppen) || gruppen.length === 0) return ["gruppen fehlt: eine Liste von Erkundungsgruppen"];
  const befunde = gruppen.flatMap((gruppe, stelle) => gruppeFormBefunde(gruppe, `Gruppe ${stelle + 1}`, designText));
  const anzahl = new Map();
  for (const nummer of gruppen.flatMap((gruppe) => liste(gruppe?.nummern))) anzahl.set(nummer, (anzahl.get(nummer) ?? 0) + 1);
  for (const nummer of soll.keys()) {
    const zahl = anzahl.get(nummer) ?? 0;
    if (zahl !== 1) befunde.push(`${nummer} steht in ${zahl} Gruppen statt in genau einer`);
  }
  const fremd = [...anzahl.keys()].filter((nummer) => !soll.has(nummer));
  return [...befunde, ...fremd.map((nummer) => `${nummer} ist keine Nummer der Liste`)];
}

function teilFormBefunde(teil, stelle) {
  const ort = `Teil ${stelle + 1}`;
  if (!istObjekt(teil)) return [`${ort}: ist kein Objekt`];
  const befunde = TEIL_LISTEN.filter((feld) => !istTextListe(teil[feld])).map((feld) => `${ort}: ${feld} ist keine Liste von Texten`);
  if (!KUERZEL.test(String(teil.kuerzel))) befunde.unshift(`${ort}: kuerzel braucht die Form t<n>`);
  if (!istKennung(teil.name)) befunde.push(`${ort}: name ist keine Kennung aus Buchstaben, Ziffern und Bindestrichen`);
  if (typeof teil.nurUmbau !== "boolean") befunde.push(`${ort}: nurUmbau ist kein Wahrheitswert`);
  if (!istText(teil.grund)) befunde.push(`${ort}: grund fehlt`);
  if (teil.umbau !== undefined && !istTextListe(teil.umbau)) befunde.push(`${ort}: umbau ist keine Liste von Texten`);
  if (istTextListe(teil.dateien)) befunde.push(...teil.dateien.filter((datei) => !pfadIstSauber(datei)).map((datei) => `${ort}: ${datei} unter dateien ist kein relativer Pfad im Repo ohne ., .. und \\`));
  return befunde;
}

function doppelteBefunde(teile, feld) {
  const werte = teile.map((teil) => teil?.[feld]);
  const doppelt = [...new Set(werte.filter((eintrag, stelle) => werte.indexOf(eintrag) !== stelle))];
  return doppelt.map((eintrag) => `${feld} ${eintrag} steht in mehreren Teilen`);
}

export function teilungBefunde(wert) {
  const teile = wert?.teile;
  if (!Array.isArray(teile) || teile.length === 0) return ["teile fehlt: eine Liste von Teilen"];
  return [...teile.flatMap(teilFormBefunde), ...doppelteBefunde(teile, "kuerzel"), ...doppelteBefunde(teile, "name")];
}

export function prueflisteSoll(schnitt, soll, annahmen) {
  const auftraege = liste(schnitt.auftraege);
  const nummern = [...soll.keys()];
  return [
    ...new Set([
      DURCHSTICH_ZEILE,
      ...nummern.map((nummer) => `weg:${nummer}`),
      ...auftraege.filter(istUmbau).map(({ id }) => `umbau:${id}`),
      ...nummern.filter((nummer) => B_NUMMER.test(nummer)).map((nummer) => `b-nummer:${nummer}`),
      ...auftraege.flatMap(({ id }) => [`nie-saetze:${id}`, `allein-gruen:${id}`, `nicht-zusammengelegt:${id}`]),
      ...auftraege.filter(({ bereichsgrund }) => istText(bereichsgrund)).map(({ id }) => `bereichsgrund:${id}`),
      ...annahmen.filter(({ angabe }) => istText(angabe)).map(({ nummer, angabe }) => `ausweg:${nummer}:${angabe}`),
      ...auftraege.flatMap(({ id, falscheAngaben }) => liste(falscheAngaben).map(({ nummer, datei }) => `falsche-angabe:${id}:${nummer}:${datei}`)),
      "gegenfrage:alle",
    ]),
  ];
}

export function fuerDenPitch(schluessel, { nurUmbau = false } = {}) {
  return nurUmbau ? schluessel.filter((zeile) => zeile !== DURCHSTICH_ZEILE) : schluessel;
}

export function planweiteSchluessel(soll, { nurUmbau = false } = {}) {
  return fuerDenPitch(prueflisteSoll(OHNE_AUFTRAEGE, soll, []), { nurUmbau }).filter((schluessel) => schluessel.split(":")[0] !== WEG);
}

function zeilenBefunde(zeile, soll, kontext) {
  if (!istObjekt(zeile)) return ["eine Zeile der Prüfliste ist kein Objekt"];
  const ort = istText(zeile.schluessel) ? zeile.schluessel : "ohne schluessel";
  if (!soll.includes(zeile.schluessel)) return [`${ort}: gehört nicht zur Liste der Prüfzeilen`];
  if (zeile.ergebnis !== ERFUELLT && zeile.ergebnis !== BEFUND) return [`${ort}: ergebnis muss „${ERFUELLT}“ oder „${BEFUND}“ sein`];
  const befunde = [fundstelleBefund(zeile.fundstelle, kontext)].filter(Boolean).map((befund) => `${ort}: ${befund}`);
  if (zeile.ergebnis === BEFUND && !istText(zeile.befund)) befunde.push(`${ort}: „${BEFUND}“ ohne Text unter befund`);
  return befunde;
}

export function prueflisteBefunde(pruefliste, soll, kontext) {
  if (!Array.isArray(pruefliste)) return ["pruefliste fehlt: je Prüfzeile ein Objekt"];
  const befunde = pruefliste.flatMap((zeile) => zeilenBefunde(zeile, soll, kontext));
  for (const schluessel of soll) {
    const zahl = pruefliste.filter((zeile) => zeile?.schluessel === schluessel).length;
    if (zahl === 0) befunde.push(`${schluessel}: fehlt in der Prüfliste`);
    if (zahl > 1) befunde.push(`${schluessel}: steht ${zahl}-mal in der Prüfliste`);
  }
  return befunde;
}

export function prueferBefunde(pruefliste) {
  return pruefliste.filter(({ ergebnis }) => ergebnis === BEFUND);
}

function auftragDes(schluessel) {
  const [regel, id] = schluessel.split(":");
  return MIT_AUFTRAG.has(regel) ? id : null;
}

function auftragIn(schnitt, id) {
  return nachKennung(schnitt).get(id);
}

function auftragGeaendert(id, alt, neu) {
  return alsText(auftragIn(alt, id)) !== alsText(auftragIn(neu, id));
}

function geaendert(schluessel, alt, neu) {
  const id = auftragDes(schluessel);
  if (id === null) return alsText(alt) !== alsText(neu);
  return auftragGeaendert(id, alt, neu);
}

function antwortBefund(schluessel, antwort, schnitte) {
  if (!istText(antwort)) return `${schluessel}: Antwort ohne Text`;
  const zurueck = TRIFFT_NICHT_ZU.exec(antwort);
  if (zurueck) return GRUND.test(zurueck[1]) ? null : `${schluessel}: „trifft nicht zu, weil …“ ohne Grund`;
  if (!KORRIGIERT.test(antwort)) return `${schluessel}: Antwort ist weder „korrigiert: …“ noch „trifft nicht zu, weil …“`;
  if (geaendert(schluessel, schnitte.alt, schnitte.neu)) return null;
  const id = auftragDes(schluessel);
  return `${schluessel}: „korrigiert“, aber ${id === null ? "die Schnittliste" : `der Auftrag ${id}`} ist unverändert`;
}

export function antwortenBefunde(befunde, antworten, { alt, neu }) {
  if (!Array.isArray(antworten)) return ["antworten fehlt: je Befund des Prüfers eine Antwort"];
  const schluessel = befunde.map((befund) => befund.schluessel);
  const ergebnis = befunde.flatMap(({ schluessel: eigener }) => {
    const passende = antworten.filter((antwort) => antwort?.schluessel === eigener);
    if (passende.length !== 1) return [`${eigener}: ${passende.length === 0 ? "Befund des Prüfers ohne Antwort des Planers" : "mehr als eine Antwort"}`];
    return [antwortBefund(eigener, passende[0].antwort, { alt, neu })].filter(Boolean);
  });
  const fremd = antworten.filter((antwort) => !schluessel.includes(antwort?.schluessel));
  return [...ergebnis, ...fremd.map((antwort) => `${antwort?.schluessel}: Antwort ohne Befund des Prüfers`)];
}

function nachKennung(schnitt) {
  return new Map(liste(schnitt?.auftraege).map((auftrag) => [auftrag?.id, auftrag]));
}

function alsText(wert) {
  return JSON.stringify(wert);
}

function schnittGeaendert(vorher, nachher, anders) {
  if (anders.size > 0) return true;
  if (alsText([...nachKennung(vorher).keys()]) !== alsText([...nachKennung(nachher).keys()])) return true;
  return SCHNITT_LISTEN.some((feld) => alsText(vorher?.[feld]) !== alsText(nachher?.[feld]));
}

function zusammengelegtMit(entfernte, auftraege) {
  const dateien = new Set(entfernte.flatMap((auftrag) => liste(auftrag?.erwarteteDateien)));
  return auftraege.filter((auftrag) => liste(auftrag?.erwarteteDateien).some((datei) => dateien.has(datei))).map(({ id }) => `nicht-zusammengelegt:${id}`);
}

function nummernDerAenderung(kennungen, alt, neu) {
  return kennungen.flatMap((id) => [alt.get(id), neu.get(id)]).flatMap((auftrag) => liste(auftrag?.prueft)).map((nummer) => `${WEG}:${nummer}`);
}

export function nachpruefSchluessel({ vorher, nachher, befunde, soll, annahmen, nurUmbau = false }) {
  const alle = fuerDenPitch(prueflisteSoll(nachher, soll, annahmen), { nurUmbau });
  const alt = nachKennung(vorher);
  const neu = nachKennung(nachher);
  const geaenderte = [...neu.keys()].filter((id) => alt.has(id) && auftragGeaendert(id, vorher, nachher));
  const dazu = [...neu.keys()].filter((id) => !alt.has(id));
  const entfernt = [...alt.keys()].filter((id) => !neu.has(id));
  const anders = new Set([...geaenderte, ...dazu, ...entfernt]);
  const beruehrt = liste(nachher.auftraege).filter((auftrag) => liste(auftrag?.abhaengigVon).some((abhaengig) => anders.has(abhaengig?.id))).map(({ id }) => id);
  const zupruefen = new Set([...anders, ...beruehrt]);
  const nachAenderung = schnittGeaendert(vorher, nachher, anders) ? planweiteSchluessel(soll, { nurUmbau }) : [];
  const zusammengelegt = zusammengelegtMit(entfernt.map((id) => alt.get(id)), liste(nachher.auftraege));
  const befundSchluessel = befunde.map(({ schluessel }) => schluessel);
  const wege = nummernDerAenderung([...zupruefen], alt, neu);
  const gewaehlt = new Set([...nachAenderung, ...zusammengelegt, ...wege, ...befundSchluessel]);
  return {
    schluessel: alle.filter((schluessel) => zupruefen.has(auftragDes(schluessel)) || gewaehlt.has(schluessel)),
    entfallen: befundSchluessel.filter((schluessel) => !alle.includes(schluessel)),
    geaendert: geaenderte,
    neu: dazu,
    entfernt,
  };
}

export function istZurueckgewiesen(antwort) {
  return TRIFFT_NICHT_ZU.test(antwort ?? "");
}

function stellenDer(angaben) {
  const weg = liste(angaben?.weg);
  const aenderungen = liste(angaben?.aenderungen);
  return [...weg, ...aenderungen].filter((stelle) => istText(stelle?.datei)).map(({ datei, funktion }) => `${datei}\0${istText(funktion) ? funktion : ""}`);
}

function stellenDesBerichts(bericht, nummern) {
  const angaben = istObjekt(bericht?.nummern) ? bericht.nummern : {};
  return nummern.flatMap((nummer) => stellenDer(angaben[nummer]).map((stelle) => `${nummer}\0${stelle}`));
}

export function neueStellen(gesehen, bericht, nummern) {
  return [...new Set(stellenDesBerichts(bericht, nummern))].filter((stelle) => !gesehen.has(stelle));
}

export function merkeStellen(gesehen, bericht) {
  const nummern = istObjekt(bericht?.nummern) ? Object.keys(bericht.nummern) : [];
  for (const stelle of stellenDesBerichts(bericht, nummern)) gesehen.add(stelle);
}

export function entwurfBefunde(entwurf, namen) {
  if (!istText(entwurf)) return ["entwurf fehlt: der Abschnitt als Text"];
  const zeilen = entwurf.trim().split("\n");
  const befunde = [];
  if (!GRUNDLAGE.test(zeilen[0])) befunde.push("die erste Zeile beginnt nicht mit „Grundlage:“");
  if (!FEHLERFAELLE.test(zeilen.at(-1))) befunde.push("die letzte Zeile beginnt nicht mit „Fehlerfälle:“");
  if (BERECHNETE_ZEILE.test(entwurf)) befunde.push("die Zeilen „Aufträge:“ und „Reihenfolge:“ setzt das Skript");
  return [...befunde, ...namen.filter((name) => !entwurf.includes(name)).map((name) => `gemeinsamer Name ${name} fehlt wörtlich`)];
}
