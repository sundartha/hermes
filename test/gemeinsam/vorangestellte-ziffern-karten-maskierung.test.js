import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT,
  COUNTERPARTY,
  anrufeJeGruppe,
  bestaetigungsServerOptionen,
  einzeln,
  einzigeAusgabezeile,
  hatLuhnFensterMitKartenanfang,
  luhnGueltig,
  starteServer,
} from "./kartenmaskierung.js";

const KARTENZIFFERN_IM_KLARTEXT = "Kartenziffern hinter fremden Ziffern im Klartext";
const FREMDE_ZIFFERN_MASKIERT = "Fremde Ziffern ohne Karte maskiert";
const WORTGETRENNTE_ANGABEN_MASKIERT = "Wortgetrennte Angaben hinter Kartenwort maskiert";
const MAX_ZIFFERN_IM_KLARTEXT = 11;
const FENSTER_MIN_ZIFFERN = 13;
const FENSTER_MAX_ZIFFERN = 19;
const ZIEL_NUMMER = "+4915112340077";
const BESTAETIGUNGS_GEHEIMNIS = "vorangestellte-ziffern-test-secret-min-32-zeichen";

const ABLAUFDATUM = "1227";
const KARTE_VISA_16 = "4111111111111111";
const KARTE_MASTERCARD_16 = "5555555555554444";

function laengsteZiffernfolge(text) {
  const ohneTrennzeichen = text.replace(/(?<=\d)[^0-9A-Za-zäöüÄÖÜß]+(?=\d)/g, "");
  return Math.max(0, ...(ohneTrennzeichen.match(/\d+/g) ?? []).map((folge) => folge.length));
}

const ZIFFERN_MIT_FORTSETZUNG = 20;
const ZIFFERN_AM_LIMIT = 19;
const PAARE_VOR_EINZELZIFFER = 9;
const MIN_ZIFFERN_OHNE_KARTENWORT = 15;
const ABSTAND_BIS_KARTENWORT_ZEICHEN = 26;
const FORTSETZUNGS_ZIFFER = "5";
const LETZTE_ZIFFERN_SICHTBAR = 4;
const MAX_SUCHSAATEN = 20000;
const PARK_MILLER_FAKTOR = 16807;
const PARK_MILLER_MODUL = 2147483647;
const PARK_MILLER_TEILER = 1000;
const FUELLTEXT = " danke".padEnd(ABSTAND_BIS_KARTENWORT_ZEICHEN, "!");

function pseudoZiffern(saat, anzahl) {
  let zustand = saat;
  let ziffern = "";
  for (let position = 0; position < anzahl; position += 1) {
    zustand = (zustand * PARK_MILLER_FAKTOR) % PARK_MILLER_MODUL;
    ziffern += String(Math.floor(zustand / PARK_MILLER_TEILER) % 10);
  }
  return ziffern;
}

function ersteZiffernMit(anzahl, passt) {
  for (let saat = 1; saat <= MAX_SUCHSAATEN; saat += 1) {
    const ziffern = pseudoZiffern(saat, anzahl);
    if (passt(ziffern)) return ziffern;
  }
  throw new Error("keine passende Ziffernfolge gefunden");
}

function gueltigeFenster(ziffern, mindestLaenge) {
  const fenster = [];
  for (let laenge = Math.min(ziffern.length, FENSTER_MAX_ZIFFERN); laenge >= mindestLaenge; laenge -= 1) {
    for (let start = 0; start + laenge <= ziffern.length; start += 1) {
      const kandidat = ziffern.slice(start, start + laenge);
      if (/^[2-6]/.test(kandidat) && luhnGueltig(kandidat)) fenster.push({ start, ende: start + laenge });
    }
  }
  return fenster;
}

