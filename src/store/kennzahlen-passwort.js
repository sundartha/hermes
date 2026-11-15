import { parse } from "pg-connection-string";
import { merkeLogGeheimnis } from "../log-maske.js";

const ROH_PASSWORT = /(?:\/\/[^:@/?#]*:|[?&]password=)([^@/?#&]+)/;

function dekodiert(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function zerlegtesPasswort(adresse) {
  try {
    return parse(adresse).password;
  } catch {
    return adresse;
  }
}

export function merkeKennzahlenPasswort(adresse) {
  const roh = ROH_PASSWORT.exec(adresse)?.[1];
  const werte = [zerlegtesPasswort(adresse), roh, roh && dekodiert(roh)];
  for (const wert of werte) merkeLogGeheimnis(wert);
}
