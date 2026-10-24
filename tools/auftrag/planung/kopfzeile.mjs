const GANZE_ZAHL = /^[1-9]\d*$/;
const ERSTER_ABSCHNITT = /^## /m;
const ZEILE = /^.*$/gm;
const TEIL_VON = "Teil von";
const TEIL_VON_FORM = /^Teil von: (P-[^\s/\\]+); nach: (.+)$/u;
const OHNE_VORGAENGER = "–";
const VORGAENGER_TRENNER = ", ";

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

function zeileMit(text, anfang) {
  return text.match(ZEILE).find((zeile) => zeile.startsWith(anfang));
}

export function zahlZeile(pitch, { name, einheit, nurKopf }) {
  const anfang = `${name}:`;
  const zeile = zeileMit(nurKopf ? kopf(pitch) : pitch, anfang);
  return zeile === undefined ? undefined : { zeile, zahl: zahlHinter(zeile.slice(anfang.length), einheit) };
}

export function teilVonZeile({ eltern, nach }) {
  return `${TEIL_VON}: ${eltern}; nach: ${nach.length === 0 ? OHNE_VORGAENGER : nach.join(VORGAENGER_TRENNER)}`;
}

export function teilVon(pitch) {
  const zeile = zeileMit(kopf(pitch), `${TEIL_VON}:`);
  if (zeile === undefined) return undefined;
  const treffer = TEIL_VON_FORM.exec(zeile.trimEnd());
  if (treffer === null) return { fehler: `pitch.md: die Zeile „${zeile.trim()}“ braucht die Form „${TEIL_VON}: <Eltern-Ordner>; nach: <Teil-Ordner>, …“ oder „nach: ${OHNE_VORGAENGER}“` };
  const [, eltern, nach] = treffer;
  return { eltern, nach: nach === OHNE_VORGAENGER ? [] : nach.split(VORGAENGER_TRENNER) };
}
