import { test } from "node:test";
import assert from "node:assert/strict";
import { maskRestrictedText } from "../../src/restricted-data.js";
import { seedState } from "../helpers.js";
import {
  AGENT,
  COUNTERPARTY,
  MEGABYTE_CHARS,
  anrufeJeZeile,
  assertUnveraendertInnerhalbDerGrenze,
  einzeln as ziffernMit,
  einzigeAusgabezeile,
  hatLuhnFensterMitKartenanfang,
  luhnGueltig,
  pruefeMaskiert,
  starteServer,
} from "./kartenmaskierung.js";

const MIN_KARTENZIFFERN_FUER_RUFNUMMERNWORT = 16;

const VISA_16 = "4111111111111111";
const MASTERCARD_16 = "5555555555554444";
const AMEX_15 = "378282246310005";
const RUFNUMMER_VORNE = "04111111";
const RUFNUMMER_HINTEN = "111111111";

const GESCHUETZTES_LEERZEICHEN = " ";
const SCHMALES_GESCHUETZTES_LEERZEICHEN = " ";
const TABULATOR = "\t";

function ziffernGemischt(ziffern, trennerReihe) {
  return ziffern
    .split("")
    .map((ziffer, index) => (index < ziffern.length - 1 ? ziffer + trennerReihe[index % trennerReihe.length] : ziffer))
    .join("");
}

const TRENNZEICHEN_UND_GRUPPEN = [
  [AGENT, `Karte ${ziffernMit(VISA_16, " - ")}.`, "Karte ****1111."],
  [AGENT, `Karte ${ziffernMit(VISA_16, "-")}.`, "Karte ****1111."],
  [AGENT, `Karte ${ziffernMit(VISA_16, "_")}.`, "Karte ****1111."],
  [AGENT, `Karte ${ziffernMit(VISA_16, ", ")}.`, "Karte ****1111."],
  [COUNTERPARTY, `Karte ${ziffernMit(MASTERCARD_16, " - ")}.`, "Karte ****4444."],
  [AGENT, `Karte ${ziffernGemischt(VISA_16, [" ", ", ", " - ", "-", "_"])}.`, "Karte ****1111."],
  [COUNTERPARTY, `Karte ${ziffernGemischt(MASTERCARD_16, ["_", " ", "-", ", "])}.`, "Karte ****4444."],
  [COUNTERPARTY, "Kreditkarte 41 11 11 11 11 11 11 11", "Kreditkarte ****1111"],
  [COUNTERPARTY, "Karte 411 111 111 111 1111", "Karte ****1111"],
  [AGENT, "Karte 4 1 1 1… 1 1 1 1… 1 1 1 1… 1 1 1 1.", "Karte ****1111."],
  [AGENT, "Karte 4 1 1 1... 1 1 1 1; 1 1 1 1/ 1 1 1 1", "Karte ****1111"],
  [COUNTERPARTY, `Telefon ${ziffernMit(VISA_16, " ")}`, "Telefon ****1111"],
];

const LEERZEICHENARTEN = [
  [AGENT, `Karte ${ziffernMit(VISA_16, GESCHUETZTES_LEERZEICHEN)}`, "Karte ****1111"],
  [AGENT, `Karte ${ziffernMit(VISA_16, SCHMALES_GESCHUETZTES_LEERZEICHEN)}`, "Karte ****1111"],
  [AGENT, `Karte ${ziffernMit(VISA_16, TABULATOR)}`, "Karte ****1111"],
  [
    AGENT,
    `Karte 4111${GESCHUETZTES_LEERZEICHEN}1111${GESCHUETZTES_LEERZEICHEN}1111${GESCHUETZTES_LEERZEICHEN}1111`,
    "Karte ****1111",
  ],
];

const UNMASKIERT = [
  [COUNTERPARTY, `Telefon ${ziffernMit(AMEX_15, " ")}`],
  [AGENT, "Postleitzahl 1 - 0 - 1 - 1 - 5 in Berlin."],
  [AGENT, "Postleitzahl 1_0_1_1_5 in Berlin."],
  [AGENT, "Ihr Bestätigungscode ist 4 - 8 - 2 - 9 - 1 - 7."],
  [COUNTERPARTY, "Der Code lautet 4, 8, 2, 9, 1, 7."],
  [AGENT, "Der Code lautet 4-8-2-9-1-7."],
  [AGENT, "Termin am 2 5 - 0 9 - 2 0 2 6 um 1 4 : 3 0 Uhr."],
  [AGENT, "Termin am 2 5 / 0 9 / 2 0 2 6, um 1 4 ; 3 0 Uhr."],
];

