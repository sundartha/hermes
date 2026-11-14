import { LANGUAGE_FOR_COUNTRY, localeFor } from "../i18n/locales.js";
import { countryForE164 } from "../begriffe/rufnummern.js";
import { resolveCallLanguage } from "../store/state-ops.js";
import { elevenLabsVoiceIdFor } from "../telephony/adapters/telnyx/elevenlabs-voice.ts";

function calleeLanguage(to) {
  const land = countryForE164(to);
  return (land && LANGUAGE_FOR_COUNTRY[land]) ?? null;
}

function conversationLanguageOf(state, { tenantId, numberRecord, callLanguage }) {
  return callLanguage || resolveCallLanguage(state, { tenantId, numberRecord });
}

function disclosureLanguageOf(state, { tenantId, numberRecord, to }) {
  return calleeLanguage(to) ?? resolveCallLanguage(state, { tenantId, numberRecord });
}

const OPENING_LINE_PLACEHOLDER = "{{opening_line}}";

const EROEFFNUNG_PLATZHALTER = "{{eroeffnung}}";

const providerDisclosureFirst = (locale, ownerName) =>
  [locale.disclosure(ownerName), OPENING_LINE_PLACEHOLDER].join(" ");

export function providerVoicemailMessage({ locale, ownerName, openingLine }) {
  return [locale.disclosure(ownerName), locale.voicemailBody(openingLine)].join(" ");
}

export function callLocaleFor(
  state,
  { tenantId, numberRecord, ownerName, defaultVoiceId, to, callLanguage },
) {
  const gespraech = localeFor(conversationLanguageOf(state, { tenantId, numberRecord, callLanguage }));
  const offenlegung = localeFor(disclosureLanguageOf(state, { tenantId, numberRecord, to }));
  return {
    language: gespraech.language,
    disclosureLanguage: offenlegung.language,
    voiceId: elevenLabsVoiceIdFor(defaultVoiceId, gespraech.voiceProfile),
    firstMessage:
      gespraech.language === offenlegung.language
        ? EROEFFNUNG_PLATZHALTER
        : providerDisclosureFirst(offenlegung, ownerName),
    disclosureOwnerFallback: offenlegung.disclosureOwnerFallback,
  };
}