function gueltigePaarFenster(ziffern, mindestLaenge) {
  const gruppenAnzahl = PAARE_VOR_EINZELZIFFER + 1;
  const fenster = [];
  for (let erste = 0; erste < gruppenAnzahl; erste += 1) {
    for (let letzte = erste + 1; letzte <= gruppenAnzahl; letzte += 1) {
      const kandidat = ziffern.slice(erste * 2, letzte * 2);
      const laengeOk = kandidat.length >= mindestLaenge && kandidat.length <= FENSTER_MAX_ZIFFERN;
      if (laengeOk && /^[2-6]/.test(kandidat) && luhnGueltig(kandidat)) fenster.push({ erste, letzte });
    }
  }
  return fenster;
}

const ZIFFERN_ZWEI_FENSTER_BIS_ZUM_ENDE = ersteZiffernMit(ZIFFERN_MIT_FORTSETZUNG, (ziffern) => {
  const fenster = gueltigeFenster(ziffern, FENSTER_MIN_ZIFFERN);
  return fenster.some((eins) => eins.start === 0) && fenster.some((eins) => eins.ende === ZIFFERN_MIT_FORTSETZUNG);
});

const ZIFFERN_GROESSTES_FENSTER_KLEINER_ALS_VEREINIGUNG = ersteZiffernMit(ZIFFERN_AM_LIMIT, (ziffern) => {
  const fenster = gueltigeFenster(ziffern, FENSTER_MIN_ZIFFERN);
  if (!fenster.length) return false;
  const vereinigungStart = Math.min(...fenster.map((eins) => eins.start));
  const vereinigungEnde = Math.max(...fenster.map((eins) => eins.ende));
  return fenster[0].start !== vereinigungStart || fenster[0].ende !== vereinigungEnde;
});

const ZIFFERN_NUR_KURZES_FENSTER_EINZELN = ersteZiffernMit(ZIFFERN_MIT_FORTSETZUNG, (ziffern) => {
  const langeFenster = gueltigeFenster(ziffern, MIN_ZIFFERN_OHNE_KARTENWORT);
  return langeFenster.length === 0 && gueltigeFenster(ziffern, FENSTER_MIN_ZIFFERN).length > 0;
});

const ZIFFERN_NUR_KURZES_FENSTER_PAARE = ersteZiffernMit(ZIFFERN_AM_LIMIT, (ziffern) => {
  const langeFenster = gueltigePaarFenster(ziffern, MIN_ZIFFERN_OHNE_KARTENWORT);
  return langeFenster.length === 0 && gueltigePaarFenster(ziffern, FENSTER_MIN_ZIFFERN).length > 0;
});

const VORLAUF_GRUPPE_ZIFFERN = 3;
const VIERERGRUPPE_ZIFFERN = 4;
const VIERERGRUPPEN_NACH_VORLAUF = 5;
const ZIFFERN_GRUPPIERT_MIT_FORTSETZUNG = VORLAUF_GRUPPE_ZIFFERN + VIERERGRUPPE_ZIFFERN * VIERERGRUPPEN_NACH_VORLAUF;
const ERSTES_FENSTER_ENDE = VORLAUF_GRUPPE_ZIFFERN + VIERERGRUPPE_ZIFFERN * (VIERERGRUPPEN_NACH_VORLAUF - 1);
const LETZTES_FENSTER_START = VORLAUF_GRUPPE_ZIFFERN + VIERERGRUPPE_ZIFFERN;

const ZIFFERN_GRUPPIERT_NUR_FENSTER_MIT_FORTSETZUNG = ersteZiffernMit(
  ZIFFERN_GRUPPIERT_MIT_FORTSETZUNG,
  (ziffern) =>
    /^[2-6]/.test(ziffern.slice(LETZTES_FENSTER_START)) &&
    luhnGueltig(ziffern.slice(LETZTES_FENSTER_START)) &&
    !luhnGueltig(ziffern.slice(VORLAUF_GRUPPE_ZIFFERN, ERSTES_FENSTER_ENDE)),
);

