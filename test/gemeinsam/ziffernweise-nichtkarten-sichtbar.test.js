import { test } from "node:test";
import assert from "node:assert/strict";
import { findRestrictedData, maskRestrictedText } from "../../src/restricted-data.js";
import {
  AGENT,
  COUNTERPARTY,
  anrufeJeGruppe,
  bestaetigungsServerOptionen,
  einzeln,
  einzigeAusgabezeile,
  hatLuhnFensterMitKartenanfang,
  luhnGueltig,
  rufeWerkzeug,
  starteServer,
} from "./kartenmaskierung.js";

const NICHT_KARTE_MASKIERT = "Nicht-Karte maskiert";
const KARTE_UNMASKIERT = "Karte im Klartext";
const FENSTER_MIN_ZIFFERN = 15;
const RUFNUMMER_MAX_ZIFFERN = 15;
const IBAN_MOD97_REST = 1n;
const IBAN_MOD97_TEILER = 97n;
const IBAN_BUCHSTABENWERT_VERSATZ = 55;
const BESTAETIGUNGSCODE = /^[0-9A-HJKMNP-TV-Z]{6}$/;
const BESTAETIGUNGS_GEHEIMNIS = "ziffernweise-nichtkarten-test-secret-min-32-zeichen";
const ZIEL_NUMMER = "+4915112340077";

const AMEX_15 = "378282246310005";
const VISA_15_LUHN_GUELTIG = "411111111111116";
const VISA_16 = "4111111111111111";
const REFERENZ_16_LUHN_GUELTIG = "3100000000000003";
const REFERENZ_PRAEFIX_OHNE_KARTENMARKE = "31";
const IBAN_DE_MIT_LUHN_FENSTER = "DE89370400440532013097";
const RUFNUMMER_VORNE = "04111111";
const RUFNUMMER_HINTEN = "111111111";
const FREMDE_RUFNUMMER_15 = "491512345678901";
const TELEFON_MIT_PLUS = "4915123456789";

function ibanPruefsummeGueltig(iban) {
  const umgestellt = iban.slice(4) + iban.slice(0, 4);
  const zahl = umgestellt.replace(/[A-Z]/g, (buchstabe) => String(buchstabe.charCodeAt(0) - IBAN_BUCHSTABENWERT_VERSATZ));
  return BigInt(zahl) % IBAN_MOD97_TEILER === IBAN_MOD97_REST;
}

function istKarte(treffer) {
  return treffer.category === "payment_card";
}

const RUFNUMMERN = [
  [COUNTERPARTY, `Rückrufnummer ${einzeln(AMEX_15)}`],
  [AGENT, `Telefon ${einzeln(AMEX_15)}`],
  [COUNTERPARTY, `phone ${einzeln(VISA_15_LUHN_GUELTIG)}`],
  [COUNTERPARTY, `téléphone ${einzeln(VISA_15_LUHN_GUELTIG, ", ")}`],
  [COUNTERPARTY, `Telefon ${einzeln(FREMDE_RUFNUMMER_15, " - ")}`],
];

const REFERENZEN = [
  [COUNTERPARTY, `Auftragsnummer ${einzeln(REFERENZ_16_LUHN_GUELTIG)}`],
  [COUNTERPARTY, `Kundennummer ${einzeln(REFERENZ_16_LUHN_GUELTIG)}`],
  [AGENT, `Your order number is ${einzeln(REFERENZ_16_LUHN_GUELTIG)}`],
  [COUNTERPARTY, `Kundennummer ${einzeln(REFERENZ_16_LUHN_GUELTIG, ", ")}`],
];

const IBAN_ZEILEN = [
  [COUNTERPARTY, `IBAN DE ${einzeln(IBAN_DE_MIT_LUHN_FENSTER.slice(2))}`],
  [COUNTERPARTY, `IBAN D E ${einzeln(IBAN_DE_MIT_LUHN_FENSTER.slice(2))}`],
];

