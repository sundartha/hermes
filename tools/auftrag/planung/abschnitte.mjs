const ZEILENUMBRUCH = /\r?\n/;
const LEERRAUM = /\s+/g;
const UEBERSCHRIFT = /^(#{1,6})\s+(\S.*)$/;
const SCHLUSS_RAUTEN = /(?:^|\s)#+\s*$/;
const ZAUN = /^\s*(`{3,}|~{3,})(.*)$/;
const RAUTENFOLGE = /^(#+)\s+/;

function titelOhneSchlussRauten(text) {
  return text.replace(SCHLUSS_RAUTEN, "").replace(LEERRAUM, " ").trim();
}

function gesuchteUeberschrift(gesucht) {
  const text = gesucht.trim();
  const rauten = RAUTENFOLGE.exec(text);
  if (!rauten) return { stufe: undefined, titel: titelOhneSchlussRauten(text) };
  return { stufe: rauten[1].length, titel: titelOhneSchlussRauten(text.slice(rauten[0].length)) };
}

function naechsterZaun(zaun, zeile) {
  const treffer = ZAUN.exec(zeile);
  if (!treffer) return zaun;
  const [, markierung, rest] = treffer;
  if (zaun === null) return markierung;
  const schliesst = markierung[0] === zaun[0] && markierung.length >= zaun.length && rest.trim() === "";
  return schliesst ? null : zaun;
}

function gliederung(zeilen) {
  const kopfzeilen = [];
  let zaun = null;
  zeilen.forEach((zeile, stelle) => {
    const vorher = zaun;
    zaun = naechsterZaun(zaun, zeile);
    const treffer = vorher === null && zaun === null ? UEBERSCHRIFT.exec(zeile) : null;
    if (treffer) kopfzeilen.push({ stufe: treffer[1].length, titel: titelOhneSchlussRauten(treffer[2]), stelle });
  });
  return kopfzeilen;
}

function ausschnitt(zeilen, kopfzeilen, kopf) {
  const naechste = kopfzeilen.find(({ stelle, stufe }) => stelle > kopf.stelle && stufe <= kopf.stufe);
  return zeilen.slice(kopf.stelle, naechste?.stelle ?? zeilen.length).join("\n").trimEnd();
}

function passende(kopfzeilen, { stufe, titel }) {
  return kopfzeilen.filter((kopf) => kopf.titel === titel && (stufe === undefined || kopf.stufe === stufe));
}

export function abschnitte(text, ueberschriften) {
  const zeilen = text.split(ZEILENUMBRUCH);
  const kopfzeilen = gliederung(zeilen);
  const gefunden = new Map();
  const befunde = [];
  for (const gesucht of ueberschriften) {
    const suche = gesuchteUeberschrift(gesucht);
    const treffer = passende(kopfzeilen, suche);
    if (suche.titel === "") befunde.push(`Überschrift „${gesucht}“ ist leer`);
    else if (treffer.length === 1) gefunden.set(gesucht, ausschnitt(zeilen, kopfzeilen, treffer[0]));
    else befunde.push(`Überschrift „${gesucht}“ steht ${treffer.length === 0 ? "nicht" : "mehrfach"} im Design Doc`);
  }
  return { abschnitte: gefunden, befunde };
}
