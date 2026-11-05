import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, mcpPost, toolCall, readToolResult, seedState, seedCall } from "../helpers.js";
import { maskRestrictedLines } from "../../src/restricted-data.js";

const AGENT = "agent";
const COUNTERPARTY = "counterparty";
const KLARTEXT_FEHLER = "Kartenziffern über Zeilen im Klartext";
const SICHTBARE_KARTENZIFFERN_MAX = 4;
const LUHN_FENSTER_MIN = 15;
const LUHN_FENSTER_MAX = 19;

const VISA_16 = "4111111111111111";
const MASTERCARD_16 = "5555555555554444";
const RUECKRUFNUMMER_15_LUHN = "491512345678908";
const REFERENZ_TEXT = "Hallo";

const zeile = (role, text) => ({ role, text });

const DIKTAT_MIT_ZWISCHENZEILEN = [
  zeile(COUNTERPARTY, "4 1 1 1"),
  zeile(AGENT, "Ja"),
  zeile(COUNTERPARTY, "1 1 1 1"),
  zeile(AGENT, "Weiter"),
  zeile(COUNTERPARTY, "1 1 1 1"),
  zeile(COUNTERPARTY, "1 1 1 1, das war die Karte"),
];

const DIKTAT_OHNE_ZWISCHENZEILEN = [
  zeile(COUNTERPARTY, "5 5 5 5"),
  zeile(COUNTERPARTY, "5 5 5 5"),
  zeile(COUNTERPARTY, "5 5 5 5"),
  zeile(COUNTERPARTY, "4 4 4 4"),
];

const SECHZEHN_HINTER_RUECKRUFNUMMER = [
  zeile(COUNTERPARTY, "Rückrufnummer 4 1 1 1"),
  zeile(COUNTERPARTY, "1 1 1 1"),
  zeile(COUNTERPARTY, "1 1 1 1"),
  zeile(COUNTERPARTY, "1 1 1 1"),
];

const RUECKRUFNUMMER_IN_BLOECKEN = [
  zeile(COUNTERPARTY, "Rückrufnummer 4 9 1 5"),
  zeile(AGENT, "Ja"),
  zeile(COUNTERPARTY, "1 2 3 4"),
  zeile(COUNTERPARTY, "5 6 7 8"),
  zeile(COUNTERPARTY, "9 0 8"),
];

const TERMIN_UEBER_ZEILEN = [
  zeile(COUNTERPARTY, "am 2 5. 0 9."),
  zeile(COUNTERPARTY, "um 1 4 Uhr 3 0"),
  zeile(COUNTERPARTY, "PLZ 1 0 1 1 5"),
  zeile(COUNTERPARTY, "Hausnummer 7"),
];

const TERMIN_MIT_LUHN_FENSTER = [
  zeile(COUNTERPARTY, "am 2 5. 0 9."),
  zeile(COUNTERPARTY, "um 1 4 Uhr 3 0"),
  zeile(COUNTERPARTY, "PLZ 1 0 1 1 5"),
  zeile(COUNTERPARTY, "Hausnummer 1 5"),
];

const REFERENZ = [zeile(AGENT, REFERENZ_TEXT), zeile(COUNTERPARTY, REFERENZ_TEXT)];

const LANGES_GESPRAECH = [
  zeile(AGENT, "eins"),
  zeile(COUNTERPARTY, "zwei"),
  zeile(AGENT, "drei"),
  zeile(COUNTERPARTY, "vier"),
  zeile(AGENT, "fünf"),
  zeile(COUNTERPARTY, "sechs"),
  zeile(AGENT, "sieben"),
  zeile(COUNTERPARTY, "acht"),
];
const AUSGEGEBENE_ZEILEN = 6;