const ZWEI_RUECKRUFNUMMERN = [
  [COUNTERPARTY, `Rückrufnummer ${einzeln(RUFNUMMER_VORNE)}, oder ${einzeln(RUFNUMMER_HINTEN)}`],
  [COUNTERPARTY, `Rückrufnummer ${einzeln(RUFNUMMER_VORNE)}, und ${einzeln(RUFNUMMER_HINTEN)}`],
];

const GRUPPIERTE_KARTEN = [
  [COUNTERPARTY, "Rückrufnummer 3782 822463 10005", "Rückrufnummer ****0005"],
  [COUNTERPARTY, "Telefon 3782-822463-10005", "Telefon ****0005"],
];

const PLUS_ZEILEN = [
  [COUNTERPARTY, `Telefon + ${einzeln(TELEFON_MIT_PLUS)}`],
  [COUNTERPARTY, `Karte + ${einzeln(VISA_16)}`],
];

const GRUPPEN = {
  rufnummer: RUFNUMMERN,
  referenz: REFERENZEN,
  iban: IBAN_ZEILEN,
  zweiRueckrufnummern: ZWEI_RUECKRUFNUMMERN,
  gruppiert: GRUPPIERTE_KARTEN,
  plus: PLUS_ZEILEN,
};

const CALLS = anrufeJeGruppe("call_nichtkarte", GRUPPEN, ZIEL_NUMMER);

const srv = starteServer(() => bestaetigungsServerOptionen(CALLS, BESTAETIGUNGS_GEHEIMNIS));

const werkzeug = (name, args) => rufeWerkzeug(srv, name, args);

const statuszeile = (gruppe, index) => einzigeAusgabezeile(srv, CALLS[gruppe][index].id);

async function pruefeSichtbar(gruppe) {
  for (const [index, [, text]] of GRUPPEN[gruppe].entries()) {
    const line = await statuszeile(gruppe, index);
    assert.ok(line.endsWith(text), `${NICHT_KARTE_MASKIERT}: ${line}`);
  }
}

test("Rufnummer Ziffer für Ziffer hinter Rückrufnummer, Telefon, phone und téléphone bleibt in get_call_status unmaskiert, auch wenn die Ziffern Luhn-gültig sind", async () => {
  for (const ziffern of [AMEX_15, VISA_15_LUHN_GUELTIG]) {
    assert.ok(luhnGueltig(ziffern) && /^[2-6]/.test(ziffern) && ziffern.length <= RUFNUMMER_MAX_ZIFFERN);
  }
  await pruefeSichtbar("rufnummer");
});

test("Referenznummer Ziffer für Ziffer hinter Auftragsnummer, Kundennummer und order number bleibt in get_call_status unmaskiert", async () => {
  assert.ok(luhnGueltig(REFERENZ_16_LUHN_GUELTIG) && REFERENZ_16_LUHN_GUELTIG.startsWith(REFERENZ_PRAEFIX_OHNE_KARTENMARKE));
  await pruefeSichtbar("referenz");
});

test("Referenznummer Ziffer für Ziffer wird von findRestrictedData nicht als Karte erkannt", () => {
  for (const [, text] of REFERENZEN) {
    assert.deepEqual(findRestrictedData(text).filter(istKarte), [], `${NICHT_KARTE_MASKIERT}: ${text}`);
  }
});

test("Rufnummer Ziffer für Ziffer wird von findRestrictedData nicht als Karte erkannt", () => {
  for (const [, text] of RUFNUMMERN) {
    assert.deepEqual(findRestrictedData(text).filter(istKarte), [], `${NICHT_KARTE_MASKIERT}: ${text}`);
  }
});

test("ziffernweise IBAN mit Luhn-gültigem Fenster wird von findRestrictedData nicht als Karte erkannt und in get_call_result nicht maskiert", async () => {
  assert.ok(ibanPruefsummeGueltig(IBAN_DE_MIT_LUHN_FENSTER));
  assert.ok(hatLuhnFensterMitKartenanfang(IBAN_DE_MIT_LUHN_FENSTER.slice(2), FENSTER_MIN_ZIFFERN));
  for (const [index, [, text]] of IBAN_ZEILEN.entries()) {
    assert.deepEqual(findRestrictedData(text).filter(istKarte), [], `${NICHT_KARTE_MASKIERT}: ${text}`);
    assert.equal(maskRestrictedText(text), text, `${NICHT_KARTE_MASKIERT}: ${text}`);
    const result = await werkzeug("get_call_result", { call_id: CALLS.iban[index].id });
    assert.equal(result.structuredContent.result_summary, text, `${NICHT_KARTE_MASKIERT}: ${text}`);
  }
});

