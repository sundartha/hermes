// ---- DE1: der Anrufbeantworter-Text spricht die Sprache des Anrufs -------------------
// Vorfall 2026-09-04 (call_mtmpqje4clmh / conv_4501m1nsr1hhe2aa07pt5t38r0zy): ein
// deutscher Anruf hinterliess eine ENGLISCHE Nachricht auf dem Anrufbeantworter, weil das
// Feld voicemail_message am Agenten statischen englischen Text trug und weder je Sprache
// (language_presets) noch je Anruf (conversation_config_override) uebersteuerbar ist
// (Anbieter-Schema, 2026-09-04 gemessen - beide Pfade fuehren kein built_in_tools). Der
// tragfaehige Weg ist die dynamische Variable {{voicemail_line}}, komponiert in
// src/elevenlabs/call-locale.js#providerVoicemailMessage aus LOCALES.<sprache>.disclosure
// + LOCALES.<sprache>.voicemailBody.
//
// Faehrt den ECHTEN Anrufstart gegen die Bestands-Attrappe (PIN_STATE traegt
// defaultLanguage "de", pinCall().to loest ueber die Ziel-Rufnummer ebenfalls auf "de"
// auf - kein neuer Fixture-Zustand noetig, s. test/el-vorlage-variablen-abgleich.test.js
// fuer dieselbe Attrappe).
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (package.json
// config.i18nCatalogPattern / config.abnahmePattern), sonst landen sie in der falschen
// Bank (Lehre catalog-id-prefix-misroutes-tests). Das Verhalten muss ab sofort dauerhaft
// gelten, gehoert also in den Regressionslauf.
import assert from "node:assert/strict";
import test from "node:test";

import { providerVoicemailMessage } from "../src/elevenlabs/call-locale.js";
import { consultAllowedFor } from "../src/consult/gate.js";
import { LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { makeElevenLabsOutbound } from "../src/elevenlabs/outbound.js";

import { sendeAnrufstart } from "./helpers/elevenlabs-anrufstart-attrappe.mjs";

const OWNER_NAME = "Pin Testowner";

// Nur ANFAENGE als Baustein - genug, um festzustellen, dass der englische Text NICHT
// eingeflossen ist, ohne von einer zufaelligen Teilstring-Ueberschneidung mit den
// anderen Sprachen abhaengig zu sein.
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
  const variablen = await sendeAnrufstart({ makeElevenLabsOutbound, consultAllowedFor });

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
