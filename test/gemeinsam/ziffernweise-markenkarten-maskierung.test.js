import { test } from "node:test";
import assert from "node:assert/strict";
import { findRestrictedData, maskRestrictedText } from "../../src/restricted-data.js";
import {
  COUNTERPARTY,
  anrufeJeGruppe,
  bestaetigungsServerOptionen,
  einzeln,
  einzigeAusgabezeile,
  luhnGueltig,
  starteServer,
} from "./kartenmaskierung.js";

const KARTE_IM_KLARTEXT = "Ziffernweise Karte mit Markenpräfix im Klartext";
const SCHUTZ_KARTE_OFFEN = "Schutz verletzt, Karte nicht maskiert";
const SCHUTZ_NICHTKARTE_MASKIERT = "Schutz verletzt, Nicht-Karte maskiert";
const KARTENZIFFERN_MIN_IM_KLARTEXT = 12;
const RUFNUMMER_ZIFFERN = 15;
const REFERENZ_LAENGE = 16;
const BESTAETIGUNGS_GEHEIMNIS = "ziffernweise-markenkarten-test-secret-min-32-zeichen";
const ZIEL_NUMMER = "+4915112340077";
const FUELLZIFFERN = "123456789012345";

const REFERENZWOERTER = ["Kundennummer", "Auftragsnummer", "order number"];
const TRENNER_KOMMA_UND_BINDESTRICH = [", ", " - "];

const MASTERCARD_KOMPAKT = "5555555555554444";
const MASTERCARD_MASKE = "****4444";
const VISA_KOMPAKT = "4111111111111111";
const VISA_MASKE = "****1111";
const REFERENZ_PRAEFIX_OHNE_MARKE = "31";
const RUFNUMMER_PRAEFIX = "49";

function mitPruefziffer(rumpf) {
  for (let pruefziffer = 0; pruefziffer <= 9; pruefziffer += 1) {
    if (luhnGueltig(rumpf + pruefziffer)) return rumpf + pruefziffer;
  }
  throw new Error("keine Prüfziffer");
}

function karte(praefix, laenge) {
  const rumpf = praefix + FUELLZIFFERN.slice(0, laenge - praefix.length - 1);
  const ziffern = mitPruefziffer(rumpf);
  if (!(luhnGueltig(ziffern) && ziffern.length === laenge)) throw new Error(`Testkarte ungültig: Präfix ${praefix}, Länge ${laenge}`);
  return ziffern;
}

const MARKEN = [
  ["34", 15],
  ["37", 15],
  ["36", 14],
  ["38", 14],
  ["300", 14],
  ["305", 14],
  ["3528", 16],
  ["3589", 16],
  ["2221", 16],
  ["2720", 16],
  ["6011", 16],
  ["644", 16],
  ["649", 16],
  ["65", 16],
  ["62", 16],
  ["50", 16],
  ["56", 16],
  ["69", 16],
  ["51", 16],
  ["55", 16],
].map(([praefix, laenge]) => karte(praefix, laenge));

const REFERENZ_OHNE_MARKE = karte(REFERENZ_PRAEFIX_OHNE_MARKE, REFERENZ_LAENGE);
const RUFNUMMER_15 = mitPruefziffer(RUFNUMMER_PRAEFIX + FUELLZIFFERN.slice(0, RUFNUMMER_ZIFFERN - RUFNUMMER_PRAEFIX.length - 1));

const istKarte = (treffer) => treffer.category === "payment_card";
const letzteVier = (ziffern) => `****${ziffern.slice(-4)}`;
const nurZiffern = (text) => text.replace(/\D/g, "");

const SERVER_ZEILEN = {
  mastercard: REFERENZWOERTER.map((wort) => [COUNTERPARTY, `${wort} ${einzeln(MASTERCARD_KOMPAKT)}`]),
  referenz: REFERENZWOERTER.map((wort) => [COUNTERPARTY, `${wort} ${einzeln(REFERENZ_OHNE_MARKE)}`]),
  rufnummer: [[COUNTERPARTY, `Telefon ${einzeln(RUFNUMMER_15)}`]],
  kompakt: [[COUNTERPARTY, `Kundennummer ${MASTERCARD_KOMPAKT}`]],
  gruppiert: [[COUNTERPARTY, `Kundennummer ${MASTERCARD_KOMPAKT.match(/\d{4}/g).join(" ")}`]],
  visa: [[COUNTERPARTY, `Kundennummer ${einzeln(VISA_KOMPAKT)}`]],
};

const CALLS = anrufeJeGruppe("call_markenkarte", SERVER_ZEILEN, ZIEL_NUMMER);
const srv = starteServer(() => bestaetigungsServerOptionen(CALLS, BESTAETIGUNGS_GEHEIMNIS));
const statuszeile = (gruppe, index) => einzigeAusgabezeile(srv, CALLS[gruppe][index].id);

