import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_AUFRUF = 2;
const ERSTES_EIGENES_ARGUMENT = 2;
const AUFRUF_HINWEIS = "Aufruf: node tools/abdeckung-pruefen.mjs plaene/P-<Nummer>-<kurzname>/";
const PITCH = "pitch.md";
const SICHERHEIT = "sicherheit.md";
const PHASE = "phase.json";
const ZEILENUMBRUCH = /\r?\n/;
const LEERRAUM = /\s+/g;
const UEBERSCHRIFT = /^#/;
const ABSCHNITT = /^##\s/;
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

function gleicherText(text) {
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

function pitchSzenarien(text) {
  const zeilen = text.split(ZEILENUMBRUCH);
  const { ergebnis, doppelt } = sammle(zeilen, PITCH_SZENARIO, (stelle) => ({ text: blockNach(zeilen, stelle).join("\n"), quelle: PITCH }));
  const unklar = doppelt.map((nummer) => `${UNKLAR} ${nummer} steht in ${PITCH} mehrfach`);
  if (![...ergebnis.keys()].some((nummer) => nummer.startsWith("S"))) unklar.push(`${UNKLAR} ${PITCH} hat kein Szenario ${FORM_SZENARIO}`);
  return { szenarien: ergebnis, unklar };
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

function sollNummern(pitch, sicherheit) {
  const { szenarien: soll, unklar: pitchUnklar } = pitchSzenarien(pitch);
  const { wege, unklar } = bedrohungen(sicherheit);
  const andererAusgang = new Set();
  for (const [nummer, { ausgang, text }] of wege) {
    if (ausgang === "verhindern") soll.set(nummer, { text, quelle: SICHERHEIT });
    else andererAusgang.add(nummer);
  }
  return { soll, andererAusgang, unklar: [...pitchUnklar, ...unklar] };
}

function auftraegeMitNummern(phase) {
  const auftraege = Array.isArray(phase.auftraege) ? phase.auftraege : [];
  return auftraege.filter((auftrag) => Array.isArray(auftrag?.prueft));
}

function zuordnung(auftraege) {
  const besitzer = new Map();
  for (const auftrag of auftraege) {
    for (const nummer of new Set(auftrag.prueft)) besitzer.set(nummer, [...(besitzer.get(nummer) ?? []), auftrag.id]);
  }
  return besitzer;
}

function abdeckungBefunde(soll, besitzer) {
  const befunde = [];
  for (const nummer of soll.keys()) {
    const kennungen = besitzer.get(nummer) ?? [];
    if (kennungen.length === 0) befunde.push(`${nummer} gehört keinem Auftrag`);
    if (kennungen.length > 1) befunde.push(`${nummer} gehört mehreren Aufträgen: ${kennungen.join(", ")}`);
  }
  return befunde;
}

function nummerBefund(auftrag, nummer, { soll, andererAusgang }) {
  const erwartet = soll.get(nummer);
  if (andererAusgang.has(nummer)) return `${auftrag.id}: ${nummer} hat in ${SICHERHEIT} nicht den Ausgang „verhindern“ und gehört keinem Auftrag`;
  if (erwartet === undefined) return `${auftrag.id}: ${nummer} steht weder in ${PITCH} noch unter „2. Angriffswege“ in ${SICHERHEIT}`;
  if (gleicherText(auftrag.szenarien?.[nummer]) === gleicherText(erwartet.text)) return null;
  return `${auftrag.id}: szenarien["${nummer}"] ist nicht wörtlich der Text aus ${erwartet.quelle}: ${gleicherText(erwartet.text)}`;
}

function auftragBefunde(auftraege, dokumente) {
  return auftraege.flatMap((auftrag) => auftrag.prueft.map((nummer) => nummerBefund(auftrag, nummer, dokumente))).filter((befund) => befund !== null);
}

function befundeImOrdner(ordner, phase) {
  const dokumente = sollNummern(readFileSync(join(ordner, PITCH), "utf8"), readFileSync(join(ordner, SICHERHEIT), "utf8"));
  const auftraege = auftraegeMitNummern(phase);
  const name = basename(resolve(ordner));
  const kennung = phase.phase === name ? [] : [`phase muss ${name} heißen wie der Ordner, nicht ${JSON.stringify(phase.phase)}`];
  return { anzahl: dokumente.soll.size, befunde: [...kennung, ...dokumente.unklar, ...abdeckungBefunde(dokumente.soll, zuordnung(auftraege)), ...auftragBefunde(auftraege, dokumente)] };
}

function ladePhase(ordner) {
  try {
    return { phase: JSON.parse(readFileSync(join(ordner, PHASE), "utf8")) };
  } catch (fehler) {
    return { befunde: [`${PHASE} ist nicht lesbar: ${fehler.message}`] };
  }
}

function pruefe(argumente) {
  if (argumente.length !== 1) {
    console.error(AUFRUF_HINWEIS);
    return EXIT_AUFRUF;
  }
  const [ordner] = argumente;
  const fehlend = [PITCH, SICHERHEIT, PHASE].filter((datei) => !existsSync(join(ordner, datei)));
  if (fehlend.length > 0) {
    console.error(`Im Ordner ${ordner} fehlt: ${fehlend.join(", ")}\n${AUFRUF_HINWEIS}`);
    return EXIT_AUFRUF;
  }
  const geladen = ladePhase(ordner);
  const { anzahl, befunde } = geladen.phase ? befundeImOrdner(ordner, geladen.phase) : { anzahl: 0, befunde: geladen.befunde };
  for (const befund of befunde) console.error(befund);
  if (befunde.length > 0) {
    console.log(`rot: ${befunde.length} Befunde in ${ordner}.`);
    return EXIT_ROT;
  }
  console.log(`grün: ${anzahl} Nummern in ${ordner} gehören je genau einem Auftrag.`);
  return EXIT_GRUEN;
}

process.exitCode = pruefe(process.argv.slice(ERSTES_EIGENES_ARGUMENT));
