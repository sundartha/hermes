import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, mcpPost, toolCall, readToolResult, seedState, seedCall } from "../helpers.js";
import { normalizeCallResult } from "../../src/call-result.js";
import { PASSWORT_BEISPIEL } from "./erfundene-geheimnisse.js";

const KLARTEXT_FEHLER = "Kartenziffern im gekürzten Ergebnis im Klartext";
const ANGABE_FEHLER = "Angabe im gekürzten Ergebnis im Klartext";
const KUERZUNG_FEHLER = "Ergebnisfeld anders gekürzt als heute";

const GRENZE = 200;
const KARTENWORT = "Karte ";
const VISA_GRUPPIERT = "4111 1111 1111 1111";
const VISA_ZIFFERN = "4111111111111111";
const MASTERCARD_GRUPPIERT = "5555 5555 5555 4444";
const DINERS_GRUPPIERT = "3056 930902 5904";
const DINERS_ZIFFERN = "30569309025904";
const VISA_ZIFFERNWEISE = VISA_ZIFFERN.split("").join(" ");
const VISA_ZIFFERNWEISE_STRICH = VISA_ZIFFERN.split("").join(" - ");
const STEUER_ID = "Steuer-ID 12 345 678 901";
const REISEPASS = "Reisepassnummer 123 456 789";
const PIN = "PIN: 4711";
const PASSWORT_KENNWORT = "password: ";
const PASSWORT_MIT_KARTENWORT = "Karte!Hunter2";
const RUECKRUFNUMMER_NULL = "Rückrufnummer 0151 1234 5678";
const RUECKRUFNUMMER_VIER = "Rückrufnummer 49 151 1234 5678";
const ZUSAMMENFASSUNG_MIT_KARTE = "Der Kunde nannte die Karte 4111 1111 1111 1111 zur Zahlung.";
const NACHTEXT =
  " und danach haben wir den Termin am Montag besprochen und alles Weitere freundlich geklärt.";
const KURZER_EINTRAG = "Rückmeldung an den Kunden";
const FRUEHER_ANFANG = "Kunde gab ";

const MASKEN = /\*{4}\d{0,4}|\[restricted-credential\]|\[restricted-government-id\]/g;

function fuelltext(laenge) {
  let text = "";
  while (laenge - text.length >= 9) text += "Termin ";
  return text + "a".repeat(laenge - text.length - 1) + " ";
}

function feldMitAngabeAb(stelle, angabe, nachtext = NACHTEXT) {
  return fuelltext(stelle) + angabe + nachtext;
}

function stellen(von, bis) {
  return Array.from({ length: bis - von + 1 }, (_, index) => von + index);
}

function ergebnisMit(text) {
  return {
    outcome: text,
    next_step: text,
    commitments: [text, KURZER_EINTRAG, text],
    counterparty_commitments: [KURZER_EINTRAG, text],
    open_points: [text],
  };
}

const ANRUFE = [];

function anrufMitFeld(text, summary = null) {
  const id = "call_gekuerzt_" + "x".repeat(ANRUFE.length + 1);
  ANRUFE.push(
    seedCall({
      id,
      direction: "inbound",
      status: "completed",
      answeredAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      summary,
      objectiveAchieved: true,
      inboxEntryAt: new Date().toISOString(),
      result: normalizeCallResult(ergebnisMit(text), { evidenceAllowed: false }),
    }),
  );
  return { id, text };
}

const KARTE_AN_DER_GRENZE = stellen(170, 199).map((stelle) =>
  anrufMitFeld(feldMitAngabeAb(stelle - KARTENWORT.length, KARTENWORT + VISA_GRUPPIERT)),
);

const KONTEXTWORT_STELLEN = [185, 190, 195, 196, 197, 198, 199, 200, 201, 205, 210];
const KONTEXTWORT_AN_DER_GRENZE = KONTEXTWORT_STELLEN.map((stelleDesWorts) =>
  anrufMitFeld(
    feldMitAngabeAb(stelleDesWorts - DINERS_GRUPPIERT.length - 1, DINERS_GRUPPIERT + " Karte"),
  ),
);

