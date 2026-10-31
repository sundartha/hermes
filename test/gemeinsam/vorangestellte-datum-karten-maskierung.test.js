import { test } from "node:test";
import assert from "node:assert/strict";
import { maskRestrictedText } from "../../src/restricted-data.js";
import {
  COUNTERPARTY,
  KARTE_MASTERCARD_16,
  KARTE_VISA_16,
  anrufeJeGruppe,
  beendeterBeispielanruf,
  einzigeAusgabezeile,
  hatLuhnFensterMitKartenanfang,
  luhnGueltig,
  rufeWerkzeug,
  starteServerMitErgebnisanruf,
  textMitAngabeAb,
} from "./kartenmaskierung.js";
import { pruefeLaufzeitVerdopplung } from "./laufzeit-verdopplung.js";

const KLARTEXT_ABNAHME = "Karte hinter vorangestelltem Datum im Klartext";
const KLARTEXT = "Kartenziffern hinter vorangestellten Ziffern im Klartext";
const VERAENDERT = "Text ohne Karte verändert";
const ZIEL_NUMMER = "+4915112340077";
const BESTAETIGUNGS_GEHEIMNIS = "vorangestelltes-datum-test-secret-min-32-zeichen";

const KARTE_AMEX_15 = "378282246310005";
const AMEX_GRUPPIERT = "3782 822463 10005";
const VISA_GRUPPIERT = "4111 1111 1111 1111";
const MASTERCARD_GRUPPIERT = "5555 5555 5555 4444";
const LETZTE_VIER_KARTENZIFFERN = 4;
const KARTENWORT_UND_DATUM = "Karte gültig bis 12/27";
const DATUM_OHNE_KARTENWORT = "12/27";
const VIERSTELLIGES_JAHR = "Karte gültig bis 12/2027";
const ZWEI_GRUPPEN_DAVOR = "Karte 01 12/27";

const TRENNZEICHEN = ["/", "; ", ";", " - ", "-", ".", ", ", "/ ", " ", "_", "…"];

const KARTEN = [
  { gruppiert: VISA_GRUPPIERT, ziffern: KARTE_VISA_16, letzteVier: "1111" },
  { gruppiert: MASTERCARD_GRUPPIERT, ziffern: KARTE_MASTERCARD_16, letzteVier: "4444" },
  { gruppiert: AMEX_GRUPPIERT, ziffern: KARTE_AMEX_15, letzteVier: "0005" },
];

const HAUPTZEILE = `${KARTENWORT_UND_DATUM} ${VISA_GRUPPIERT}`;
const POSTLEITZAHL_ZEILE = "gültig bis 12/27, Postleitzahl 10115";
const RUFNUMMER_ZEILE = "Telefon 0151 12340077";

const EINHEIT_OHNE_KARTE = "12/27 4111 0000 1511 1111 ";
const EINHEITEN_IM_ZIFFERNSTROM = 4;
const MIN_ZIFFERN_EINER_KARTE = 13;

const ERGEBNIS_STELLE = 100;
const ERGEBNIS_TEXT = textMitAngabeAb(ERGEBNIS_STELLE, HAUPTZEILE, " danke.");
const ZUSAMMENFASSUNG = `Kunde nannte ${HAUPTZEILE}.`;

const CALLS = anrufeJeGruppe(
  "call_datum",
  {
    karte: [[COUNTERPARTY, HAUPTZEILE]],
    ohneKarte: [
      [COUNTERPARTY, POSTLEITZAHL_ZEILE],
      [COUNTERPARTY, RUFNUMMER_ZEILE],
    ],
  },
  ZIEL_NUMMER,
);
const ERGEBNIS_CALL = beendeterBeispielanruf("call_datum_ergebnis", ZUSAMMENFASSUNG, ERGEBNIS_TEXT);

const srv = starteServerMitErgebnisanruf(CALLS, ERGEBNIS_CALL, BESTAETIGUNGS_GEHEIMNIS);

const ohneTrennzeichen = (text) => text.replace(/\D/g, "");

function pruefeKarteMaskiert(masked, karte, meldung) {
  const fehler = `${meldung} -> ${masked}`;
  assert.ok(masked.includes(`****${karte.letzteVier}`), fehler);
  const kartenziffernOhneLetzteVier = karte.ziffern.slice(0, -LETZTE_VIER_KARTENZIFFERN);
  assert.ok(!ohneTrennzeichen(masked).includes(kartenziffernOhneLetzteVier), fehler);
  assert.ok(!masked.includes(karte.gruppiert.slice(0, -LETZTE_VIER_KARTENZIFFERN - 1)), fehler);
}

const visa = KARTEN[0];

test("Karte hinter vorangestelltem Datum erscheint in get_call_status ohne Kartenziffern im Klartext", async () => {
  const line = await einzigeAusgabezeile(srv, CALLS.karte[0].id);
  pruefeKarteMaskiert(line, visa, `${KLARTEXT_ABNAHME}: ${HAUPTZEILE}`);
  assert.ok(line.includes(KARTENWORT_UND_DATUM), `${VERAENDERT}: ${line}`);
});