const RUECKRUFNUMMERN_ZEILE = `Rückrufnummer ${ziffernMit(RUFNUMMER_VORNE, " ")} ${ziffernMit(RUFNUMMER_HINTEN, " ")}`;

const LUHN_GUELTIG_14_ZIFFERN = "41111111111114";
const LUHN_GUELTIG_17_ZIFFERN = "41111111111111113";

const UNGLEICHE_GRUPPEN_UNMASKIERT = [
  [
    AGENT,
    `Karte ${LUHN_GUELTIG_14_ZIFFERN.slice(0, 4)} ${LUHN_GUELTIG_14_ZIFFERN.slice(4, 6)} ${LUHN_GUELTIG_14_ZIFFERN.slice(6, 10)} ${LUHN_GUELTIG_14_ZIFFERN.slice(10)}`,
  ],
  [AGENT, `Karte ${ziffernMit(VISA_16.slice(0, 14), " ")} ${VISA_16.slice(14)}`],
  [AGENT, `Karte ${VISA_16.slice(0, 5)} ${VISA_16.slice(5, 10)} ${VISA_16.slice(10, 15)} ${VISA_16.slice(15)}`],
  [
    AGENT,
    `Karte ${LUHN_GUELTIG_17_ZIFFERN.slice(0, 4)} ${LUHN_GUELTIG_17_ZIFFERN.slice(4, 8)} ${LUHN_GUELTIG_17_ZIFFERN.slice(8, 12)} ${LUHN_GUELTIG_17_ZIFFERN.slice(12)}`,
  ],
];

const ZEILEN = [
  ...TRENNZEICHEN_UND_GRUPPEN,
  ...LEERZEICHENARTEN,
  ...UNMASKIERT,
  [COUNTERPARTY, RUECKRUFNUMMERN_ZEILE],
  ...UNGLEICHE_GRUPPEN_UNMASKIERT,
];
const OFFSET_UNGLEICHE_GRUPPEN = ZEILEN.length - UNGLEICHE_GRUPPEN_UNMASKIERT.length;
const OFFSET_LEERZEICHENARTEN = TRENNZEICHEN_UND_GRUPPEN.length;
const OFFSET_UNMASKIERT = OFFSET_LEERZEICHENARTEN + LEERZEICHENARTEN.length;
const OFFSET_RUECKRUFNUMMERN = OFFSET_UNMASKIERT + UNMASKIERT.length;
const ZEILEN_CALLS = anrufeJeZeile("call_trennzeichen", ZEILEN);

const srv = starteServer(() => ({ seed: seedState({ calls: ZEILEN_CALLS }) }));

const ausgabezeile = (index) => einzigeAusgabezeile(srv, ZEILEN_CALLS[index].id);

test(
  "ziffernweise Karte mit Bindestrich, Unterstrich, Komma, gemischten Trennzeichen, Paar- und Dreiergruppen, Auslassungspunkten und Rufnummernwort erscheint in get_call_status als ****1111",
  pruefeMaskiert(ausgabezeile, 0, TRENNZEICHEN_UND_GRUPPEN),
);

test(
  "ziffernweise Karte mit geschütztem Leerzeichen, schmalem geschütztem Leerzeichen und Tabulator erscheint in get_call_status als ****1111",
  pruefeMaskiert(ausgabezeile, OFFSET_LEERZEICHENARTEN, LEERZEICHENARTEN),
);

test("Entscheidung E1: 15 ziffernweise Luhn-gültige Ziffern hinter Telefon bleiben in get_call_status sichtbar, zwei Rückrufnummern mit Luhn-gültigem Fenster werden maskiert", async () => {
  assert.ok(luhnGueltig(AMEX_15) && /^[2-6]/.test(AMEX_15) && AMEX_15.length === 15);
  assert.ok(
    hatLuhnFensterMitKartenanfang(RUFNUMMER_VORNE + RUFNUMMER_HINTEN, MIN_KARTENZIFFERN_FUER_RUFNUMMERNWORT),
  );
  const [, text] = UNMASKIERT[0];
  const telefonZeile = await ausgabezeile(OFFSET_UNMASKIERT);
  assert.ok(telefonZeile.endsWith(text), `Ziffernfolge ohne Karte fälschlich verändert: ${telefonZeile}`);
  const rueckrufZeile = await ausgabezeile(OFFSET_RUECKRUFNUMMERN);
  assert.ok(rueckrufZeile.includes("****1111"), `Kartennummer im Klartext: ${rueckrufZeile}`);
  assert.ok(!rueckrufZeile.includes(ziffernMit(VISA_16, " ")), `Kartennummer im Klartext: ${rueckrufZeile}`);
});

