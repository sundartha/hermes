import { parse } from "pg-connection-string";
import { merkeLogGeheimnis } from "../log-maske.ts";

const ABFRAGE_PASSWORT = /[?&]password=([^&#]+)/;
const AUTORITAET = /^[^:/?#]*:\/\/([^/?#]*)/;

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

function passwortteil(adresse) {
  const treffer = AUTORITAET.exec(adresse);
  if (!treffer) return "";
  const autoritaet = treffer[1];
  const benutzerteil = autoritaet.slice(0, Math.max(autoritaet.lastIndexOf("@"), 0));
  return benutzerteil.slice(benutzerteil.indexOf(":") + 1 || benutzerteil.length);
}

export function merkeKennzahlenPasswort(adresse) {
  const rohwerte = [passwortteil(adresse), ABFRAGE_PASSWORT.exec(adresse)?.[1]];
  merkeLogGeheimnis(zerlegtesPasswort(adresse));
  for (const roh of rohwerte) {
    merkeLogGeheimnis(roh);
    merkeLogGeheimnis(roh && dekodiert(roh));
  }
}
