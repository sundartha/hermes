import assert from "node:assert/strict";
import test from "node:test";

import { providerVoicemailMessage } from "../src/elevenlabs/call-locale.js";
import { consultAllowedForCall } from "../src/consult/gate.js";
import { LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";

import { sendeAnrufstart } from "./helpers/elevenlabs-anrufstart-attrappe.mjs";

const OWNER_NAME = "Pin Testowner";

const BAUSTEIN_LAENGE = 20;

function englishBausteine() {
  const disclosure = LOCALES.en.disclosure(OWNER_NAME);
  const voicemailBodyText = LOCALES.en.voicemailBody("x");
  const voicemailBodyAnfang = voicemailBodyText.split("x")[0];
  return [
    disclosure.slice(0, BAUSTEIN_LAENGE),
    voicemailBodyAnfang.slice(0, BAUSTEIN_LAENGE),
  ];
}

test("Voicemail-Sprache: bei Anrufsprache de traegt voicemail_line den DEUTSCHEN Text und keinen englischen Baustein", async () => {
  const variablen = await sendeAnrufstart({ makeElevenLabsOutbound, consultAllowedForCall });

  assert.ok(
    variablen.voicemail_line.startsWith(LOCALES.de.disclosure(OWNER_NAME)),
    "voicemail_line muss byte-identisch mit dem deutschen Offenlegungssatz beginnen (Artikel 50 EU AI Act)",
  );
  assert.ok(
    variablen.voicemail_line.includes(variablen.opening_line),
    "voicemail_line muss dieselbe Grund-Zeile tragen wie opening_line - eine zweite Fassung waere G5",
  );
  for (const baustein of englishBausteine()) {
    assert.ok(
      !variablen.voicemail_line.includes(baustein),
      `voicemail_line enthaelt einen englischen Baustein ("${baustein}") bei Anrufsprache de - genau der Vorfall vom 2026-09-04`,
    );
  }
  assert.ok(
    !variablen.voicemail_line.includes("{{"),
    "voicemail_line darf keinen unaufgeloesten Platzhalter tragen - sonst der 1008-Abbruch",
  );
});

test("Voicemail-Sprache: dieselbe Naht liefert je Sprache einen ANDEREN Text - die drei sind unterscheidbar", () => {
  const openingLine = "Ich rufe wegen einer Terminfrage an.";
  const texte = SUPPORTED_LANGUAGES.map((sprache) =>
    providerVoicemailMessage({ locale: LOCALES[sprache], ownerName: OWNER_NAME, openingLine }),
  );
  assert.equal(
    new Set(texte).size,
    SUPPORTED_LANGUAGES.length,
    "je Sprache muss ein eigener Anrufbeantworter-Text herauskommen, sonst misst Fall 1 nur irgendeinen Text",
  );
});
