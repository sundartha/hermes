import { deflateRawSync } from "node:zlib";

const SIGNATUR = { lokal: 0x04034b50, zentral: 0x02014b50, ende: 0x06054b50 };
const LAENGE = { lokal: 30, zentral: 46, ende: 22 };
const BREITE = { kurz: 2, lang: 4 };
const DEFLATE = 8;

function kopf(laenge, felder) {
  const puffer = Buffer.alloc(laenge);
  for (const { stelle, breite, wert } of felder) {
    if (breite === BREITE.kurz) puffer.writeUInt16LE(wert, stelle);
    else puffer.writeUInt32LE(wert, stelle);
  }
  return puffer;
}

export function zipMitEinerDatei(name, inhalt) {
  const daten = Buffer.from(inhalt);
  const gepackt = deflateRawSync(daten);
  const bytes = Buffer.from(name);
  const groessen = [
    { stelle: 8, breite: BREITE.kurz, wert: DEFLATE },
    { stelle: 18, breite: BREITE.lang, wert: gepackt.length },
    { stelle: 22, breite: BREITE.lang, wert: daten.length },
    { stelle: 26, breite: BREITE.kurz, wert: bytes.length },
  ];
  const lokal = Buffer.concat([
    kopf(LAENGE.lokal, [{ stelle: 0, breite: BREITE.lang, wert: SIGNATUR.lokal }, ...groessen]),
    bytes,
    gepackt,
  ]);
  const zentral = Buffer.concat([
    kopf(LAENGE.zentral, [
      { stelle: 0, breite: BREITE.lang, wert: SIGNATUR.zentral },
      ...groessen.map((feld) => ({ ...feld, stelle: feld.stelle + BREITE.kurz })),
    ]),
    bytes,
  ]);
  const ende = kopf(LAENGE.ende, [
    { stelle: 0, breite: BREITE.lang, wert: SIGNATUR.ende },
    { stelle: 8, breite: BREITE.kurz, wert: 1 },
    { stelle: 10, breite: BREITE.kurz, wert: 1 },
    { stelle: 12, breite: BREITE.lang, wert: zentral.length },
    { stelle: 16, breite: BREITE.lang, wert: lokal.length },
  ]);
  return Buffer.concat([lokal, zentral, ende]);
}
