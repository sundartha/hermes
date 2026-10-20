import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PITCH = "pitch.md";
export const SICHERHEIT = "sicherheit.md";
const ZEILENUMBRUCH = /\r?\n/;
const LEERRAUM = /\s+/g;
const UEBERSCHRIFT = /^#/;
const ABSCHNITT = /^##\s/;
const ANFORDERUNGEN = /^##\s+Anforderungen\s*$/;
const BLEIBT_UNVERAENDERT = /^##\s+Bleibt unverändert\s*$/;
const KEINE_NEUEN = /^keine neuen, weil(?![\p{L}\d])/iu;
const KEINS = /^keins, weil(?![\p{L}\d])/iu;
const PITCH_SZENARIO = /^#{2,6}\s+Szenario\s+([SB][1-9]\d*)\s*:/;
const ANGRIFFSWEGE = /^##\s+2\.\s+Angriffswege\s*$/;
const ANGRIFFSWEG = /^###\s+(T[1-9]\d*)\s*:/;
const AUSGANG = /^Ausgang:\s*(verhindern|weglassen|hinnehmen|übertragen)(?![\p{L}\d])/iu;
const KEINE_ANGRIFFSWEGE = /keine Angriffswege gefunden/i;
const STERNE = /\*/g;
const UNKLAR = "Abdeckung nicht bestimmbar:";
const FORM_SZENARIO = "„Szenario S<n>:“";
const FORM_ANGRIFFSWEG = "„### T<n>:“";
const SZENARIO_ZEILE = /^Szenario[^:]*:(.*)$/;

export function gleicherText(text) {
  return typeof text === "string" ? text.replace(LEERRAUM, " ").trim() : "";
}

function bisZeile(zeilen, muster) {
  const ende = zeilen.findIndex((zeile) => muster.test(zeile));
  return ende === -1 ? zeilen : zeilen.slice(0, ende);
}

function blockNach(zeilen, stelle) {
  return bisZeile(zeilen.slice(stelle + 1), /^\s*$|^#/);
}

function sammle(zeilen, muster, lies) {
  const ergebnis = new Map();
  const doppelt = new Set();
  zeilen.forEach((zeile, stelle) => {
    const nummer = muster.exec(zeile)?.[1];
    if (nummer && ergebnis.has(nummer)) doppelt.add(nummer);
    else if (nummer) ergebnis.set(nummer, lies(stelle));
  });
  return { ergebnis, doppelt: [...doppelt] };
}

function abschnittBeginntMit(zeilen, kopf, muster) {
  const start = zeilen.findIndex((zeile) => kopf.test(zeile));
  const erste = start === -1 ? undefined : bisZeile(zeilen.slice(start + 1), ABSCHNITT).find((zeile) => zeile.trim() !== "");
  return erste !== undefined && muster.test(erste.trim());
}

function pitchSzenarien(text) {
  const zeilen = text.split(ZEILENUMBRUCH);
  const { ergebnis, doppelt } = sammle(zeilen, PITCH_SZENARIO, (stelle) => ({ text: blockNach(zeilen, stelle).join("\n"), quelle: PITCH }));
  const unklar = doppelt.map((nummer) => `${UNKLAR} ${nummer} steht in ${PITCH} mehrfach`);
  const nurUmbau = ergebnis.size === 0 && abschnittBeginntMit(zeilen, ANFORDERUNGEN, KEINE_NEUEN) && abschnittBeginntMit(zeilen, BLEIBT_UNVERAENDERT, KEINS);
  if (!nurUmbau && ![...ergebnis.keys()].some((nummer) => nummer.startsWith("S"))) unklar.push(`${UNKLAR} ${PITCH} hat kein Szenario ${FORM_SZENARIO}`);
  return { szenarien: ergebnis, unklar, nurUmbau };
}

function ausgangIn(zeile) {
  const treffer = AUSGANG.exec(zeile.replace(STERNE, "").trim());
  return treffer?.[1].toLowerCase();
}

function bedrohung(zeilen) {
  const ausgang = zeilen.map(ausgangIn).find(Boolean);
  const stelle = zeilen.findIndex((zeile) => SZENARIO_ZEILE.test(zeile));
  if (ausgang !== "verhindern" || stelle === -1) return { ausgang, text: "" };
  const kopf = SZENARIO_ZEILE.exec(zeilen[stelle])[1];
  return { ausgang, text: [kopf, ...blockNach(zeilen, stelle)].filter((zeile) => zeile.trim() !== "").join("\n") };
}

function abschnittUnklar(abschnitt, wege) {
  if (abschnitt === undefined) return [`${UNKLAR} ${SICHERHEIT} hat keinen Abschnitt „## 2. Angriffswege“`];
  if (wege.size > 0 || abschnitt.some((zeile) => KEINE_ANGRIFFSWEGE.test(zeile))) return [];
  return [`${UNKLAR} „2. Angriffswege“ in ${SICHERHEIT} nennt weder ${FORM_ANGRIFFSWEG} noch „keine Angriffswege gefunden“`];
}

function bedrohungen(text) {
  const zeilen = text.split(ZEILENUMBRUCH);
  const start = zeilen.findIndex((zeile) => ANGRIFFSWEGE.test(zeile));
  const abschnitt = start === -1 ? undefined : bisZeile(zeilen.slice(start + 1), ABSCHNITT);
  const { ergebnis, doppelt } = sammle(abschnitt ?? [], ANGRIFFSWEG, (stelle) => bedrohung(bisZeile(abschnitt.slice(stelle + 1), UEBERSCHRIFT)));
  const ohneAusgang = [...ergebnis].filter(([, { ausgang }]) => ausgang === undefined);
  return {
    wege: ergebnis,
    unklar: [
      ...abschnittUnklar(abschnitt, ergebnis),
      ...doppelt.map((nummer) => `${UNKLAR} ${nummer} steht in ${SICHERHEIT} mehrfach`),
      ...ohneAusgang.map(([nummer]) => `${UNKLAR} ${nummer} in ${SICHERHEIT} nennt keinen Ausgang verhindern, weglassen, hinnehmen oder übertragen`),
    ],
  };
}

export function sollNummern(pitch, sicherheit) {
  const { szenarien: soll, unklar: pitchUnklar, nurUmbau } = pitchSzenarien(pitch);
  const { wege, unklar } = bedrohungen(sicherheit);
  const andererAusgang = new Set();
  for (const [nummer, { ausgang, text }] of wege) {
    if (ausgang === "verhindern") soll.set(nummer, { text, quelle: SICHERHEIT });
    else andererAusgang.add(nummer);
  }
  return { soll, andererAusgang, nurUmbau, unklar: [...pitchUnklar, ...unklar] };
}

export function nummernImOrdner(ordner) {
  return sollNummern(readFileSync(join(ordner, PITCH), "utf8"), readFileSync(join(ordner, SICHERHEIT), "utf8"));
}
