import { test } from "node:test";
import assert from "node:assert/strict";
import { maskRestrictedText } from "../../src/restricted-data.js";
import {
  COUNTERPARTY,
  KARTE_VISA_16,
  anrufeJeGruppe,
  bestaetigungsServerOptionen,
  einzeln,
  einzigeAusgabezeile,
  hatLuhnFensterMitKartenanfang,
  laengsteZiffernfolge,
  luhnGueltig,
  rufeWerkzeug,
  starteServer,
} from "./kartenmaskierung.js";

const KLARTEXT = "Kartenziffern im Klartext";
const REFERENZ_VERAENDERT = "Referenznummer fälschlich verändert";
const MAX_ZIFFERN_IM_KLARTEXT = 11;
const ZIEL_NUMMER = "+4915112340077";
const BESTAETIGUNGS_GEHEIMNIS ="karten-19-test-secret-min-32-zeichen";
const KARTENZIFFERN = 19;
const KLEINSTES_FENSTER = 13;
const GROESSTES_UNTERFENSTER = 16;
const LETZTE_ZIFFERN_SICHTBAR = 4;
const MAX_SUCHSAATEN = 5000;

const DINERS_14 = "36227206271667";
const AMEX_15 = "378282246310005";
const VISA_13 = "4222222222222";
const ENDE_GRUPPEN = ["12", "123", "1234"];
const ENDE_TRENNZEICHEN = [", ", " - ", " "];

function pseudoZiffer(saat, position) {
  return Math.floor(Math.abs(Math.sin(saat * 997 + position * 31)) * 1000) % 10;
}

function mitPruefziffer(vorne) {
  return vorne + [...Array(10).keys()].find((ziffer) => luhnGueltig(vorne + ziffer));
}

function hatTeilfensterBis16(ziffern) {
  for (let start = 0; start <= ziffern.length - KLEINSTES_FENSTER; start += 1) {
    const ausschnitt = ziffern.slice(start, start + GROESSTES_UNTERFENSTER);
    if (hatLuhnFensterMitKartenanfang(ausschnitt, KLEINSTES_FENSTER)) return true;
  }
  return false;
}

function hatFensterHinterKarte(karte, gruppe) {
  const alle = karte + gruppe;
  for (let start = 1; start < alle.length; start += 1) {
    const fenster = alle.slice(start, start + KARTENZIFFERN);
    for (let laenge = KLEINSTES_FENSTER; laenge <= fenster.length; laenge += 1) {
      const kandidat = fenster.slice(0, laenge);
      const hinterKarte = start + laenge > karte.length;
      if (hinterKarte && /^[2-6]/.test(kandidat) && luhnGueltig(kandidat)) return true;
    }
  }
  return false;
}

function erfinde19stelligeKarte() {
  for (let saat = 1; saat <= MAX_SUCHSAATEN; saat += 1) {
    const vorne = "4" + Array.from({ length: KARTENZIFFERN - 2 }, (_, position) => pseudoZiffer(saat, position)).join("");
    const karte = mitPruefziffer(vorne);
    if (!hatTeilfensterBis16(karte) && !ENDE_GRUPPEN.some((gruppe) => hatFensterHinterKarte(karte, gruppe))) return karte;
  }
  throw new Error("keine passende 19-stellige Karte gefunden");
}

const KARTE_19 = erfinde19stelligeKarte();
const REFERENZ_19 = mitPruefziffer("1".repeat(KARTENZIFFERN - 1));
const LETZTE_VIER_19 = KARTE_19.slice(-LETZTE_ZIFFERN_SICHTBAR);

const GRUPPEN_ZEILEN = [" 12", " - 12", ", 123", ", 1234"];
const ZIFFERN_TRENNER = [" ", ", ", " - "];
const KARTEN_ENDE_FAELLE = [VISA_13, DINERS_14, AMEX_15, KARTE_VISA_16, KARTE_19];

const gruppenZeilen = (karte, trenner) => GRUPPEN_ZEILEN.map((gruppe) => `Karte ${einzeln(karte, trenner)}${gruppe}`);
const ZEILEN_MIT_GRUPPEN = ZIFFERN_TRENNER.flatMap((trenner) => gruppenZeilen(KARTE_19, trenner));
const ZEILEN_MIT_16_ZIFFERN = [KARTE_VISA_16, AMEX_15, VISA_13].map((karte) => `Karte ${einzeln(karte)}, 12`);
const ZEILE_OHNE_GRUPPE = `Karte ${einzeln(KARTE_19)}`;
const ZEILEN_OHNE_KARTENWORT_DAVOR = [VISA_13, DINERS_14, AMEX_15].map((karte) => `${einzeln(karte)}, 12 Karte`);
const REFERENZ_OHNE_GRUPPE = `Kundennummer ${einzeln(REFERENZ_19)}`;
const REFERENZ_MIT_GRUPPE = `${REFERENZ_OHNE_GRUPPE}, 12`;
const SUMMARY_ZEILE = `Kunde nannte Karte ${einzeln(KARTE_19)}, 12.`;

