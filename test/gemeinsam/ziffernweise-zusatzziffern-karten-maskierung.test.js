import { test } from "node:test";
import assert from "node:assert/strict";
import { maskRestrictedText } from "../../src/restricted-data.js";
import {
  COUNTERPARTY,
  KARTE_MASTERCARD_16,
  KARTE_VISA_16,
  anrufeJeGruppe,
  beendeterBeispielanruf,
  einzeln,
  einzigeAusgabezeile,
  pruefeMaskiertOhneKlartext,
  rufeWerkzeug,
  starteServerMitErgebnisanruf,
} from "./kartenmaskierung.js";
import { pruefeLaufzeitVerdopplung } from "./laufzeit-verdopplung.js";

const KLARTEXT_ABNAHME = "Ziffernweise Karte mit angehängter Gruppe im Klartext";
const KLARTEXT = "Kartenziffern im Klartext";
const FREMDE_ZIFFERN_MASKIERT = "Fremde Ziffern ohne Karte maskiert";
const ZIEL_NUMMER = "+4915112340077";
const BESTAETIGUNGS_GEHEIMNIS = "zusatzziffern-test-secret-min-32-zeichen";

const DREI_ZUSATZZIFFERN = "123";
const KARTE_MIT_ZUSATZ = KARTE_VISA_16 + DREI_ZUSATZZIFFERN;
const GRUPPEN = ["12", "123", "1234"];
const TRENNZEICHEN_VOR_GRUPPE = [", ", " - ", " "];
const ZIFFERN_FOLGEN_MIT_ZUSATZ_VOR_UND_NACH_DER_KARTE = [
  "12" + KARTE_VISA_16 + "3",
  "09" + KARTE_VISA_16 + "2",
  "1" + KARTE_MASTERCARD_16 + "12",
  KARTE_MASTERCARD_16 + DREI_ZUSATZZIFFERN,
];
const EINHEIT_MIT_ZWEIERGRUPPE = einzeln("1".repeat(19)) + ", 11 ";

const FREMDE_ZIFFERN_ZEILE = "Gültig bis 1 2 2 7, Postleitzahl 1 0 1 1 5";
const WORTGETRENNT_ZEILE = `Karte, Ablaufdatum ${einzeln("4111")} Postleitzahl ${einzeln("11111")} Hausnummer ${einzeln("1111111")}`;

const kartenzeile = (ziffern, trenner, gruppe) => `Karte ${einzeln(ziffern)}${trenner}${gruppe}`;

const ZEILEN_MIT_GRUPPE = GRUPPEN.flatMap((gruppe) =>
  TRENNZEICHEN_VOR_GRUPPE.map((trenner) => kartenzeile(KARTE_MIT_ZUSATZ, trenner, gruppe)),
);
const ZEILEN_MIT_ZUSATZ_VOR_UND_NACH_DER_KARTE = ZIFFERN_FOLGEN_MIT_ZUSATZ_VOR_UND_NACH_DER_KARTE.map((ziffern) =>
  kartenzeile(ziffern, ", ", "12"),
);
const ERGEBNIS_ZEILE = kartenzeile(KARTE_MIT_ZUSATZ, ", ", "12");

const CALLS = anrufeJeGruppe(
  "call_zusatz",
  {
    gegenueber: [[COUNTERPARTY, ERGEBNIS_ZEILE]],
    fremd: [
      [COUNTERPARTY, FREMDE_ZIFFERN_ZEILE],
      [COUNTERPARTY, WORTGETRENNT_ZEILE],
    ],
  },
  ZIEL_NUMMER,
);
const ERGEBNIS_CALL = beendeterBeispielanruf(
  "call_zusatz_ergebnis",
  `Kunde nannte ${ERGEBNIS_ZEILE}.`,
  ERGEBNIS_ZEILE,
);

const srv = starteServerMitErgebnisanruf(CALLS, ERGEBNIS_CALL, BESTAETIGUNGS_GEHEIMNIS);