const ZUSAMMENFASSUNG_UND_FELD = [185, 190, 195].map((stelle) =>
  anrufMitFeld(
    feldMitAngabeAb(stelle - KARTENWORT.length, KARTENWORT + VISA_GRUPPIERT),
    ZUSAMMENFASSUNG_MIT_KARTE,
  ),
);

const ZIFFERNWEISE_AN_DER_GRENZE = [VISA_ZIFFERNWEISE, VISA_ZIFFERNWEISE_STRICH].flatMap((karte) =>
  stellen(170, 199).map((stelle) =>
    anrufMitFeld(feldMitAngabeAb(stelle - KARTENWORT.length, KARTENWORT + karte)),
  ),
);

const AUSWEIS_AN_DER_GRENZE = [STEUER_ID, REISEPASS].flatMap((angabe) =>
  stellen(GRENZE - angabe.length, GRENZE - 1).map((stelle) =>
    anrufMitFeld(feldMitAngabeAb(stelle, angabe)),
  ),
);

const PASSWORT = PASSWORT_KENNWORT + PASSWORT_BEISPIEL;
const GEHEIMNISSE = [
  { angabe: PIN, kennwort: "PIN: ", wert: "4711" },
  { angabe: PASSWORT, kennwort: PASSWORT_KENNWORT, wert: PASSWORT_BEISPIEL },
];
const GEHEIMNIS_AN_DER_GRENZE = GEHEIMNISSE.flatMap((geheimnis) =>
  stellen(190, 199).flatMap((stelle) => [
    { ...geheimnis, ...anrufMitFeld(feldMitAngabeAb(stelle, geheimnis.angabe)) },
    {
      ...geheimnis,
      ...anrufMitFeld(feldMitAngabeAb(stelle - geheimnis.kennwort.length, geheimnis.angabe)),
    },
  ]),
);

const DINERS_VOR_PASSWORT = DINERS_GRUPPIERT + " " + PASSWORT_KENNWORT;
const ZWEITER_SCHNITT = stellen(GRENZE - PASSWORT_MIT_KARTENWORT.length + 1, GRENZE - 1).map(
  (stelleDesWerts) =>
    anrufMitFeld(
      feldMitAngabeAb(
        stelleDesWerts - DINERS_VOR_PASSWORT.length,
        DINERS_VOR_PASSWORT + PASSWORT_MIT_KARTENWORT,
      ),
    ),
);

const FRUEHE_KARTE = FRUEHER_ANFANG + KARTENWORT + VISA_GRUPPIERT + " ";
const FRUEHE_UND_SPAETE_KARTE = stellen(182, 199).map((stelle) =>
  anrufMitFeld(
    FRUEHE_KARTE +
      feldMitAngabeAb(
        stelle - KARTENWORT.length - FRUEHE_KARTE.length,
        KARTENWORT + MASTERCARD_GRUPPIERT,
      ),
  ),
);

const OHNE_ANGABE = anrufMitFeld(
  "  " + feldMitAngabeAb(150, "Termin am 12. Mai um 14 Uhr in der Filiale am Markt bestätigt"),
);
const RUFNUMMERN_AN_DER_GRENZE = [RUECKRUFNUMMER_NULL, RUECKRUFNUMMER_VIER].flatMap((angabe) =>
  stellen(186, 199).map((stelle) => anrufMitFeld(feldMitAngabeAb(stelle - 14, angabe))),
);

const KARTE_FRUEH = anrufMitFeld(
  feldMitAngabeAb(10, KARTENWORT + VISA_GRUPPIERT, NACHTEXT.repeat(3)),
);

const FRUEHE_KARTE_UND_KONTEXTWORT = KONTEXTWORT_STELLEN.map((stelleDesWorts) =>
  anrufMitFeld(
    FRUEHE_KARTE +
      feldMitAngabeAb(
        stelleDesWorts - DINERS_GRUPPIERT.length - 1 - FRUEHE_KARTE.length,
        DINERS_GRUPPIERT + " Karte",
      ),
  ),
);

const KARTE_ENDET_AN_DER_GRENZE = anrufMitFeld(
  feldMitAngabeAb(GRENZE - VISA_GRUPPIERT.length - KARTENWORT.length, KARTENWORT + VISA_GRUPPIERT),
);

let srv;

before(async () => {
  srv = await startServer({ seed: seedState({ calls: ANRUFE }) });
});

after(async () => {
  await srv.stop();
});

