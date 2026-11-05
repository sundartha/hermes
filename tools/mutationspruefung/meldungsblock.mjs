export const MELDUNGSZEILE = "Meldungsblock | ";
export const MAX_MELDUNGSZEILEN_GESAMT = 100;
const MAX_ZEILEN_JE_FALL = 40;
const MAX_ZEICHEN_JE_FALL = 4000;
const ZEILENENDE = "\n";
const AUSLASSUNG = "…";

function nachZeichen(zeilen) {
  const kurz = [];
  let frei = MAX_ZEICHEN_JE_FALL;
  for (const zeile of zeilen) {
    if (frei <= 0) break;
    kurz.push(zeile.length > frei ? `${zeile.slice(0, frei - 1)}${AUSLASSUNG}` : zeile);
    frei -= zeile.length;
  }
  return kurz;
}

export function meldungsblock(text, frei) {
  const grenze = Math.min(MAX_ZEILEN_JE_FALL, frei);
  if (grenze <= 0) return [];
  const alle = text.trimEnd().split(ZEILENENDE);
  const kurz = nachZeichen(alle);
  const gekuerzt = kurz.length < alle.length || kurz.length > grenze;
  const behalten = gekuerzt ? kurz.slice(0, grenze - 1) : kurz;
  const weg = alle.length - behalten.length;
  return [...behalten, ...(gekuerzt ? [`${AUSLASSUNG} ${weg} weitere Zeilen weggelassen`] : [])].map((zeile) => `${MELDUNGSZEILE}${zeile}`);
}
