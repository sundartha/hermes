import { test } from "node:test";
import assert from "node:assert/strict";
import { seedState } from "../helpers.js";
import { makeThinkingSignal, THINKING_SIGNAL_MAX_CHARS } from "../../src/thinking-signal.js";
import { shapeForSpeech } from "../../src/speech-shape.js";
import {
  abgeschlossenerAnruf,
  einzeln,
  fuelltext,
  geheimnisseAnDerGrenze,
  ausgabezeilen,
  ohneMasken,
  starteServer,
  stellen,
  textMitAngabeAb,
} from "./kartenmaskierung.js";

const KLARTEXT_FEHLER = "Kartenziffern im gekürzten Brückensatz im Klartext";
const ANGABE_FEHLER = "Angabe im gekürzten Brückensatz im Klartext";
const KUERZUNG_FEHLER = "Brückensatz anders gekürzt als heute";

const AGENT_PRAEFIX = "Agent: ";
const KARTENWORT = "Karte ";
const VISA_GRUPPIERT = "4111 1111 1111 1111";
const VISA_ZIFFERN = "4111111111111111";
const NACHTEXT = " und danach prüfe ich gleich noch den Termin am Montag für dich.";

const ZIFFERNWEISE_FORMEN = [
  einzeln(VISA_ZIFFERN),
  VISA_ZIFFERN.match(/.{4}/g)
    .map((block) => einzeln(block))
    .join(", "),
  einzeln(VISA_ZIFFERN, " - "),
  einzeln(VISA_ZIFFERN, "_"),
  einzeln(VISA_ZIFFERN),
  einzeln(VISA_ZIFFERN, "\t"),
];

function satzMitAngabeAb(stelle, angabe, nachtext = NACHTEXT) {
  return textMitAngabeAb(stelle, angabe, nachtext);
}

function gesprochenerBrueckensatz(text) {
  const gesprochen = [];
  const signal = makeThinkingSignal({
    onSpeechChunk: (teil) => gesprochen.push(teil),
    enabled: true,
  });
  const transkript = shapeForSpeech(signal.speakBridge(text));
  return { gesprochen, transkript };
}

const ANRUFE = [];

function anrufMitBrueckensatz(text) {
  const id = "call_brueckensatz_" + "x".repeat(ANRUFE.length + 1);
  const { gesprochen, transkript } = gesprochenerBrueckensatz(text);
  ANRUFE.push(
    abgeschlossenerAnruf({
      id,
      direction: "outbound",
      transcript: [
        { role: "caller", text: "Hallo, hier ist die Praxis.", at: new Date().toISOString() },
        { role: "agent", text: transkript, at: new Date().toISOString() },
      ],
    }),
  );
  return { id, text, gesprochen };
}

const KARTE_AN_DER_GRENZE = stellen(90, 119).map((stelle) =>
  anrufMitBrueckensatz(satzMitAngabeAb(stelle - KARTENWORT.length, KARTENWORT + VISA_GRUPPIERT)),
);

const ZIFFERNWEISE_AN_DER_GRENZE = ZIFFERNWEISE_FORMEN.flatMap((form) =>
  stellen(90, 119).map((stelle) =>
    anrufMitBrueckensatz(satzMitAngabeAb(stelle - KARTENWORT.length, KARTENWORT + form)),
  ),
);

const GEHEIMNIS_AN_DER_GRENZE = geheimnisseAnDerGrenze(110, 119, (stelle, angabe) =>
  anrufMitBrueckensatz(satzMitAngabeAb(stelle, angabe)),
);

const OHNE_ANGABE = anrufMitBrueckensatz(
  "  " + satzMitAngabeAb(70, "Termin am 12. Mai um 14 Uhr in der Filiale am Markt ist noch frei"),
);

const KARTE_FRUEH = anrufMitBrueckensatz(
  satzMitAngabeAb(10, KARTENWORT + VISA_GRUPPIERT, NACHTEXT.repeat(3)),
);

const SATZ_UNTER_DER_GRENZE = fuelltext(THINKING_SIGNAL_MAX_CHARS - 9) + "Montag.";

