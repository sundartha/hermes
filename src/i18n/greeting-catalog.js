import { LOCALES, SUPPORTED_LANGUAGES, localeFor } from "./locales.js";
import { withInboundNotice } from "./inbound-notice.js";

function buildTemplates(locale) {
  return Object.freeze(
    [locale.greetingDefault, ...locale.greetingVariants].map((t) =>
      withInboundNotice(t, locale.inboundNotice),
    ),
  );
}

const GREETING_TEMPLATES_BY_LANGUAGE = Object.freeze(
  Object.fromEntries(SUPPORTED_LANGUAGES.map((lang) => [lang, buildTemplates(LOCALES[lang])])),
);

export function greetingTemplatesFor(language) {
  return GREETING_TEMPLATES_BY_LANGUAGE[localeFor(language).language];
}

export const ALL_GREETING_TEMPLATES = Object.freeze(
  Object.values(GREETING_TEMPLATES_BY_LANGUAGE).flat(),
);

const HISTORISCHE_DE_ROHFASSUNGEN = Object.freeze([
  Object.freeze({
    alt: "Hallo, hier ist der KI-Assistent von {owner}. {owner} kann gerade nicht ans Telefon. Ich kann eine Nachricht fuer {owner} aufnehmen. Wie kann ich helfen?",
    ziel: LOCALES.de.greetingDefault,
  }),
  Object.freeze({
    alt: "Guten Tag, Sie sprechen mit dem KI-Assistenten von {owner}. Ich nehme Ihre Nachricht fuer {owner} auf. Wie kann ich helfen?",
    ziel: LOCALES.de.greetingVariants[0],
  }),
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
  return ALL_GREETING_TEMPLATES.includes(greeting) ? templates[0] : greeting;
}

export function gespeicherteBegruessungFuer({ storedGreeting, language, ownerName }) {
  if (typeof storedGreeting !== "string")
    throw new TypeError("gespeicherteBegruessungFuer: storedGreeting muss ein String sein, replaceAll braucht Text");
  return greetingForLanguage(storedGreeting, language).replaceAll("{owner}", ownerName);
}