async function werkzeug(name, args) {
  return readToolResult(await mcpPost(`${srv.localUrl}/mcp`, null, toolCall(name, args)));
}

function kartenfelder(daten) {
  return [
    daten.outcome,
    daten.next_step,
    ...daten.commitments,
    ...daten.counterparty_commitments,
    ...daten.open_points,
  ];
}

async function ergebnisfelder(anruf) {
  const result = await werkzeug("get_call_result", { call_id: anruf.id });
  return kartenfelder(result.structuredContent);
}

let inboxEintraege = null;

async function alleInboxEintraege() {
  if (inboxEintraege) return inboxEintraege;
  const gesammelt = new Map();
  let rest = 1;
  while (rest > 0) {
    const { structuredContent } = await werkzeug("check_inbox", {});
    for (const eintrag of structuredContent.entries) gesammelt.set(eintrag.call_id, eintrag);
    rest = structuredContent.entries.length ? structuredContent.remaining : 0;
  }
  inboxEintraege = gesammelt;
  return gesammelt;
}

async function inboxfelder(anruf) {
  const eintrag = (await alleInboxEintraege()).get(anruf.id);
  assert.ok(eintrag);
  return kartenfelder(eintrag);
}

async function beideAusgaben(anruf) {
  return [...(await ergebnisfelder(anruf)), ...(await inboxfelder(anruf))];
}

async function beideAusgabenWie(anruf, text) {
  const erwartet = kartenfelder(ergebnisMit(text));
  assert.deepEqual(await ergebnisfelder(anruf), erwartet, KUERZUNG_FEHLER);
  assert.deepEqual(await inboxfelder(anruf), erwartet, KUERZUNG_FEHLER);
}

function ohneMasken(text) {
  return text.replace(MASKEN, "");
}

function pruefeKeineZiffernAusserMaske(felder, meldung) {
  for (const feld of felder) assert.ok(!/\d/.test(ohneMasken(feld)), meldung);
}

test("Karte, die an den Stellen 170 bis 199 vor der Grenze beginnt, zeigt in get_call_result und check_inbox höchstens die letzten vier Ziffern hinter ****", async () => {
  for (const anruf of KARTE_AN_DER_GRENZE) {
    pruefeKeineZiffernAusserMaske(await beideAusgaben(anruf), KLARTEXT_FEHLER);
  }
});

test("Jedes Feld der Ergebniskarte wird in get_call_result und check_inbox ausgegeben", async () => {
  const [anruf] = KARTE_AN_DER_GRENZE;
  assert.equal((await ergebnisfelder(anruf)).length, 8);
  assert.equal((await inboxfelder(anruf)).length, 8);
});

test("Nummer mit abgeschnittenem Kartenwort auf, vor oder hinter der Grenze erscheint in get_call_result nie ganz im Klartext", async () => {
  for (const anruf of KONTEXTWORT_AN_DER_GRENZE) {
    for (const feld of await ergebnisfelder(anruf)) {
      assert.ok(!feld.replace(/\D/g, "").includes(DINERS_ZIFFERN), KLARTEXT_FEHLER);
      assert.ok(!feld.includes(DINERS_GRUPPIERT), KLARTEXT_FEHLER);
    }
  }
});

test("Zusammenfassung und gekürztes Feld mit derselben Karte lassen in get_call_result keine längere Ziffernfolge als die letzten vier zusammensetzen", async () => {
  for (const anruf of ZUSAMMENFASSUNG_UND_FELD) {
    const result = await werkzeug("get_call_result", { call_id: anruf.id });
    const ausgabe = { ...result.structuredContent, call_id: null };
    const ganzeAntwort = JSON.stringify(ausgabe) + result.content.map((teil) => teil.text).join("");
    pruefeKeineZiffernAusserMaske([ganzeAntwort], KLARTEXT_FEHLER);
  }
});

test("Ziffernweise Karte mit Leerzeichen oder Strich an der Grenze zeigt in get_call_result und check_inbox höchstens die letzten vier Ziffern hinter ****", async () => {
  for (const anruf of ZIFFERNWEISE_AN_DER_GRENZE) {
    pruefeKeineZiffernAusserMaske(await beideAusgaben(anruf), KLARTEXT_FEHLER);
  }
});