test("ziffernweise Karte mit drei Zusatzziffern und angehängter Gruppe erscheint in get_call_status ohne 12 Kartenziffern im Klartext", async () => {
  const line = await einzigeAusgabezeile(srv, CALLS.gegenueber[0].id);
  pruefeMaskiertOhneKlartext(line, ERGEBNIS_ZEILE, KLARTEXT_ABNAHME);
});

test("[NIE1] Zeile des Gegenübers mit Karte, drei Zusatzziffern und Monat erscheint in get_call_status ohne 12 Kartenziffern im Klartext und in maskRestrictedText mit ****", async () => {
  const line = await einzigeAusgabezeile(srv, CALLS.gegenueber[0].id);
  pruefeMaskiertOhneKlartext(line, ERGEBNIS_ZEILE, KLARTEXT);
  pruefeMaskiertOhneKlartext(maskRestrictedText(ERGEBNIS_ZEILE), ERGEBNIS_ZEILE, KLARTEXT);
});

test("[NIE2] Gruppen aus zwei bis vier Ziffern mit den Trennzeichen davor und Zusatzziffern vor und nach der Karte erscheinen in maskRestrictedText mit ****", () => {
  for (const zeile of [...ZEILEN_MIT_GRUPPE, ...ZEILEN_MIT_ZUSATZ_VOR_UND_NACH_DER_KARTE]) {
    pruefeMaskiertOhneKlartext(maskRestrictedText(zeile), zeile, KLARTEXT);
  }
});

test("[NIE3] Karte mit angehängter Gruppe erscheint in result_summary und outcome von get_call_result mit ****", async () => {
  const result = await rufeWerkzeug(srv, "get_call_result", { call_id: ERGEBNIS_CALL.id });
  pruefeMaskiertOhneKlartext(result.structuredContent.result_summary, ERGEBNIS_ZEILE, KLARTEXT);
  pruefeMaskiertOhneKlartext(result.structuredContent.outcome, ERGEBNIS_ZEILE, KLARTEXT);
});

test("[NIE4] Ablaufdatum und Postleitzahl sowie wortgetrennte Angaben hinter dem Kartenwort bleiben in get_call_status unverändert", async () => {
  for (const [index, erwartet] of [FREMDE_ZIFFERN_ZEILE, WORTGETRENNT_ZEILE].entries()) {
    const line = await einzigeAusgabezeile(srv, CALLS.fremd[index].id);
    assert.ok(line.endsWith(erwartet), `${FREMDE_ZIFFERN_MASKIERT}: ${line}`);
  }
});

test("[NIE5] 1 MB ziffernweiser Text mit Zweiergruppen kommt unverändert zurück und braucht höchstens das Dreifache der Zeit von 0,5 MB", () => {
  pruefeLaufzeitVerdopplung(EINHEIT_MIT_ZWEIERGRUPPE, maskRestrictedText);
});

test("[NIE14] 19 ziffernweise Ziffern mit zwei zusammenhängenden Ziffern dahinter zeigen in maskRestrictedText die Maske mit den letzten vier Kartenziffern", () => {
  const masked = maskRestrictedText(`Karte ${einzeln(`${KARTE_MASTERCARD_16}000`)} 12`);
  assert.ok(masked.includes("****4444"), `${KLARTEXT}: ${masked}`);
  assert.ok(!masked.includes("5 5 5 5 5") && !/\d{5}/.test(masked), `${KLARTEXT}: ${masked}`);
});

test("[NIE13] bestehende Schreibweisen vorangestellter Ziffern, gruppierter und ziffernweiser Karten bleiben maskiert", () => {
  const erwartet = [
    [`Karte ${einzeln("092600")} ${einzeln(KARTE_MASTERCARD_16)}`, "****4444"],
    [`Karte ${einzeln("092600")} ${einzeln(KARTE_MASTERCARD_16, "-")}`, "****4444"],
    [`Karte ${einzeln(KARTE_VISA_16)}.`, "****1111."],
    ["Karte 4111 1111 1111 1111.", "****1111."],
  ];
  for (const [eingabe, ende] of erwartet) {
    assert.ok(maskRestrictedText(eingabe).endsWith(ende), `${KLARTEXT}: ${eingabe}`);
  }
});
