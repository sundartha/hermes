import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, mcpPost, toolCall, readToolResult, seedState, seedCall } from "../helpers.js";
import { sanitizeConsultQuestion } from "../../src/consult/question.js";
import { PASSWORT_BEISPIEL } from "./erfundene-geheimnisse.js";

const KLARTEXT_FEHLER = "Kartenziffern in der gekürzten Rückfrage im Klartext";
const ANGABE_FEHLER = "Angabe in der gekürzten Rückfrage im Klartext";
const KUERZUNG_FEHLER = "Rückfrage anders gekürzt als heute";

const GRENZE = 200;
const KARTENWORT = "Karte ";
const VISA_GRUPPIERT = "4111 1111 1111 1111";
const VISA_ZIFFERN = "4111111111111111";
const VISA_ZIFFERNWEISE = VISA_ZIFFERN.split("").join(" ");
const STEUER_ID_KENNWORT = "Steuer-ID ";
const STEUER_ID = "12 345 678 901";
const REISEPASS_KENNWORT = "Reisepassnummer ";
const REISEPASS = "123 456 789";
const PIN = "PIN: 4711";
const PASSWORT_KENNWORT = "password: ";
const NACHTEXT =
  " und danach haben wir den Termin am Montag besprochen und alles Weitere freundlich geklärt.";
const ZITIERTE_ANRUFERZEILE = "Ich möchte den Termin am Montag gern auf Dienstag verschieben bitte";

const MASKEN = /\*{4}\d{0,4}|\[restricted-credential\]|\[restricted-government-id\]/g;

function fuelltext(laenge) {
  let text = "";
  while (laenge - text.length >= 9) text += "Termin ";
  return text + "a".repeat(laenge - text.length - 1) + " ";
}

function frageMitAngabeAb(stelle, angabe, nachtext = NACHTEXT) {
  return fuelltext(stelle) + angabe + nachtext;
}

function stellen(von, bis) {
  return Array.from({ length: bis - von + 1 }, (_, index) => von + index);
}

function anWortgrenzeGekuerzt(text) {
  const schnitt = text.slice(0, GRENZE);
  return schnitt.slice(0, schnitt.lastIndexOf(" "));
}

const ANRUFE = [];

function anrufMitRueckfrage(text) {
  const id = "call_rueckfrage_" + "x".repeat(ANRUFE.length + 1);
  const frage = sanitizeConsultQuestion(text, []);
  ANRUFE.push(
    seedCall({
      id,
      direction: "outbound",
      status: "dialing",
      consults: [
        {
          id: "c0",
          seq: 0,
          questions: [frage],
          status: "open",
          askedAt: new Date().toISOString(),
          answeredAt: null,
          answeredFacts: 0,
        },
      ],
    }),
  );
  return { id, text };
}

const KARTE_AN_DER_GRENZE = stellen(170, 199).map((stelle) =>
  anrufMitRueckfrage(frageMitAngabeAb(stelle - KARTENWORT.length, KARTENWORT + VISA_GRUPPIERT)),
);

const ZIFFERNWEISE_AN_DER_GRENZE = stellen(170, 199).map((stelle) =>
  anrufMitRueckfrage(frageMitAngabeAb(stelle - KARTENWORT.length, KARTENWORT + VISA_ZIFFERNWEISE)),
);

const AUSWEIS_AN_DER_GRENZE = [
  { kennwort: STEUER_ID_KENNWORT, nummer: STEUER_ID },
  { kennwort: REISEPASS_KENNWORT, nummer: REISEPASS },
].flatMap(({ kennwort, nummer }) =>
  stellen(170, 199).map((stelle) =>
    anrufMitRueckfrage(frageMitAngabeAb(stelle - kennwort.length, kennwort + nummer)),
  ),
);

const PASSWORT = PASSWORT_KENNWORT + PASSWORT_BEISPIEL;
const GEHEIMNISSE = [
  { angabe: PIN, kennwort: "PIN: ", wert: "4711" },
  { angabe: PASSWORT, kennwort: PASSWORT_KENNWORT, wert: PASSWORT_BEISPIEL },
];
const GEHEIMNIS_AN_DER_GRENZE = GEHEIMNISSE.flatMap((geheimnis) =>
  stellen(190, 199).flatMap((stelle) => [
    { ...geheimnis, ...anrufMitRueckfrage(frageMitAngabeAb(stelle, geheimnis.angabe)) },
    {
      ...geheimnis,
      ...anrufMitRueckfrage(frageMitAngabeAb(stelle - geheimnis.kennwort.length, geheimnis.angabe)),
    },
  ]),
);

const OHNE_ANGABE = anrufMitRueckfrage(
  "  " + frageMitAngabeAb(150, "Termin am 12. Mai um 14 Uhr in der Filiale am Markt bestätigt"),
);

