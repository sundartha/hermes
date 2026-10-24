import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { pfadIstSauber } from "../format.mjs";
import { STELLE, genannteStellen } from "./altfunktionen-vorab.mjs";
import { istObjekt, istText, liste } from "./erkundung.mjs";
import { gitLauf } from "./git.mjs";
import { gleicherText } from "./nummern.mjs";

const SCHNITT = join("planung", "schnitt.json");
const FINGERABDRUCK = join("planung", "fingerabdruck.json");
const CODE = /`([^`]+)`/g;
const FOLGEZEILE = /:\d+(?:-\d+)?/g;
const NUR_TRENNER = /^[\s,]*$/;
const BEZEICHNER = /(?<![\w$./-])[A-Za-z_$][\w$]*/g;
const CODE_FORM = /[a-z][A-Z]|[A-Za-z]_|_[A-Za-z]/;
const BUCHSTABE = /\p{L}/u;
const MINDESTLAENGE_NAME = 3;
const ZEILENUMBRUCH = /\r?\n/;
const GIT_GRUEN = 0;
const GIT_FEHLT = 128;
const BAUM = "tree";
const OBJEKT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ERSTE_ZEILE = 1;
const HOECHSTENS_GEZEIGT = 3;
const ZEICHEN_JE_ZEILE = 120;
const KORREKTUR = "Korrigier die Zeile oder nenn in der Annahme in Backticks einen Namen, der dort steht.";

function lies(ordner, datei) {
  const pfad = join(ordner, datei);
  if (!existsSync(pfad)) return { wert: undefined };
  try {
    return { wert: JSON.parse(readFileSync(pfad, "utf8")) };
  } catch (fehler) {
    return { befund: `${datei} ist nicht lesbar: ${fehler.message}` };
  }
}

function istZeilenangabe(code) {
  return NUR_TRENNER.test(code.replace(STELLE, "").replace(FOLGEZEILE, ""));
}

function namenDerAnnahme(text) {
  const codes = [...text.matchAll(CODE)].map(([, code]) => gleicherText(code)).filter((code) => !istZeilenangabe(code));
  const prosa = text.replace(CODE, " ").replace(STELLE, " ");
  const bezeichner = [...prosa.matchAll(BEZEICHNER)].map(([name]) => name).filter((name) => CODE_FORM.test(name));
  return [...new Set([...codes, ...bezeichner])].filter((name) => name.length >= MINDESTLAENGE_NAME && BUCHSTABE.test(name));
}

function zeilenVon(inhalt) {
  const zeilen = inhalt.split(ZEILENUMBRUCH);
  return zeilen.at(-1) === "" ? zeilen.slice(0, -1) : zeilen;
}

function istBaumImRepo(root, baum) {
  if (!OBJEKT_ID.test(baum)) return false;
  const art = gitLauf(root, ["cat-file", "-t", baum], { erlaubt: [GIT_GRUEN, GIT_FEHLT] });
  return art.status === GIT_GRUEN && art.stdout.trim() === BAUM;
}

function standAusBaum(root, baum) {
  if (!istBaumImRepo(root, baum)) return { befund: `Stand der Planung ${baum} (stand.kopfBaum in ${FINGERABDRUCK}) fehlt im Repo; die Zeilenangaben der Annahmen sind nicht prüfbar` };
  return {
    name: `Stand ${baum}`,
    datei: (datei) => {
      const lauf = gitLauf(root, ["show", `${baum}:${datei}`], { erlaubt: [GIT_GRUEN, GIT_FEHLT] });
      return lauf.status === GIT_GRUEN ? lauf.stdout : null;
    },
  };
}

function standAusArbeitsbaum(root) {
  return {
    name: "Arbeitsbaum",
    datei: (datei) => (existsSync(join(root, datei)) ? readFileSync(join(root, datei), "utf8") : null),
  };
}

function standDerPlanung(ordner, root) {
  const { wert, befund } = lies(ordner, FINGERABDRUCK);
  if (befund) return { befund };
  if (wert === undefined) return standAusArbeitsbaum(root);
  const baum = istObjekt(wert) && istObjekt(wert.stand) ? wert.stand.kopfBaum : undefined;
  if (!istText(baum)) return { befund: `${FINGERABDRUCK} nennt kein stand.kopfBaum; die Zeilenangaben der Annahmen sind nicht prüfbar` };
  return standAusBaum(root, baum);
}

function bereichText({ von, bis }) {
  return von === bis ? `${von}` : `${von}-${bis}`;
}

function gezeigt(zeilen, { von, bis }) {
  const ende = Math.min(bis, von + HOECHSTENS_GEZEIGT - 1);
  const teil = zeilen.slice(von - 1, ende).map((zeile, index) => `Zeile ${von + index} „${gleicherText(zeile).slice(0, ZEICHEN_JE_ZEILE)}“`);
  return `${teil.join(", ")}${ende < bis ? ", …" : ""}`;
}

function stelleBefund(stelle, { namen, stand }) {
  const ort = `${stelle.datei}:${bereichText(stelle)}`;
  const inhalt = pfadIstSauber(stelle.datei) ? stand.datei(stelle.datei) : null;
  if (inhalt === null) return `${ort}: ${stelle.datei} gibt es im ${stand.name} nicht`;
  const zeilen = zeilenVon(inhalt);
  if (stelle.von < ERSTE_ZEILE) return `${ort}: Zeilen zählen ab ${ERSTE_ZEILE}, Zeile ${stelle.von} gibt es nicht`;
  if (stelle.bis > zeilen.length) return `${ort}: ${stelle.datei} hat im ${stand.name} nur ${zeilen.length} Zeilen`;
  const text = gleicherText(zeilen.slice(stelle.von - 1, stelle.bis).join(" "));
  if (namen.some((name) => text.includes(name))) return null;
  const genannt = namen.length === 0 ? "die Annahme nennt keinen Namen" : `keiner der Namen ${namen.map((name) => `„${name}“`).join(", ")} steht dort`;
  return `${ort}: ${genannt}; dort steht ${gezeigt(zeilen, stelle)}. ${KORREKTUR}`;
}

function annahmeBefunde(annahme, index, stand) {
  if (!istObjekt(annahme) || !istText(annahme.text)) return [];
  const stellen = genannteStellen({ [index]: annahme.text });
  if (stellen.length === 0) return [];
  const namen = namenDerAnnahme(annahme.text);
  const wo = `${SCHNITT}, annahmen[${index}]${istText(annahme.auftrag) ? ` (${annahme.auftrag})` : ""}`;
  return stellen.map((stelle) => stelleBefund(stelle, { namen, stand })).filter(Boolean).map((befund) => `Zeilenbeleg in ${wo}: ${befund}`);
}

export function zeilenbelegBefunde(ordner, root) {
  const { wert: schnitt, befund } = lies(ordner, SCHNITT);
  if (befund) return [befund];
  const annahmen = istObjekt(schnitt) ? liste(schnitt.annahmen) : [];
  if (!annahmen.some((annahme) => istText(annahme?.text) && genannteStellen({ text: annahme.text }).length > 0)) return [];
  const stand = standDerPlanung(ordner, root);
  if (stand.befund) return [stand.befund];
  return annahmen.flatMap((annahme, index) => annahmeBefunde(annahme, index, stand));
}