const TRANSKRIPTE = {
  langesGespraech: LANGES_GESPRAECH,
  diktatMitZwischenzeilen: DIKTAT_MIT_ZWISCHENZEILEN,
  diktatOhneZwischenzeilen: DIKTAT_OHNE_ZWISCHENZEILEN,
  sechzehnHinterRueckrufnummer: SECHZEHN_HINTER_RUECKRUFNUMMER,
  rueckrufnummerInBloecken: RUECKRUFNUMMER_IN_BLOECKEN,
  terminUeberZeilen: TERMIN_UEBER_ZEILEN,
  terminMitLuhnFenster: TERMIN_MIT_LUHN_FENSTER,
  referenz: REFERENZ,
};

function anruf([name, transcript]) {
  return seedCall({
    id: "call_zeilenweise_" + name.toLowerCase(),
    status: "completed",
    answeredAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    transcript,
  });
}

const ANRUFE = Object.entries(TRANSKRIPTE).map(anruf);

let srv;

before(async () => {
  srv = await startServer({ seed: seedState({ calls: ANRUFE }) });
});

after(async () => {
  await srv.stop();
});

async function ausgabezeilen(name) {
  const result = await readToolResult(
    await mcpPost(
      `${srv.localUrl}/mcp`,
      null,
      toolCall("get_call_status", { call_id: "call_zeilenweise_" + name.toLowerCase() }),
    ),
  );
  return result.structuredContent.last_transcript_lines;
}

async function rollenpraefixe() {
  const [agentZeile, gegenueberZeile] = await ausgabezeilen("referenz");
  return {
    [AGENT]: agentZeile.slice(0, -REFERENZ_TEXT.length),
    [COUNTERPARTY]: gegenueberZeile.slice(0, -REFERENZ_TEXT.length),
  };
}

function luhnGueltig(ziffern) {
  let summe = 0;
  let verdoppeln = false;
  for (let index = ziffern.length - 1; index >= 0; index--) {
    let ziffer = Number(ziffern[index]);
    if (verdoppeln) ziffer *= 2;
    if (ziffer > 9) ziffer -= 9;
    summe += ziffer;
    verdoppeln = !verdoppeln;
  }
  return summe % 10 === 0;
}

function hatLuhnFensterMitKartenpraefix(ziffern) {
  for (let laenge = LUHN_FENSTER_MIN; laenge <= LUHN_FENSTER_MAX; laenge++) {
    for (let erste = 0; erste + laenge <= ziffern.length; erste++) {
      const fenster = ziffern.slice(erste, erste + laenge);
      if (fenster[0] >= "2" && fenster[0] <= "6" && luhnGueltig(fenster)) return true;
    }
  }
  return false;
}

function ziffernAusZeilen(transcript) {
  return transcript.map((eintrag) => eintrag.text.replace(/\D/g, "")).join("");
}

async function pruefeKarteMaskiert(name, karte) {
  const zeilen = await ausgabezeilen(name);
  const sichtbar = zeilen.join("\n").replace(/\D/g, "");
  assert.ok(!sichtbar.includes(karte), KLARTEXT_FEHLER);
  assert.ok(sichtbar.length <= SICHTBARE_KARTENZIFFERN_MAX, KLARTEXT_FEHLER);
}

async function pruefeByteGleich(name) {
  const praefix = await rollenpraefixe();
  const zeilen = await ausgabezeilen(name);
  assert.deepEqual(
    zeilen,
    TRANSKRIPTE[name].map((eintrag) => praefix[eintrag.role] + eintrag.text),
  );
}

test("Karte in Blöcken über Zeilen des Gegenübers mit Zwischenzeilen des Agenten ist in get_call_status nicht zusammensetzbar", async () => {
  await pruefeKarteMaskiert("diktatMitZwischenzeilen", VISA_16);
});

test("Karte in Vierergruppen über vier aufeinanderfolgende Zeilen des Gegenübers ist in get_call_status maskiert", async () => {
  await pruefeKarteMaskiert("diktatOhneZwischenzeilen", MASTERCARD_16);
});

test("16 ziffernweise Ziffern hinter Rückrufnummer ohne Kartenwort über Zeilen sind in get_call_status maskiert", async () => {
  await pruefeKarteMaskiert("sechzehnHinterRueckrufnummer", VISA_16);
});

