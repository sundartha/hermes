import { test } from "node:test";
import assert from "node:assert/strict";
import { maskRestrictedLines, maskRestrictedText } from "../../src/restricted-data.js";
import { KARTE_MASTERCARD_16, KARTE_VISA_16, einzeln } from "./kartenmaskierung.js";

const KLARTEXT = "Kartenziffern im Klartext";
const ANDERS_ALS_OHNE_ZAHL = "Angehängte Zahl ändert die Maskierung der Karte";

const MIT_KARTENWORT = (ziffern) => `Karte ${einzeln(ziffern)}`;

const FOLGEN_UEBER_19_ZIFFERN = [
  [KARTE_VISA_16 + "0000", "Karte ****1100 0 0"],
  [KARTE_VISA_16 + "0018", "Karte ****1100 1 8"],
  [KARTE_MASTERCARD_16 + "0000", "Karte ****4000 0"],
  [KARTE_VISA_16 + "00000000", "Karte ****1100 0 0 0 0 0 0"],
];

const ZEILE = (text) => ({ prefix: "", text });

const KARTEN_MIT_17_ZIFFERN = [
  ["40000000000000006", "Karte ****0006 12"],
  ["40000000000079190", "Karte ****9190 12"],
];

const KARTE_UEBER_ZEILEN = [
  [[`Karte ${einzeln(KARTE_VISA_16.slice(0, 15))}`, KARTE_VISA_16[15]], ["Karte ****", "****1111"]],
  [[`Karte ${KARTE_VISA_16[0]}`, einzeln(KARTE_VISA_16.slice(1))], ["Karte ****", "****1111"]],
  [
    [`Karte ${KARTE_VISA_16[0]}`, einzeln(KARTE_VISA_16.slice(1, 15)), KARTE_VISA_16[15]],
    ["Karte ****", "****", "****1111"],
  ],
];

const KARTE_MIT_ZAHL_DAHINTER = [
  [KARTE_VISA_16 + "3", " 00032", "Karte ****1113 00032"],
  [KARTE_VISA_16 + "00", " 00032", "Karte ****1100 00032"],
  [KARTE_VISA_16 + "18", " 12345", "Karte ****1118 12345"],
  [KARTE_VISA_16 + "26", " 99", "Karte ****1126 99"],
  [KARTE_MASTERCARD_16 + "00", " 12345", "Karte ****4400 12345"],
  [KARTE_MASTERCARD_16 + "0", " 00032", "Karte ****4440 00032"],
];

test("ziffernweise Folge aus mehr als 19 Ziffern wird nur bis zur längsten gültigen Kartenlänge von 19 Ziffern maskiert", () => {
  for (const [ziffern, erwartet] of FOLGEN_UEBER_19_ZIFFERN) {
    assert.equal(maskRestrictedText(MIT_KARTENWORT(ziffern)), erwartet, `${KLARTEXT}: ${MIT_KARTENWORT(ziffern)}`);
  }
});

test("ziffernweise Karte mit einer oder zwei Zusatzziffern wird mit einer mehrstelligen Zahl dahinter genauso maskiert wie ohne die Zahl", () => {
  for (const [ziffern, zahl, erwartet] of KARTE_MIT_ZAHL_DAHINTER) {
    const eingabe = MIT_KARTENWORT(ziffern) + zahl;
    assert.equal(maskRestrictedText(eingabe), erwartet, `${KLARTEXT}: ${eingabe}`);
    assert.equal(maskRestrictedText(eingabe), maskRestrictedText(MIT_KARTENWORT(ziffern)) + zahl, `${ANDERS_ALS_OHNE_ZAHL}: ${eingabe}`);
  }
});

test("ziffernweise Karte mit 17 Ziffern und angehängter Gruppe wird mit den letzten vier Ziffern maskiert", () => {
  for (const [ziffern, erwartet] of KARTEN_MIT_17_ZIFFERN) {
    const eingabe = `${MIT_KARTENWORT(ziffern)} 12`;
    assert.equal(maskRestrictedText(eingabe), erwartet, `${KLARTEXT}: ${eingabe}`);
  }
});

test("ziffernweise Karte über mehrere Zeilen wird maskiert, auch wenn eine Zeile nur die erste oder nur die letzte Kartenziffer enthält", () => {
  for (const [zeilen, erwartet] of KARTE_UEBER_ZEILEN) {
    assert.deepEqual(maskRestrictedLines(zeilen.map(ZEILE)), erwartet, `${KLARTEXT}: ${zeilen.join(" | ")}`);
  }
});