const ZEILEN = [
  ...ZEILEN_MIT_GRUPPEN,
  ...ZEILEN_MIT_16_ZIFFERN,
  ...ZEILEN_OHNE_KARTENWORT_DAVOR,
  ZEILE_OHNE_GRUPPE,
  REFERENZ_OHNE_GRUPPE,
  REFERENZ_MIT_GRUPPE,
].map((text) => [COUNTERPARTY, text]);
const CALLS = anrufeJeGruppe("call_karte19", { zeilen: ZEILEN, summary: [[COUNTERPARTY, SUMMARY_ZEILE]] }, ZIEL_NUMMER);
const ANRUFE = CALLS.zeilen;
const SUMMARY_CALL = CALLS.summary[0];

const srv = starteServer(() => bestaetigungsServerOptionen(CALLS, BESTAETIGUNGS_GEHEIMNIS));

const ausgabeZu = (text) => einzigeAusgabezeile(srv, ANRUFE[ZEILEN.findIndex(([, zeile]) => zeile === text)].id);

function pruefeKarte(zeile, letzteVier) {
  assert.ok(zeile.includes(`****${letzteVier}`), `${KLARTEXT}: ${zeile}`);
  assert.ok(laengsteZiffernfolge(zeile) <= MAX_ZIFFERN_IM_KLARTEXT, `${KLARTEXT}: ${zeile}`);
}

test("[NIE6] erfundene 19-stellige Karte ohne Luhn-Teilfenster mit 13 bis 16 Ziffern erscheint mit angehängter Gruppe in get_call_status und maskRestrictedText mit **** und den letzten vier Ziffern", async () => {
  assert.equal(KARTE_19.length, KARTENZIFFERN);
  assert.ok(luhnGueltig(KARTE_19));
  assert.ok(!hatTeilfensterBis16(KARTE_19));
  const text = `Karte ${einzeln(KARTE_19)}, 12`;
  pruefeKarte(maskRestrictedText(text), LETZTE_VIER_19);
  assert.ok(ZEILEN.some(([, zeile]) => zeile === `${ZEILE_OHNE_GRUPPE}`));
  pruefeKarte(await ausgabeZu(gruppenZeilen(KARTE_19, " ")[0]), LETZTE_VIER_19);
});

test("[NIE7] dieselbe Karte mit den Gruppen 12, - 12, 123 und 1234 und den Trennzeichen Leerzeichen, Komma und Bindestrich erscheint mit **** und den letzten vier Ziffern", async () => {
  for (const zeile of ZEILEN_MIT_GRUPPEN) {
    pruefeKarte(maskRestrictedText(zeile), LETZTE_VIER_19);
    pruefeKarte(await ausgabeZu(zeile), LETZTE_VIER_19);
  }
});

test("[NIE8] dieselbe Karte ohne Gruppe und Karten mit 13 bis 16 Ziffern mit Gruppe bleiben in get_call_status maskiert", async () => {
  pruefeKarte(await ausgabeZu(ZEILE_OHNE_GRUPPE), LETZTE_VIER_19);
  for (const zeile of ZEILEN_MIT_16_ZIFFERN) {
    const ziffern = zeile.replace(/\D/g, "").slice(0, -2);
    pruefeKarte(await ausgabeZu(zeile), ziffern.slice(-LETZTE_ZIFFERN_SICHTBAR));
  }
});

test("[NIE9] 19-stellige Karte mit angehängter Gruppe erscheint in result_summary von get_call_result mit ****", async () => {
  const result = await rufeWerkzeug(srv, "get_call_result", { call_id: SUMMARY_CALL.id });
  pruefeKarte(result.structuredContent.result_summary, LETZTE_VIER_19);
});

test("[NIE10] 19-stellige ziffernweise Referenznummer ohne Markenpräfix hinter Kundennummer bleibt mit Gruppe so sichtbar wie ohne", async () => {
  assert.ok(!/^[2-6]/.test(REFERENZ_19));
  for (const text of [REFERENZ_OHNE_GRUPPE, REFERENZ_MIT_GRUPPE]) {
    assert.ok((await ausgabeZu(text)).endsWith(text), `${REFERENZ_VERAENDERT}: ${text}`);
  }
});

test("[NIE11] hinter der angehängten Gruppe bleibt das Kartenwort sichtbar und die Karte davor endet mit ihren letzten vier Ziffern", () => {
  for (const karte of KARTEN_ENDE_FAELLE) {
    for (const gruppe of ENDE_GRUPPEN) {
      for (const trenner of ENDE_TRENNZEICHEN) {
        const eingabe = `Karte ${einzeln(karte)}${trenner}${gruppe} Karte`;
        const maske = `Karte ****${karte.slice(-LETZTE_ZIFFERN_SICHTBAR)}`;
        const masked = maskRestrictedText(eingabe);
        assert.ok(masked.startsWith(maske), `${KLARTEXT}: ${eingabe} -> ${masked}`);
        assert.equal(masked.slice(maske.length).replace(/^\D*/, ""), `${gruppe} Karte`, eingabe);
      }
    }
  }
});

test("[NIE12] ziffernweise Karte mit 13 bis 15 Ziffern und dem einzigen Kartenwort hinter der Gruppe erscheint in get_call_status mit **** und den letzten vier Ziffern", async () => {
  for (const [index, karte] of [VISA_13, DINERS_14, AMEX_15].entries()) {
    const zeile = await ausgabeZu(ZEILEN_OHNE_KARTENWORT_DAVOR[index]);
    pruefeKarte(zeile, karte.slice(-LETZTE_ZIFFERN_SICHTBAR));
  }
});