const LEERRAUM_VOR_KURZEM_SATZ = anrufMitBrueckensatz("     " + SATZ_UNTER_DER_GRENZE);

const srv = starteServer(() => ({
  env: { THINKING_SIGNAL_ENABLED: "true" },
  seed: seedState({ calls: ANRUFE }),
}));

async function agentZeile(anruf) {
  const zeilen = await ausgabezeilen(srv, anruf.id);
  assert.equal(zeilen.length, 2);
  return zeilen[1];
}

function anWortgrenzeGekuerzt(text) {
  const schnitt = text.slice(0, THINKING_SIGNAL_MAX_CHARS);
  return schnitt.slice(0, schnitt.lastIndexOf(" ")) + ".";
}

function pruefeKeineZiffernAusserMaske(zeile, meldung) {
  assert.ok(zeile.startsWith(AGENT_PRAEFIX), meldung);
  assert.ok(!/\d/.test(ohneMasken(zeile)), meldung);
}

test("Karte im Brückensatz, die an den Stellen 90 bis 119 beginnt, zeigt in get_call_status höchstens die letzten vier Ziffern hinter ****", async () => {
  for (const anruf of KARTE_AN_DER_GRENZE) {
    pruefeKeineZiffernAusserMaske(await agentZeile(anruf), KLARTEXT_FEHLER);
  }
});

test("Ziffernweise Karte im Brückensatz an der Grenze zeigt in get_call_status höchstens die letzten vier Ziffern hinter ****", async () => {
  for (const anruf of ZIFFERNWEISE_AN_DER_GRENZE) {
    pruefeKeineZiffernAusserMaske(await agentZeile(anruf), KLARTEXT_FEHLER);
  }
});

test("PIN und Passwort im Brückensatz an den Stellen 110 bis 119 zeigen in get_call_status keinen Teil des Werts", async () => {
  for (const anruf of GEHEIMNIS_AN_DER_GRENZE) {
    const zeile = await agentZeile(anruf);
    assert.ok(!zeile.includes(anruf.kennwort + anruf.wert[0]), ANGABE_FEHLER);
    assert.ok(!zeile.includes(anruf.wert.slice(0, 2)), ANGABE_FEHLER);
    assert.ok(!/\d/.test(ohneMasken(zeile)), ANGABE_FEHLER);
  }
});

test("Brückensatz ohne erkannte Angabe wird genau wie heute an der Wortgrenze gekürzt gesprochen und ins Transkript geschrieben", async () => {
  const erwartet = anWortgrenzeGekuerzt(OHNE_ANGABE.text.trim());
  assert.ok(erwartet.length > THINKING_SIGNAL_MAX_CHARS - 10);
  assert.deepEqual(OHNE_ANGABE.gesprochen, [erwartet + " "], KUERZUNG_FEHLER);
  assert.equal(await agentZeile(OHNE_ANGABE), AGENT_PRAEFIX + erwartet, KUERZUNG_FEHLER);
});

test("Leerraum vor einem Brückensatz unter der Grenze zählt nicht mit, der Satz wird ganz gesprochen und ins Transkript geschrieben", async () => {
  assert.equal(SATZ_UNTER_DER_GRENZE.length, THINKING_SIGNAL_MAX_CHARS - 2);
  assert.deepEqual(
    LEERRAUM_VOR_KURZEM_SATZ.gesprochen,
    [SATZ_UNTER_DER_GRENZE + " "],
    KUERZUNG_FEHLER,
  );
  assert.equal(
    await agentZeile(LEERRAUM_VOR_KURZEM_SATZ),
    AGENT_PRAEFIX + SATZ_UNTER_DER_GRENZE,
    KUERZUNG_FEHLER,
  );
});

test("Karte früh im Brückensatz wird wie heute an der Wortgrenze gekürzt und in get_call_status als ****1111 gezeigt", async () => {
  const erwartet = anWortgrenzeGekuerzt(KARTE_FRUEH.text).replace(VISA_GRUPPIERT, "****1111");
  assert.ok(erwartet.length > THINKING_SIGNAL_MAX_CHARS - 30);
  assert.equal(await agentZeile(KARTE_FRUEH), AGENT_PRAEFIX + erwartet, KUERZUNG_FEHLER);
});
