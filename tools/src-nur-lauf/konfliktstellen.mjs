const KONFLIKT_ANFANG = "<<<<<<<";
const KONFLIKT_ENDE = ">>>>>>>";
const ZEILENENDE = "\n";

export function hatMarker(text) {
  return text !== null && text.split(ZEILENENDE).some((zeile) => zeile.startsWith(KONFLIKT_ANFANG) || zeile.startsWith(KONFLIKT_ENDE));
}

export function festeStuecke(text) {
  const stuecke = [[]];
  let imKonflikt = false;
  for (const zeile of text.split(ZEILENENDE)) {
    if (imKonflikt) imKonflikt = !zeile.startsWith(KONFLIKT_ENDE);
    else if (zeile.startsWith(KONFLIKT_ANFANG)) {
      imKonflikt = true;
      stuecke.push([]);
    } else stuecke.at(-1).push(zeile);
  }
  return stuecke;
}

function beginntMit(zeilen, stueck, ab) {
  return stueck.every((zeile, versatz) => zeilen[ab + versatz] === zeile);
}

function ersteStelle(zeilen, stueck, { von, bis }) {
  for (let stelle = von; stelle + stueck.length <= bis; stelle += 1) {
    if (beginntMit(zeilen, stueck, stelle)) return stelle;
  }
  return -1;
}

function mitteLiegtInOrdnung(zeilen, mitte, fenster) {
  let von = fenster.von;
  for (const stueck of mitte) {
    const stelle = ersteStelle(zeilen, stueck, { von, bis: fenster.bis });
    if (stelle === -1) return false;
    von = stelle + stueck.length;
  }
  return true;
}

export function ausserhalbGleich(stuecke, text) {
  if (stuecke.length === 1) return true;
  const zeilen = text.split(ZEILENENDE);
  const erstes = stuecke[0];
  const letztes = stuecke.at(-1);
  const ende = zeilen.length - letztes.length;
  if (ende < erstes.length) return false;
  if (!beginntMit(zeilen, erstes, 0) || !beginntMit(zeilen, letztes, ende)) return false;
  return mitteLiegtInOrdnung(zeilen, stuecke.slice(1, -1), { von: erstes.length, bis: ende });
}