test("zwei ziffernweise Rückrufnummern mit Luhn-gültigem Fenster bleiben in check_inbox und get_call_status vollständig sichtbar", async () => {
  assert.ok(RUFNUMMER_VORNE.length <= RUFNUMMER_MAX_ZIFFERN && RUFNUMMER_HINTEN.length <= RUFNUMMER_MAX_ZIFFERN);
  assert.ok(hatLuhnFensterMitKartenanfang(RUFNUMMER_VORNE + RUFNUMMER_HINTEN, FENSTER_MIN_ZIFFERN));
  await pruefeSichtbar("zweiRueckrufnummern");
  const inbox = JSON.stringify(await werkzeug("check_inbox", {}));
  for (const [, text] of ZWEI_RUECKRUFNUMMERN) {
    assert.ok(inbox.includes(text), `${NICHT_KARTE_MASKIERT}: ${text}`);
  }
});

test("gruppierte Karte hinter Rückrufnummer und Telefon wird von findRestrictedData als payment_card erkannt und in get_call_status als ****0005 ausgegeben", async () => {
  for (const [index, [, text, erwartet]] of GRUPPIERTE_KARTEN.entries()) {
    assert.equal(findRestrictedData(text).filter(istKarte).length, 1, `${KARTE_UNMASKIERT}: ${text}`);
    const line = await statuszeile("gruppiert", index);
    assert.ok(line.endsWith(erwartet), `${KARTE_UNMASKIERT}: ${line}`);
  }
});

test("Rufnummer mit führendem Plus bleibt in get_call_status sichtbar, Karte mit führendem Plus erscheint als ****1111", async () => {
  const telefonLine = await statuszeile("plus", 0);
  assert.ok(telefonLine.endsWith(PLUS_ZEILEN[0][1]), `${NICHT_KARTE_MASKIERT}: ${telefonLine}`);
  const karteLine = await statuszeile("plus", 1);
  assert.ok(karteLine.includes("****1111"), `${KARTE_UNMASKIERT}: ${karteLine}`);
  assert.ok(!karteLine.includes(einzeln(VISA_16)), `${KARTE_UNMASKIERT}: ${karteLine}`);
});

test("prepare_call mit ziffernweiser Rufnummer, Referenznummer und IBAN gibt einen Bestätigungscode aus", async () => {
  const objective =
    `Termin vereinbaren, Rückrufnummer ${einzeln(AMEX_15)}, Kundennummer ${einzeln(REFERENZ_16_LUHN_GUELTIG)}, ` +
    `IBAN DE ${einzeln(IBAN_DE_MIT_LUHN_FENSTER.slice(2))}`;
  const result = await werkzeug("prepare_call", { to: ZIEL_NUMMER, objective });
  assert.notEqual(result.isError, true, `${NICHT_KARTE_MASKIERT}: ${JSON.stringify(result)}`);
  assert.match(result._meta?.["hermes/confirmation_code"], BESTAETIGUNGSCODE);
});

test("gruppierte Karte mit Vierergruppen hinter Kundennummer wird als payment_card erkannt und als ****0003 maskiert", () => {
  assert.ok(luhnGueltig(REFERENZ_16_LUHN_GUELTIG));
  const gruppiert = REFERENZ_16_LUHN_GUELTIG.match(/\d{4}/g).join(" ");
  const text = `Kundennummer ${gruppiert}`;
  assert.equal(findRestrictedData(text).filter(istKarte).length, 1, `${KARTE_UNMASKIERT}: ${text}`);
  assert.equal(maskRestrictedText(text), "Kundennummer ****0003", `${KARTE_UNMASKIERT}: ${text}`);
});
