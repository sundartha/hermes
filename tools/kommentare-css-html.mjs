import { bisEnde } from "./kommentare-yaml-shell.mjs";

const CSS_DATEI = /\.css$/;
const MARKUP_DATEI = /\.(?:html?|astro)$/;
const ASTRO_DATEI = /\.astro$/;
const KOPFZAUN = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const CSS_KOMMENTAR_ANFANG = "/*";
const CSS_KOMMENTAR_ENDE = "*/";
const HTML_KOMMENTAR_ANFANG = "<!--";
const ROHTEXT_ENDE = { script: /<\/script\b/i, style: /<\/style\b/i };
const ROHTEXT_ANFANG = "<(script|style)\\b[^>]*>";
const MARKUP_ANFANG = `${HTML_KOMMENTAR_ANFANG}|${ROHTEXT_ANFANG}`;
const HTML_KOMMENTAR_ENDE = "-->";
const URL_OHNE_ZITAT = /url\(\s*[^\s"')]/iy;
const URL_ENDE = ")";
const RUECKSTRICH = "\\";
const ZEILENENDE = "\n";
const ZITATE = new Set(['"', "'"]);
const SKRIPT = "script";
const ERSTE_ZEILE = 1;
const MASKIERT = 2;

function zeilenImStueck(text, von, bis) {
  let anzahl = 0;
  for (let index = von; index < bis; index += 1) if (text[index] === ZEILENENDE) anzahl += 1;
  return anzahl;
}

function zeilenzaehler(text, ersteZeile) {
  let position = 0;
  let zeile = ersteZeile;
  return (index) => {
    zeile += zeilenImStueck(text, position, index);
    position = index;
    return zeile;
  };
}

function kommentarZeilen(stueck, zeileVon) {
  return stueck
    .split(ZEILENENDE)
    .map((zeilentext, abstand) => ({ zeile: zeileVon + abstand, text: zeilentext }));
}

function zitatEnde(text, anfang) {
  const zitat = text[anfang];
  let index = anfang + 1;
  while (index < text.length && text[index] !== zitat && text[index] !== ZEILENENDE) {
    index += text[index] === RUECKSTRICH ? MASKIERT : 1;
  }
  return Math.min(index + 1, text.length);
}

function urlEnde(text, anfang) {
  URL_OHNE_ZITAT.lastIndex = anfang;
  if (!URL_OHNE_ZITAT.test(text)) return undefined;
  return bisEnde(text, anfang, URL_ENDE);
}

function uebersprungenBis(text, index) {
  if (ZITATE.has(text[index])) return zitatEnde(text, index);
  return urlEnde(text, index);
}

export function cssKommentare(text, ersteZeile = ERSTE_ZEILE) {
  const gefunden = [];
  const zeileBei = zeilenzaehler(text, ersteZeile);
  let index = 0;
  while (index < text.length) {
    if (text.startsWith(CSS_KOMMENTAR_ANFANG, index)) {
      const ende = bisEnde(text, index + CSS_KOMMENTAR_ANFANG.length, CSS_KOMMENTAR_ENDE);
      gefunden.push(...kommentarZeilen(text.slice(index, ende), zeileBei(index)));
      index = ende;
    } else index = uebersprungenBis(text, index) ?? index + 1;
  }
  return gefunden;
}

function rohtextEnde(text, name, ab) {
  const treffer = ROHTEXT_ENDE[name.toLowerCase()].exec(text.slice(ab));
  return treffer === null ? text.length : ab + treffer.index;
}

function markupAbschnitt(text, treffer, zeileBei) {
  const [anfang, name] = treffer;
  if (anfang === HTML_KOMMENTAR_ANFANG) {
    const ende = bisEnde(text, treffer.index + anfang.length, HTML_KOMMENTAR_ENDE);
    return { bis: ende, funde: kommentarZeilen(text.slice(treffer.index, ende), zeileBei(treffer.index)) };
  }
  const innen = treffer.index + anfang.length;
  const bis = rohtextEnde(text, name, innen);
  if (name.toLowerCase() === SKRIPT) return { bis, funde: [] };
  return { bis, funde: cssKommentare(text.slice(innen, bis), zeileBei(innen)) };
}

function markupAnfang(pfad, text) {
  return ASTRO_DATEI.test(pfad) ? (KOPFZAUN.exec(text)?.[0].length ?? 0) : 0;
}

export function htmlKommentare(pfad, text) {
  const gefunden = [];
  const zeileBei = zeilenzaehler(text, ERSTE_ZEILE);
  const suche = new RegExp(MARKUP_ANFANG, "gi");
  suche.lastIndex = markupAnfang(pfad, text);
  for (let treffer = suche.exec(text); treffer !== null; treffer = suche.exec(text)) {
    const { bis, funde } = markupAbschnitt(text, treffer, zeileBei);
    gefunden.push(...funde);
    suche.lastIndex = Math.max(bis, suche.lastIndex);
  }
  return gefunden;
}

export function istCssOderHtml(pfad) {
  return CSS_DATEI.test(pfad) || MARKUP_DATEI.test(pfad);
}

export function kommentareImCssOderHtml(pfad, text) {
  return CSS_DATEI.test(pfad) ? cssKommentare(text) : htmlKommentare(pfad, text);
}