test("Gruppierte Steuer-ID und Reisepassnummer hinter ihrem Kennwort an der Grenze lassen keinen Rest im Klartext", async () => {
  for (const anruf of AUSWEIS_AN_DER_GRENZE) {
    pruefeKeineZiffernAusserMaske(await beideAusgaben(anruf), ANGABE_FEHLER);
  }
});

test("PIN und Passwort, die die Grenze kreuzen, zeigen in get_call_result und check_inbox keinen Teil des Werts", async () => {
  for (const anruf of GEHEIMNIS_AN_DER_GRENZE) {
    for (const feld of await beideAusgaben(anruf)) {
      assert.ok(!feld.includes(anruf.kennwort + anruf.wert[0]), ANGABE_FEHLER);
      assert.ok(!/\d/.test(ohneMasken(feld)), ANGABE_FEHLER);
    }
  }
});

test("Passwortwert mit Kartenwort an der Grenze lässt die davorstehende Diners-Nummer in get_call_result nicht ganz im Klartext", async () => {
  for (const anruf of ZWEITER_SCHNITT) {
    for (const feld of await ergebnisfelder(anruf)) {
      assert.ok(!feld.replace(/\D/g, "").includes(DINERS_ZIFFERN), KLARTEXT_FEHLER);
      assert.ok(!feld.includes(PASSWORT_KENNWORT + PASSWORT_MIT_KARTENWORT[0]), ANGABE_FEHLER);
    }
  }
});

test("Früh erkannte Karte verdeckt keine zweite Karte an der Grenze in get_call_result und check_inbox", async () => {
  for (const anruf of FRUEHE_UND_SPAETE_KARTE) {
    const langeFelder = (await beideAusgaben(anruf)).filter((feld) => feld !== KURZER_EINTRAG);
    assert.equal(langeFelder.length, 12);
    for (const feld of langeFelder) {
      assert.ok(feld.startsWith(FRUEHER_ANFANG + KARTENWORT + "****1111 "), KLARTEXT_FEHLER);
      pruefeKeineZiffernAusserMaske([feld], KLARTEXT_FEHLER);
    }
  }
});

test("Ergebnisfeld ohne erkannte Angabe wird in get_call_result und check_inbox genau wie heute auf die ersten 200 Zeichen gekürzt", async () => {
  const erwartet = OHNE_ANGABE.text.trim().slice(0, GRENZE);
  assert.equal(erwartet.length, GRENZE);
  await beideAusgabenWie(OHNE_ANGABE, erwartet);
});

test("Rückrufnummer an der Grenze bleibt in get_call_result und check_inbox sichtbar wie heute", async () => {
  for (const anruf of RUFNUMMERN_AN_DER_GRENZE) {
    await beideAusgabenWie(anruf, anruf.text.slice(0, GRENZE));
  }
});

test("Karte früh im Feld wird in get_call_result und check_inbox wie heute auf 200 Zeichen gekürzt und darin als ****1111 gezeigt", async () => {
  const erwartet = KARTE_FRUEH.text.slice(0, GRENZE).replace(VISA_GRUPPIERT, "****1111");
  await beideAusgabenWie(KARTE_FRUEH, erwartet);
});

test("Früh erkannte Karte verdeckt keine Nummer, deren Kartenwort an der Grenze abgeschnitten wird, in get_call_result", async () => {
  for (const anruf of FRUEHE_KARTE_UND_KONTEXTWORT) {
    for (const feld of await ergebnisfelder(anruf)) {
      assert.ok(!feld.replace(/\D/g, "").includes(DINERS_ZIFFERN), KLARTEXT_FEHLER);
      assert.ok(!feld.includes(DINERS_GRUPPIERT), KLARTEXT_FEHLER);
    }
  }
});

test("Karte, die genau an der Grenze endet, wird in get_call_result und check_inbox wie heute auf 200 Zeichen gekürzt und als ****1111 gezeigt", async () => {
  const gekuerzt = KARTE_ENDET_AN_DER_GRENZE.text.slice(0, GRENZE);
  assert.ok(gekuerzt.endsWith(KARTENWORT + VISA_GRUPPIERT));
  await beideAusgabenWie(KARTE_ENDET_AN_DER_GRENZE, gekuerzt.replace(VISA_GRUPPIERT, "****1111"));
});