test("Postleitzahl, Code, Datum und Uhrzeit Ziffer für Ziffer mit übrigen Trennzeichen bleiben in get_call_status unmaskiert", async () => {
  for (const [position, [, text]] of UNMASKIERT.slice(1).entries()) {
    const line = await ausgabezeile(OFFSET_UNMASKIERT + 1 + position);
    assert.ok(line.endsWith(text), `Ziffernfolge ohne Karte fälschlich verändert: ${line}`);
  }
});

test("Luhn-gültige Ziffernfolgen mit ungleichen Gruppen (4-2-4-4, Einzelziffern mit Zweiergruppe am Ende, 5-5-5-1, 4-4-4-5) bleiben in get_call_status mit Kartenwort unmaskiert", async () => {
  for (const [position, [, text]] of UNGLEICHE_GRUPPEN_UNMASKIERT.entries()) {
    const line = await ausgabezeile(OFFSET_UNGLEICHE_GRUPPEN + position);
    assert.ok(line.endsWith(text), `Ziffernfolge ohne Kartengruppen fälschlich verändert: ${line}`);
  }
});

test("1 MB aus der Ziffer 1 getrennt mit Bindestrich und Leerzeichen wird innerhalb der Laufzeitgrenze verarbeitet", () => {
  assertUnveraendertInnerhalbDerGrenze(maskRestrictedText, "1 - ".repeat(MEGABYTE_CHARS / 4));
});

test("1 MB aus der Ziffer 1 getrennt mit Unterstrich wird innerhalb der Laufzeitgrenze verarbeitet", () => {
  assertUnveraendertInnerhalbDerGrenze(maskRestrictedText, "1_".repeat(MEGABYTE_CHARS / 2));
});

test("1 MB aus der Ziffer 1 getrennt mit Komma und Leerzeichen wird innerhalb der Laufzeitgrenze verarbeitet", () => {
  assertUnveraendertInnerhalbDerGrenze(maskRestrictedText, "1, ".repeat(MEGABYTE_CHARS / 3));
});

test("1 MB aus der Ziffer 1 mit gemischten Trennzeichen wird innerhalb der Laufzeitgrenze verarbeitet", () => {
  assertUnveraendertInnerhalbDerGrenze(maskRestrictedText, "1 - 1_1, 1-".repeat(MEGABYTE_CHARS / 11));
});

const VORANGESTELLTE_ZIFFERN = "092600";
const KARTENENDE_MASTERCARD = "****4444";

function maskiertEndetMitKartenende(text) {
  const masked = maskRestrictedText(text);
  assert.ok(masked.endsWith(KARTENENDE_MASTERCARD), `Kartenende nicht maskiert: ${masked}`);
  assert.ok(!masked.includes("5 5 5 5 5") && !masked.includes("5-5-5-5-5"), `Kartennummer im Klartext: ${masked}`);
}

test("ziffernweise Karte nach sechs vorangestellten Ziffern mit Leerzeichen erscheint in maskRestrictedText bis zur letzten Ziffer maskiert", () => {
  maskiertEndetMitKartenende(`Karte ${ziffernMit(VORANGESTELLTE_ZIFFERN, " ")} ${ziffernMit(MASTERCARD_16, " ")}`);
});

test("ziffernweise Karte nach sechs vorangestellten Ziffern mit drei Auslassungspunkten erscheint in maskRestrictedText bis zur letzten Ziffer maskiert", () => {
  maskiertEndetMitKartenende(`Karte ${ziffernMit(VORANGESTELLTE_ZIFFERN, " ")} ${ziffernMit(MASTERCARD_16, "...")}`);
});

test("ziffernweise Karte nach sechs vorangestellten Ziffern mit Bindestrich ohne Leerzeichen erscheint in maskRestrictedText bis zur letzten Ziffer maskiert", () => {
  maskiertEndetMitKartenende(`Karte ${ziffernMit(VORANGESTELLTE_ZIFFERN, " ")} ${ziffernMit(MASTERCARD_16, "-")}`);
});

test("19 ziffernweise Ziffern mit zwei zusammenhängenden Ziffern dahinter maskiert maskRestrictedText als Karte", () => {
  const eingabe = `Karte ${ziffernMit(`${MASTERCARD_16}000`, " ")} 12`;
  const masked = maskRestrictedText(eingabe);
  assert.ok(masked.includes(KARTENENDE_MASTERCARD), `Kartenende nicht maskiert: ${masked}`);
  assert.ok(!masked.includes("5 5 5 5 5") && !masked.includes("5-5-5-5-5"), `Kartennummer im Klartext: ${masked}`);
});
