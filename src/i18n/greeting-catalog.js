import { LOCALES, localeFor } from "./locales.ts";
import { withInboundNotice } from "./inbound-notice.ts";

function standardVorlage(locale) {
  return withInboundNotice(locale.greetingDefault, locale.inboundNotice);
}

function buildTemplates(locale) {
  return Object.freeze([
    standardVorlage(locale),
    ...locale.greetingVariants.map((t) => withInboundNotice(t, locale.inboundNotice)),
  ]);
}

const GREETING_DEFAULT_BY_LANGUAGE = Object.freeze({
  de: standardVorlage(LOCALES.de),
  fr: standardVorlage(LOCALES.fr),
  en: standardVorlage(LOCALES.en),
});

const GREETING_TEMPLATES_BY_LANGUAGE = Object.freeze({
  de: buildTemplates(LOCALES.de),
  fr: buildTemplates(LOCALES.fr),
  en: buildTemplates(LOCALES.en),
});

export function greetingTemplatesFor(language) {
  return GREETING_TEMPLATES_BY_LANGUAGE[localeFor(language).language];
}

export const ALL_GREETING_TEMPLATES = Object.freeze(
  Object.values(GREETING_TEMPLATES_BY_LANGUAGE).flat(),
);

const DE_VARIANTEN = LOCALES.de.greetingVariants;

const HISTORISCHE_DE_ROHFASSUNGEN = Object.freeze([
  Object.freeze({
    alt: "Hallo, hier ist der KI-Assistent von {owner}. {owner} kann gerade nicht ans Telefon. Ich kann eine Nachricht fuer {owner} aufnehmen. Wie kann ich helfen?",
    ziel: LOCALES.de.greetingDefault,
  }),
  ...DE_VARIANTEN.slice(0, 1).map((ziel) =>
    Object.freeze({
      alt: "Guten Tag, Sie sprechen mit dem KI-Assistenten von {owner}. Ich nehme Ihre Nachricht fuer {owner} auf. Wie kann ich helfen?",
      ziel,
    }),
  ),
]);

const GREETING_ORTHOGRAPHY_MIGRATION = Object.freeze(
  Object.assign(
    Object.create(null),
    Object.fromEntries(
      HISTORISCHE_DE_ROHFASSUNGEN.map(({ alt, ziel }) => [
        withInboundNotice(alt, LOCALES.de.inboundNotice),
        withInboundNotice(ziel, LOCALES.de.inboundNotice),
      ]),
    ),
  ),
);

export function greetingWithCurrentOrthography(storedGreeting) {
  return GREETING_ORTHOGRAPHY_MIGRATION[storedGreeting] ?? storedGreeting;
}

export function greetingForLanguage(storedGreeting, language) {
  const greeting = greetingWithCurrentOrthography(storedGreeting);
  const templates = greetingTemplatesFor(language);
  if (templates.includes(greeting)) return greeting;
  return ALL_GREETING_TEMPLATES.includes(greeting)
    ? GREETING_DEFAULT_BY_LANGUAGE[localeFor(language).language]
    : greeting;
}

export function gespeicherteBegruessungFuer({ storedGreeting, language, ownerName }) {
  if (typeof storedGreeting !== "string")
    throw new TypeError("gespeicherteBegruessungFuer: storedGreeting muss ein String sein, replaceAll braucht Text");
  return greetingForLanguage(storedGreeting, language).replaceAll("{owner}", ownerName);
}
