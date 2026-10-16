const ZITAT = "> ";
const ZEILENENDE = /\r\n|[\n\r\u2028\u2029]/;

export function zeilenDes(text) {
  return text.split(ZEILENENDE);
}

export function zitiert(text) {
  return zeilenDes(text).map((zeile) => `${ZITAT}${zeile}`);
}
