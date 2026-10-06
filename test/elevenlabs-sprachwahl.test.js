import assert from "node:assert/strict";
import { test } from "node:test";

import { tenantGeoForCountry } from "../src/geo/resolve.js";
import { LOCALES, localeFor } from "../src/i18n/locales.js";
import { resolveCallLanguage } from "../src/store/state-ops.js";
import { elevenLabsVoiceIdFor } from "../src/telephony/adapters/telnyx/elevenlabs-voice.js";

const OWNER_NAME = "Owen Barrett";

const PLATFORM_VOICE_ID = "plattform-stimme-test";

const TENANT_DE = "tenant-herkunft-de";
const TENANT_FR = "tenant-einstellung-fr";
const TENANT_OHNE_SPRACHE = "tenant-ohne-sprache";

const VOICE_PROFILE_DE = "de-female-neural";
const VOICE_PROFILE_FR = "fr-female-neural";
const VOICE_PROFILE_EN = "en-female-neural";
const VOICE_ID_DE = "cqPdIo76zSHFDcSZpFov";
const VOICE_ID_FR = "WeAAwKYcS06VmXw086yZ";
const VOICE_ID_EN = "ZSNL4hPqCnqoMPaI4jGX";

const CASES = Object.freeze([
  {
    name: "Herkunft Deutschland, keine eigene Spracheinstellung",
    tenantId: TENANT_DE,
    stateOf: () => ({
      tenants: [{ id: TENANT_DE, ...tenantGeoForCountry("DE") }],
      settings: {},
    }),
    language: "de",
    voiceProfile: VOICE_PROFILE_DE,
    voiceId: VOICE_ID_DE,
    disclosureStart: "Guten Tag,",
  },
  {
    name: "Spracheinstellung Franzoesisch schlaegt die Herkunft",
    tenantId: TENANT_FR,
    stateOf: () => ({
      tenants: [{ id: TENANT_FR, ...tenantGeoForCountry("US") }],
      settings: { [TENANT_FR]: { language: "fr" } },
    }),
    language: "fr",
    voiceProfile: VOICE_PROFILE_FR,
    voiceId: VOICE_ID_FR,
    disclosureStart: "Bonjour,",
  },
  {
    name: "keine Sprache gesetzt",
    tenantId: TENANT_OHNE_SPRACHE,
    stateOf: () => ({ tenants: [{ id: TENANT_OHNE_SPRACHE }], settings: {} }),
    language: "en",
    voiceProfile: VOICE_PROFILE_EN,
    voiceId: VOICE_ID_EN,
    disclosureStart: "Hello,",
  },
]);

const bestandsSpracheFor = (kase) =>
  resolveCallLanguage(kase.stateOf(), { tenantId: kase.tenantId, numberRecord: null });

const disclosureFor = (language) => LOCALES[language].disclosure(OWNER_NAME);

function alleZweierPaare(liste) {
  const paare = [];
  for (let idx = 0; idx < liste.length; idx += 1)
    for (let jdx = idx + 1; jdx < liste.length; jdx += 1) paare.push([liste[idx], liste[jdx]]);
  return paare;
}

function assertUnterscheidbar(werteJeFall, merkmal) {
  for (const [links, rechts] of alleZweierPaare(werteJeFall))
    assert.notEqual(
      links.wert,
      rechts.wert,
      `${merkmal} von "${links.name}" und "${rechts.name}" ist derselbe Wert - ` +
        "die Faelle waeren nicht unterscheidbar und jede Pruefung darunter waere blind.",
    );
}

const merkmalJeFall = (lies) => CASES.map((kase) => ({ name: kase.name, wert: lies(kase) }));

test("Bestandspfad Sprachwahl: Herkunft und Spracheinstellung des Nutzers bestimmen Sprache, Stimme und Offenlegungssatz", () => {
  for (const kase of CASES) {
    const language = bestandsSpracheFor(kase);
    assert.equal(language, kase.language, `aufgeloeste Sprache im Fall "${kase.name}"`);

    const locale = localeFor(language);
    assert.equal(locale.voiceProfile, kase.voiceProfile, `Stimmprofil im Fall "${kase.name}"`);
    assert.equal(
      elevenLabsVoiceIdFor(PLATFORM_VOICE_ID, locale.voiceProfile),
      kase.voiceId,
      `ElevenLabs-Stimme im Fall "${kase.name}"`,
    );

    const disclosure = disclosureFor(language);
    assert.ok(
      disclosure.startsWith(kase.disclosureStart),
      `Offenlegungssatz im Fall "${kase.name}" beginnt mit "${kase.disclosureStart}" - ` +
        `er ist in der Sprache des Nutzers, nicht in einer anderen (bekommen: "${disclosure}")`,
    );
    assert.ok(
      disclosure.includes(OWNER_NAME),
      `Offenlegungssatz im Fall "${kase.name}" nennt den Auftraggeber (Artikel 50 EU AI Act)`,
    );
  }

  assertUnterscheidbar(merkmalJeFall(bestandsSpracheFor), "die Sprache");
  assertUnterscheidbar(
    merkmalJeFall((kase) => elevenLabsVoiceIdFor(PLATFORM_VOICE_ID, kase.voiceProfile)),
    "die ElevenLabs-Stimme",
  );
  assertUnterscheidbar(
    merkmalJeFall((kase) => disclosureFor(kase.language)),
    "der Offenlegungssatz",
  );
});