test("Rückrufnummer mit 15 Luhn-gültigen Ziffern in Blöcken über Zeilen bleibt in get_call_status vollständig sichtbar", async () => {
  const ziffern = ziffernAusZeilen(RUECKRUFNUMMER_IN_BLOECKEN);
  assert.equal(ziffern, RUECKRUFNUMMER_15_LUHN);
  assert.ok(luhnGueltig(ziffern));
  assert.ok(ziffern[0] >= "2" && ziffern[0] <= "6");
  await pruefeByteGleich("rueckrufnummerInBloecken");
});

test("Datum, Uhrzeit, Postleitzahl und Hausnummer in aufeinanderfolgenden Zeilen bleiben in get_call_status sichtbar", async () => {
  await pruefeByteGleich("terminUeberZeilen");
});

test("Termin über Zeilen mit Luhn-gültigem Fenster ohne Kartenwort bleibt in get_call_status sichtbar", async () => {
  assert.ok(hatLuhnFensterMitKartenpraefix(ziffernAusZeilen(TERMIN_MIT_LUHN_FENSTER)));
  await pruefeByteGleich("terminMitLuhnFenster");
});

test("Rollenpräfixe und Zeilenzahl bleiben gleich und Zeilen ohne Kartenziffern bleiben byte-gleich", async () => {
  const praefix = await rollenpraefixe();
  const zeilen = await ausgabezeilen("diktatMitZwischenzeilen");
  assert.equal(zeilen.length, DIKTAT_MIT_ZWISCHENZEILEN.length);
  for (const [index, eintrag] of DIKTAT_MIT_ZWISCHENZEILEN.entries()) {
    assert.ok(zeilen[index].startsWith(praefix[eintrag.role]));
    if (!/\d/.test(eintrag.text)) assert.equal(zeilen[index], praefix[eintrag.role] + eintrag.text);
  }
});

test("get_call_status gibt bei längerem Gespräch genau die letzten sechs Zeilen aus", async () => {
  const praefix = await rollenpraefixe();
  assert.deepEqual(
    await ausgabezeilen("langesGespraech"),
    LANGES_GESPRAECH.slice(-AUSGEGEBENE_ZEILEN).map(
      (eintrag) => praefix[eintrag.role] + eintrag.text,
    ),
  );
});

const PRAEFIX = "Gegenüber: ";

const ZEILEN_TABELLE = [
  {
    fall: "Karte über zwei Zeilen mit Text davor und danach",
    zeilen: ["Karte 4111 1111", "1111 1111, das war sie"],
    erwartet: ["Karte ****", "****1111, das war sie"],
  },
  {
    fall: "Zeilen mit fremden Ziffern vor und nach der Karte bleiben gleich",
    zeilen: ["Termin um 14 Uhr", "4111 1111", "1111 1111", "Hausnummer 15"],
    erwartet: ["Termin um 14 Uhr", "****", "****1111", "Hausnummer 15"],
  },
  {
    fall: "Zwei Karten mit einer gemeinsamen Zeile",
    zeilen: ["4111 1111", "1111 1111 und 5555 5555", "5555 4444"],
    erwartet: ["****", "****1111 und ****", "****4444"],
  },
  {
    fall: "Rückrufnummer in einer Zeile bleibt neben einer Zeile mit Kartenwort wie einzeilig sichtbar",
    zeilen: ["Karte in 2 Tagen.", "Rückrufnummer 4 9 1 5 1 2 3 4 5 6 7 8 9 0 8"],
    erwartet: ["Karte in 2 Tagen.", "Rückrufnummer 4 9 1 5 1 2 3 4 5 6 7 8 9 0 8"],
  },
];

test("Zeilenweise Maskierung ersetzt genau die Kartenteile je Zeile", () => {
  assert.ok(luhnGueltig(RUECKRUFNUMMER_15_LUHN));
  for (const { fall, zeilen, erwartet } of ZEILEN_TABELLE) {
    assert.deepEqual(
      maskRestrictedLines(zeilen.map((text) => ({ prefix: PRAEFIX, text }))),
      erwartet.map((text) => PRAEFIX + text),
      fall,
    );
  }
});