async function pruefeMastercardInStatus(meldung) {
  for (const [index, [, text]] of SERVER_ZEILEN.mastercard.entries()) {
    const zeile = await statuszeile("mastercard", index);
    assert.ok(!nurZiffern(zeile).includes(MASTERCARD_KOMPAKT.slice(0, KARTENZIFFERN_MIN_IM_KLARTEXT)), `${meldung}: ${zeile}`);
    assert.ok(zeile.endsWith(MASTERCARD_MASKE), `${meldung}: ${zeile}`);
    assert.equal(findRestrictedData(text).filter(istKarte).length, 1, `${meldung}: ${text}`);
    assert.equal(maskRestrictedText(text), `${REFERENZWOERTER[index]} ${MASTERCARD_MASKE}`, `${meldung}: ${text}`);
  }
}

function pruefeAlleMarken(trenner, meldung) {
  for (const ziffern of MARKEN) {
    for (const wort of REFERENZWOERTER) {
      const text = `${wort} ${einzeln(ziffern, trenner)}`;
      assert.equal(findRestrictedData(text).filter(istKarte).length, 1, `${meldung}: ${text}`);
      assert.equal(maskRestrictedText(text), `${wort} ${letzteVier(ziffern)}`, `${meldung}: ${text}`);
    }
  }
}

async function pruefeReferenzSichtbar(meldung) {
  assert.ok(luhnGueltig(REFERENZ_OHNE_MARKE) && REFERENZ_OHNE_MARKE.length === REFERENZ_LAENGE);
  for (const [index, [, text]] of SERVER_ZEILEN.referenz.entries()) {
    const zeile = await statuszeile("referenz", index);
    assert.ok(zeile.endsWith(text), `${meldung}: ${zeile}`);
  }
}

async function pruefeKompaktUndGruppiert(meldung) {
  for (const gruppe of ["kompakt", "gruppiert"]) {
    const zeile = await statuszeile(gruppe, 0);
    assert.ok(zeile.endsWith(`Kundennummer ${MASTERCARD_MASKE}`), `${meldung}: ${zeile}`);
  }
}

test("ziffernweise Mastercard hinter Referenzwort wird in get_call_status maskiert und einmal als Karte gefunden", async () => {
  await pruefeMastercardInStatus(KARTE_IM_KLARTEXT);
});

test("ziffernweise Karten aller Marken hinter Kundennummer, Auftragsnummer und order number werden maskiert", () => {
  pruefeAlleMarken(" ", KARTE_IM_KLARTEXT);
});

test("ziffernweise Karten aller Marken mit Komma und Bindestrich zwischen den Ziffern werden maskiert", () => {
  for (const trenner of TRENNER_KOMMA_UND_BINDESTRICH) pruefeAlleMarken(trenner, KARTE_IM_KLARTEXT);
});

test("[NIE1] ziffernweise Mastercard hinter Referenzwort bleibt in get_call_status maskiert", async () => {
  await pruefeMastercardInStatus(SCHUTZ_KARTE_OFFEN);
});

test("[NIE2] ziffernweise Karten aller Marken hinter Referenzwörtern bleiben maskiert", () => {
  pruefeAlleMarken(" ", SCHUTZ_KARTE_OFFEN);
});

test("[NIE3] ziffernweise Karten mit Komma und Bindestrich bleiben maskiert", () => {
  for (const trenner of TRENNER_KOMMA_UND_BINDESTRICH) pruefeAlleMarken(trenner, SCHUTZ_KARTE_OFFEN);
});

test("[NIE4] ziffernweise Referenznummer ohne Markenpräfix bleibt hinter Referenzwörtern sichtbar", async () => {
  await pruefeReferenzSichtbar(SCHUTZ_NICHTKARTE_MASKIERT);
});

test("[NIE5] ziffernweise Rufnummer mit 15 Ziffern bleibt hinter Telefon sichtbar", async () => {
  const zeile = await statuszeile("rufnummer", 0);
  assert.ok(luhnGueltig(RUFNUMMER_15) && RUFNUMMER_15.length === RUFNUMMER_ZIFFERN);
  assert.ok(zeile.endsWith(SERVER_ZEILEN.rufnummer[0][1]), `${SCHUTZ_NICHTKARTE_MASKIERT}: ${zeile}`);
  assert.equal(maskRestrictedText(SERVER_ZEILEN.rufnummer[0][1]), SERVER_ZEILEN.rufnummer[0][1], SCHUTZ_NICHTKARTE_MASKIERT);
});

test("[NIE6] kompakte und gruppierte Mastercard hinter Kundennummer bleiben ****4444", async () => {
  await pruefeKompaktUndGruppiert(SCHUTZ_KARTE_OFFEN);
});

test("[NIE7] ziffernweise Visa hinter Kundennummer bleibt ****1111", async () => {
  const zeile = await statuszeile("visa", 0);
  assert.ok(zeile.endsWith(`Kundennummer ${VISA_MASKE}`), `${SCHUTZ_KARTE_OFFEN}: ${zeile}`);
});