function gruppiertMitVorlauf(ziffern) {
  const vorlauf = ziffern.slice(0, VORLAUF_GRUPPE_ZIFFERN);
  const vierergruppen = ziffern.slice(VORLAUF_GRUPPE_ZIFFERN).match(/\d{4}/g);
  return [vorlauf, ...vierergruppen].join(" ");
}

function maskiertNurGroessteFenster(ziffern) {
  const groesstes = gueltigeFenster(ziffern, FENSTER_MIN_ZIFFERN)[0];
  const davor = groesstes.start > 0 ? `${einzeln(ziffern.slice(0, groesstes.start))} ` : "";
  const danach = groesstes.ende < ziffern.length ? ` ${einzeln(ziffern.slice(groesstes.ende))}` : "";
  return `Karte ${davor}****${ziffern.slice(groesstes.ende - LETZTE_ZIFFERN_SICHTBAR, groesstes.ende)}${danach}`;
}

const PAAR_ZEILE_KARTENWORT_ZU_WEIT =
  `${ZIFFERN_NUR_KURZES_FENSTER_PAARE.slice(0, PAARE_VOR_EINZELZIFFER * 2).match(/../g).join(" ")} ` +
  `${ZIFFERN_NUR_KURZES_FENSTER_PAARE.slice(PAARE_VOR_EINZELZIFFER * 2)} ${FORTSETZUNGS_ZIFFER}${FUELLTEXT}Karte`;
const EINZEL_ZEILE_KARTENWORT_DAHINTER = `${einzeln(ZIFFERN_NUR_KURZES_FENSTER_EINZELN)}${FUELLTEXT}Karte`;

const KARTEN_ZEILEN = [
  [COUNTERPARTY, `Karte ${einzeln(ABLAUFDATUM + KARTE_VISA_16)}`, "****1111"],
  [AGENT, `Karte ${einzeln(ABLAUFDATUM + KARTE_VISA_16)}`, "****1111"],
  [COUNTERPARTY, `Karte ${einzeln(ABLAUFDATUM + KARTE_VISA_16, ", ")}`, "****1111"],
  [COUNTERPARTY, `Karte ${einzeln(ABLAUFDATUM + KARTE_MASTERCARD_16)}`, "****4444"],
  [COUNTERPARTY, `Karte ${einzeln(ABLAUFDATUM + KARTE_MASTERCARD_16, " - ")}`, "****4444"],
  [COUNTERPARTY, `Karte ${ABLAUFDATUM} ${KARTE_VISA_16}`, "****1111"],
];

const FREMDE_ZIFFERN_ZEILE = "Gültig bis 1 2 2 7, Postleitzahl 1 0 1 1 5";

const WORTGETRENNT_ZEILE = `Karte, Ablaufdatum ${einzeln("4111")} Postleitzahl ${einzeln("11111")} Hausnummer ${einzeln("1111111")}`;

const GRUPPEN = {
  karten: KARTEN_ZEILEN,
  fremd: [[COUNTERPARTY, FREMDE_ZIFFERN_ZEILE]],
  wortgetrennt: [[COUNTERPARTY, WORTGETRENNT_ZEILE]],
  fensterGrenzen: [
    [COUNTERPARTY, `Karte ${einzeln(ZIFFERN_ZWEI_FENSTER_BIS_ZUM_ENDE)}`],
    [COUNTERPARTY, `Karte ${einzeln(ZIFFERN_GROESSTES_FENSTER_KLEINER_ALS_VEREINIGUNG)}`],
  ],
  gruppiertMitFortsetzung: [[COUNTERPARTY, `Karte ${gruppiertMitVorlauf(ZIFFERN_GRUPPIERT_NUR_FENSTER_MIT_FORTSETZUNG)}`]],
  kartenwortReichweite: [
    [COUNTERPARTY, PAAR_ZEILE_KARTENWORT_ZU_WEIT],
    [COUNTERPARTY, EINZEL_ZEILE_KARTENWORT_DAHINTER],
  ],
};

const CALLS = anrufeJeGruppe("call_vorangestellt", GRUPPEN, ZIEL_NUMMER);