const SEAM = Object.freeze({
  module: "../src/elevenlabs/call-locale.js",
  export: "callLocaleFor",
});

async function callLocaleSeam() {
  let module;
  try {
    module = await import(SEAM.module);
  } catch {
    module = null;
  }
  const resolve = module?.[SEAM.export];
  assert.equal(
    typeof resolve,
    "function",
    `NOCH NICHT GEBAUT: ${SEAM.module} exportiert ${SEAM.export}(state, ` +
      "{ tenantId, numberRecord, ownerName, defaultVoiceId }) nicht. Solange es die Naht " +
      "nicht gibt, spricht der ElevenLabs-Anrufstart fuer JEDEN Nutzer englisch: " +
      "agent.language ist der Fixwert 'en', die Stimme kommt aus dem Dashboard, und der " +
      "Offenlegungs-Ausdruck steht fest in src/elevenlabs/outbound.js.",
  );
  return resolve;
}

test("[abgenommen G2] der ElevenLabs-Anrufstart spricht die Sprache des Nutzers - Deutsch mit deutscher Stimme und deutschem Offenlegungssatz fuer einen deutschen Nutzer, Franzoesisch analog, Englisch fuer jeden ohne gesetzte Sprache", async () => {
  for (const kase of CASES)
    assert.equal(bestandsSpracheFor(kase), kase.language, `Bestands-Aufloesung "${kase.name}"`);
  assertUnterscheidbar(
    merkmalJeFall((kase) => elevenLabsVoiceIdFor(PLATFORM_VOICE_ID, kase.voiceProfile)),
    "die ElevenLabs-Stimme",
  );
  assertUnterscheidbar(
    merkmalJeFall((kase) => disclosureFor(kase.language)),
    "der Offenlegungssatz",
  );

  const resolveLocale = await callLocaleSeam();
  for (const kase of CASES) {
    const gewaehlt = resolveLocale(kase.stateOf(), {
      tenantId: kase.tenantId,
      numberRecord: null,
      ownerName: OWNER_NAME,
      defaultVoiceId: PLATFORM_VOICE_ID,
    });
    assert.equal(
      gewaehlt?.language,
      kase.language,
      `Fall "${kase.name}": der Agent bekommt die Sprache des Nutzers - sonst hoert ein ` +
        "deutscher Nutzer einen englischen Agenten (und ein US-Nutzer einen deutschen).",
    );
    assert.equal(
      gewaehlt?.voiceId,
      kase.voiceId,
      `Fall "${kase.name}": die Stimme folgt der Sprache (dieselbe Aufloesung wie der ` +
        "Bestandspfad, elevenLabsVoiceIdFor) - sonst spricht der Agent Deutsch mit " +
        "amerikanischer Stimme.",
    );
    assert.ok(
      gewaehlt?.firstMessage?.startsWith(disclosureFor(kase.language)),
      `Fall "${kase.name}": der Offenlegungssatz kommt WOERTLICH aus ` +
        "LOCALES.<sprache>.disclosure und steht am ANFANG (Regel 2, Artikel 50 EU AI " +
        `Act) - keine am Anbieter erzeugte Uebersetzung, keine zweite Fassung. Bekommen: "${gewaehlt?.firstMessage}"`,
    );
  }
});

const ZIEL_DE = "+491737252163";
const ZIEL_NANP = "+18643028341";

test("Sprachwahl EL: die Sprache des ANGERUFENEN gewinnt, wenn seine Nummer sie belegt - sonst gilt die Auftraggeber-Kette unveraendert", async () => {
  const resolveLocale = await callLocaleSeam();
  const kase = CASES.find((fall) => fall.language === "fr");
  const locale = (to) =>
    resolveLocale(kase.stateOf(), {
      tenantId: kase.tenantId,
      numberRecord: null,
      ownerName: OWNER_NAME,
      defaultVoiceId: PLATFORM_VOICE_ID,
      to,
    });

  assert.equal(
    locale(ZIEL_DE).language,
    kase.language,
    "die GESPRAECHSSPRACHE folgt seit F-2 dem Auftraggeber, nicht mehr dem Land des " +
      "Angerufenen - das ist die von F-2 Punkt 2 verlangte Umkehrung",
  );
  assert.equal(
    locale(ZIEL_DE).disclosureLanguage,
    "de",
    "die OFFENLEGUNGSSPRACHE bleibt byte-identisch die Sprache des Angerufenen (E-2)",
  );
  assert.ok(
    locale(ZIEL_DE).firstMessage.startsWith(disclosureFor("de")),
    "der Offenlegungssatz folgt weiterhin dem Angerufenen und steht am Anfang der " +
      "Eroeffnung - er muss vom Angerufenen VERSTANDEN werden (Artikel 50 EU AI Act)",
  );

  assert.equal(
    locale(ZIEL_NANP).language,
    kase.language,
    "+1 teilen 25 Laender: das Land ist NICHT belegbar, also bleibt es bei der " +
      "Auftraggeber-Kette statt bei einer geratenen Sprache",
  );
  assert.equal(
    locale(undefined).language,
    kase.language,
    "ohne Ziel bleibt alles wie vorher - der Bestandsaufruf ohne 'to' ist unveraendert",
  );
});
