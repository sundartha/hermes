const GANZE_ZAHL = /^[1-9]\d*$/;
const ERSTER_ABSCHNITT = /^## /m;
const ZEILE = /^.*$/gm;

export function ganzeZahl(text) {
  return GANZE_ZAHL.test(text) ? Number(text) : undefined;
}

function kopf(pitch) {
  const ende = pitch.search(ERSTER_ABSCHNITT);
  return ende === -1 ? pitch : pitch.slice(0, ende);
}

function zahlHinter(rest, einheit) {
  const schluss = einheit === undefined ? "" : ` ${einheit}`;
  const wert = rest.trimEnd();
  if (!wert.startsWith(" ") || !wert.endsWith(schluss)) return undefined;
  return ganzeZahl(wert.slice(" ".length, wert.length - schluss.length));
}

export function zahlZeile(pitch, { name, einheit, nurKopf }) {
  const anfang = `${name}:`;
  const zeile = (nurKopf ? kopf(pitch) : pitch).match(ZEILE).find((text) => text.startsWith(anfang));
  return zeile === undefined ? undefined : { zeile, zahl: zahlHinter(zeile.slice(anfang.length), einheit) };
}