const KARTE_FRUEH = anrufMitRueckfrage(
  frageMitAngabeAb(10, KARTENWORT + VISA_GRUPPIERT, NACHTEXT.repeat(3)),
);

let srv;

before(async () => {
  srv = await startServer({
    env: { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" },
    seed: seedState({ calls: ANRUFE }),
  });
});

after(async () => {
  await srv.stop();
});

async function rueckfragen(anruf) {
  const result = await readToolResult(
    await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("await_call_event", { call_id: anruf.id })),
  );
  assert.equal(result.structuredContent.event, "consult");
  return result.structuredContent.questions;
}

function ohneMasken(text) {
  return text.replace(MASKEN, "");
}

function pruefeKeineZiffernAusserMaske(fragen, meldung) {
  assert.equal(fragen.length, 1);
  for (const frage of fragen) assert.ok(!/\d/.test(ohneMasken(frage)), meldung);
}

test("Karte, die an den Stellen 170 bis 199 beginnt, zeigt in await_call_event höchstens die letzten vier Ziffern hinter ****", async () => {
  for (const anruf of KARTE_AN_DER_GRENZE) {
    pruefeKeineZiffernAusserMaske(await rueckfragen(anruf), KLARTEXT_FEHLER);
  }
});

test("Ziffernweise Karte an der Grenze zeigt in await_call_event höchstens die letzten vier Ziffern hinter ****", async () => {
  for (const anruf of ZIFFERNWEISE_AN_DER_GRENZE) {
    pruefeKeineZiffernAusserMaske(await rueckfragen(anruf), KLARTEXT_FEHLER);
  }
});

test("Steuer-ID und Reisepassnummer hinter ihrem Kennwort an der Grenze lassen in await_call_event keinen Rest im Klartext", async () => {
  for (const anruf of AUSWEIS_AN_DER_GRENZE) {
    pruefeKeineZiffernAusserMaske(await rueckfragen(anruf), ANGABE_FEHLER);
  }
});

test("PIN und Passwort an den Stellen 190 bis 199 zeigen in await_call_event keinen Teil des Werts", async () => {
  for (const anruf of GEHEIMNIS_AN_DER_GRENZE) {
    for (const frage of await rueckfragen(anruf)) {
      assert.ok(!frage.includes(anruf.kennwort + anruf.wert[0]), ANGABE_FEHLER);
      assert.ok(!/\d/.test(ohneMasken(frage)), ANGABE_FEHLER);
    }
  }
});

test("Rückfrage ohne erkannte Angabe erscheint in await_call_event genau wie heute an der Wortgrenze gekürzt", async () => {
  const erwartet = anWortgrenzeGekuerzt(OHNE_ANGABE.text.trim());
  assert.ok(erwartet.length > GRENZE - 10);
  assert.deepEqual(await rueckfragen(OHNE_ANGABE), [erwartet], KUERZUNG_FEHLER);
});

test("Karte früh in der Rückfrage wird in await_call_event wie heute an der Wortgrenze gekürzt und darin als ****1111 gezeigt", async () => {
  const erwartet = anWortgrenzeGekuerzt(KARTE_FRUEH.text).replace(VISA_GRUPPIERT, "****1111");
  assert.ok(erwartet.length > GRENZE - 30);
  assert.deepEqual(await rueckfragen(KARTE_FRUEH), [erwartet], KUERZUNG_FEHLER);
});

test("Rückfrage, die eine Anruferzeile wörtlich zitiert, wird weiter verworfen, auch mit Karte an der Grenze", () => {
  const transkript = [{ role: "caller", text: ZITIERTE_ANRUFERZEILE }];
  assert.equal(sanitizeConsultQuestion(ZITIERTE_ANRUFERZEILE, transkript), null);
  const mitKarte = frageMitAngabeAb(
    185 - KARTENWORT.length - ZITIERTE_ANRUFERZEILE.length - 1,
    ZITIERTE_ANRUFERZEILE + " " + KARTENWORT + VISA_GRUPPIERT,
  );
  assert.equal(sanitizeConsultQuestion(mitKarte, transkript), null);
  assert.equal(
    sanitizeConsultQuestion("Welcher Tag passt dir am besten?", transkript),
    "Welcher Tag passt dir am besten?",
  );
});

test("Rückfrage, die vor einer Karte an der Grenze gekürzt wird, endet wie heute ohne Leerzeichen", () => {
  for (const stelle of stellen(170, 199)) {
    const text = frageMitAngabeAb(stelle - KARTENWORT.length, KARTENWORT + VISA_GRUPPIERT);
    const frage = sanitizeConsultQuestion(text, []);
    assert.ok(frage.startsWith("Termin Termin"), KUERZUNG_FEHLER);
    assert.equal(frage, frage.trim(), KUERZUNG_FEHLER);
  }
});