test("[NIE1] Zeile des Gegenübers mit Karte hinter Datum erscheint in get_call_status und maskRestrictedText mit ****1111 ohne die Kartenziffern", async () => {
  const line = await einzigeAusgabezeile(srv, CALLS.karte[0].id);
  pruefeKarteMaskiert(line, visa, `${KLARTEXT}: ${HAUPTZEILE}`);
  const masked = maskRestrictedText(HAUPTZEILE);
  pruefeKarteMaskiert(masked, visa, `${KLARTEXT}: ${HAUPTZEILE}`);
  assert.ok(masked.startsWith(KARTENWORT_UND_DATUM), `${VERAENDERT}: ${masked}`);
});

test("[NIE2] jedes Trennzeichen zwischen Datum und Karte, mit und ohne Kartenwort, maskiert die Karte in maskRestrictedText", () => {
  for (const vorspann of [KARTENWORT_UND_DATUM, DATUM_OHNE_KARTENWORT]) {
    for (const trenner of TRENNZEICHEN) {
      const eingabe = `${vorspann}${trenner}${VISA_GRUPPIERT}`;
      const masked = maskRestrictedText(eingabe);
      pruefeKarteMaskiert(masked, visa, `${KLARTEXT}: ${eingabe}`);
      assert.ok(masked.startsWith(vorspann), `${VERAENDERT}: ${masked}`);
    }
  }
});

test("[NIE3] vierstelliges Jahr, zwei vorangestellte Gruppen, Mastercard und Amex werden hinter dem Datum in maskRestrictedText maskiert", () => {
  for (const vorspann of [KARTENWORT_UND_DATUM, VIERSTELLIGES_JAHR, ZWEI_GRUPPEN_DAVOR]) {
    for (const karte of KARTEN) {
      for (const trenner of TRENNZEICHEN) {
        const eingabe = `${vorspann}${trenner}${karte.gruppiert}`;
        const masked = maskRestrictedText(eingabe);
        pruefeKarteMaskiert(masked, karte, `${KLARTEXT}: ${eingabe}`);
        assert.ok(masked.startsWith(vorspann), `${VERAENDERT}: ${masked}`);
      }
    }
  }
});

test("[NIE4] Karte hinter Datum erscheint in result_summary und im gekürzten outcome von get_call_result mit ****1111", async () => {
  const result = await rufeWerkzeug(srv, "get_call_result", { call_id: ERGEBNIS_CALL.id });
  pruefeKarteMaskiert(result.structuredContent.result_summary, visa, `${KLARTEXT}: ${ZUSAMMENFASSUNG}`);
  pruefeKarteMaskiert(result.structuredContent.outcome, visa, `${KLARTEXT}: ${ERGEBNIS_TEXT}`);
});

test("[NIE5] Datum mit Postleitzahl ohne Karte und eine Rufnummer hinter Telefon bleiben in get_call_status unverändert", async () => {
  for (const [index, erwartet] of [POSTLEITZAHL_ZEILE, RUFNUMMER_ZEILE].entries()) {
    const line = await einzigeAusgabezeile(srv, CALLS.ohneKarte[index].id);
    assert.ok(line.endsWith(erwartet), `${VERAENDERT}: ${line}`);
  }
});

test("[NIE6] 1 MB Text aus Datum und Nicht-Karte kommt unverändert zurück und braucht höchstens das Dreifache der Zeit von 0,5 MB", () => {
  const nummer = EINHEIT_OHNE_KARTE.slice(DATUM_OHNE_KARTENWORT.length + 1).trim();
  assert.ok(!luhnGueltig(ohneTrennzeichen(nummer)), "Nummer ist Luhn-gültig");
  const ziffernstrom = ohneTrennzeichen(EINHEIT_OHNE_KARTE.repeat(EINHEITEN_IM_ZIFFERNSTROM));
  assert.ok(!hatLuhnFensterMitKartenanfang(ziffernstrom, MIN_ZIFFERN_EINER_KARTE), "Luhn-gültiges Teilstück im Strom");
  pruefeLaufzeitVerdopplung(EINHEIT_OHNE_KARTE, maskRestrictedText);
});

test("[NIE7] bestehende Schreibweisen gruppierter Karten und eines Datums mit Kartenwort bleiben maskiert", () => {
  const erwartet = [
    ["Karte 4111 1111 1111 1111.", "****1111."],
    ["Karte 5555-5555-5555-4444", "****4444"],
    ["Karte 3782 822463 10005", "****0005"],
  ];
  for (const [eingabe, ende] of erwartet) {
    assert.ok(maskRestrictedText(eingabe).endsWith(ende), `${KLARTEXT}: ${eingabe}`);
  }
  assert.equal(maskRestrictedText(POSTLEITZAHL_ZEILE), POSTLEITZAHL_ZEILE);
});

test("Karte hinter vier einzelnen vorangestellten Ziffern mit Schrägstrichen wird ganz maskiert", () => {
  const vorspann = "Karte 1/2/3/4";
  const eingabe = `${vorspann} ${VISA_GRUPPIERT}`;
  const masked = maskRestrictedText(eingabe);
  pruefeKarteMaskiert(masked, visa, `${KLARTEXT}: ${eingabe}`);
  assert.ok(masked.startsWith(vorspann), `${VERAENDERT}: ${masked}`);
});
