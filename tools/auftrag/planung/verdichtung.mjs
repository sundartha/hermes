import { ANGABEN, istObjekt } from "./erkundung.mjs";

const STELLEN = new Set(["weg", "aenderungen"]);
const STELLEN_TRENNER = " · ";
const LISTEN_TRENNER = ", ";
const WIDERSPRUCH_TRENNER = " | ";
const STELLE_BEKANNT = ["rolle", "datei", "funktion", "von", "bis", "neueZeilen", "neu", "ausweg"];
const LEER = "keine";
const FEHLT = "fehlt";

export function text(wert) {
  return typeof wert === "string" ? wert : JSON.stringify(wert);
}

function weitere(objekt, bekannt) {
  return Object.entries(objekt).filter(([feld]) => !bekannt.includes(feld)).map(([feld, wert]) => `${feld}=${text(wert)}`);
}

function stelleText(stelle) {
  if (!istObjekt(stelle)) return text(stelle);
  const { rolle, datei, funktion, von, bis, neueZeilen, neu, ausweg } = stelle;
  const teile = [rolle, datei, funktion].filter((wert) => wert !== undefined).map(text);
  if (ausweg !== undefined) teile.push(`ausweg: ${text(ausweg)}`);
  if (von !== undefined || bis !== undefined) teile.push(`${text(von)}–${text(bis)}`);
  if (neueZeilen !== undefined) teile.push(`+${text(neueZeilen)}`);
  if (neu !== undefined) teile.push(`neu ${text(neu)}`);
  return [...teile, ...weitere(stelle, STELLE_BEKANNT)].join(" ");
}

function widerspruchText(eintrag) {
  if (!istObjekt(eintrag)) return text(eintrag);
  const { designDoc, code, text: beschreibung } = eintrag;
  return [designDoc, code, beschreibung].map(text).concat(weitere(eintrag, ["designDoc", "code", "text"])).join(WIDERSPRUCH_TRENNER);
}

function eintraegeText(feld, eintraege) {
  if (eintraege.length === 0) return LEER;
  if (STELLEN.has(feld)) return eintraege.map(stelleText).join(STELLEN_TRENNER);
  if (feld === "widersprueche") return eintraege.map(widerspruchText).join(STELLEN_TRENNER);
  return eintraege.map(text).join(LISTEN_TRENNER);
}

function objektText(feld, wert) {
  if (feld === "schema") return [`aenderung=${text(wert.aenderung)} (${text(wert.fundstelle)})`, ...weitere(wert, ["aenderung", "fundstelle"])].join(" ");
  return [`${text(wert.text)} (${text(wert.fundstelle)})`, ...weitere(wert, ["text", "fundstelle"])].join(" ");
}

function angabeText(feld, wert) {
  if (wert === undefined) return FEHLT;
  if (Array.isArray(wert)) return eintraegeText(feld, wert);
  return istObjekt(wert) ? objektText(feld, wert) : text(wert);
}

function nummerText(nummer, angaben) {
  const zeilen = istObjekt(angaben) ? ANGABEN.map((feld) => `${feld}: ${angabeText(feld, angaben[feld])}`) : [`Angaben: ${text(angaben)}`];
  return [`#### ${nummer}`, ...zeilen].join("\n");
}

function berichtText(bericht) {
  const nummern = Object.entries(istObjekt(bericht?.nummern) ? bericht.nummern : {}).map(([nummer, angaben]) => nummerText(nummer, angaben));
  const hinweise = (Array.isArray(bericht?.hinweise) ? bericht.hinweise : []).map((hinweis) => `hinweis: ${text(hinweis)}`);
  return [...nummern, ...hinweise].join("\n\n");
}

export function verdichteBerichte(berichte) {
  return berichte.map(berichtText).join("\n\n");
}