const srv = starteServer(() => bestaetigungsServerOptionen(CALLS, BESTAETIGUNGS_GEHEIMNIS));

const statuszeile = (gruppe, index) => einzigeAusgabezeile(srv, CALLS[gruppe][index].id);

test("Karte hinter Ablaufdatum aus einzelnen Ziffern erscheint in get_call_status ohne 12 oder mehr Kartenziffern im Klartext", async () => {
  for (const [index, [, text, letzteVier]] of KARTEN_ZEILEN.entries()) {
    const line = await statuszeile("karten", index);
    assert.ok(
      laengsteZiffernfolge(line) <= MAX_ZIFFERN_IM_KLARTEXT,
      `${KARTENZIFFERN_IM_KLARTEXT}: ${text} -> ${line}`,
    );
    assert.ok(line.trimEnd().endsWith(letzteVier), `${KARTENZIFFERN_IM_KLARTEXT}: ${text} -> ${line}`);
  }
});

test("Ablaufdatum und Postleitzahl ohne Karte bleiben in get_call_status unverändert", async () => {
  const line = await statuszeile("fremd", 0);
  assert.ok(line.endsWith(FREMDE_ZIFFERN_ZEILE), `${FREMDE_ZIFFERN_MASKIERT}: ${line}`);
});

test("durch Wörter getrennte Angaben hinter Kartenwort mit Luhn-gültigem Fenster bleiben in get_call_status unverändert", async () => {
  const ziffern = WORTGETRENNT_ZEILE.replace(/\D/g, "");
  assert.ok(hatLuhnFensterMitKartenanfang(ziffern, FENSTER_MIN_ZIFFERN));
  const line = await statuszeile("wortgetrennt", 0);
  assert.ok(line.endsWith(WORTGETRENNT_ZEILE), `${WORTGETRENNTE_ANGABEN_MASKIERT}: ${line}`);
});

test("Karte aus 20 einzelnen Ziffern mit Luhn-gültigen Fenstern vom ersten bis zum letzten Ziffernpaar wird ganz maskiert", async () => {
  const line = await statuszeile("fensterGrenzen", 0);
  const erwartet = `Karte ****${ZIFFERN_ZWEI_FENSTER_BIS_ZUM_ENDE.slice(-LETZTE_ZIFFERN_SICHTBAR)}`;
  assert.ok(line.endsWith(erwartet), `${KARTENZIFFERN_IM_KLARTEXT}: ${line}`);
});

test("Karte aus genau 19 einzelnen Ziffern maskiert nur das größte Luhn-gültige Fenster", async () => {
  const line = await statuszeile("fensterGrenzen", 1);
  assert.ok(line.endsWith(maskiertNurGroessteFenster(ZIFFERN_GROESSTES_FENSTER_KLEINER_ALS_VEREINIGUNG)), line);
});

test("gruppierte Nummer über 19 Ziffern wird nicht über die ersten 19 Ziffern hinaus verlängert", async () => {
  const line = await statuszeile("gruppiertMitFortsetzung", 0);
  assert.ok(
    line.endsWith(`Karte ${gruppiertMitVorlauf(ZIFFERN_GRUPPIERT_NUR_FENSTER_MIT_FORTSETZUNG)}`),
    line,
  );
});

test("Kartenwort mehr als 32 Zeichen hinter einer gruppierten Nummer aus 19 Ziffern senkt die Mindestlänge nicht", async () => {
  const line = await statuszeile("kartenwortReichweite", 0);
  assert.ok(line.endsWith(PAAR_ZEILE_KARTENWORT_ZU_WEIT), line);
});

test("Kartenwort 26 Zeichen hinter 20 einzelnen Ziffern senkt die Mindestlänge auf 13 Ziffern", async () => {
  const line = await statuszeile("kartenwortReichweite", 1);
  assert.ok(line.includes("****"), `${KARTENZIFFERN_IM_KLARTEXT}: ${line}`);
});
