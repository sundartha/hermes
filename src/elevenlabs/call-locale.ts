import { LANGUAGE_FOR_COUNTRY, localeFor } from "../i18n/locales.js";
import { countryForE164 } from "../begriffe/rufnummern.js";
import { resolveCallLanguage } from "../store/state-ops.js";
import { elevenLabsVoiceIdFor } from "../telephony/adapters/telnyx/elevenlabs-voice.ts";

interface Sprachwahl {
  language: string;
  voiceProfile: string;
  disclosure: (ownerName: string) => string;
  voicemailBody: (openingLine: string) => string;
  disclosureOwnerFallback: string;
}

interface AnrufSprache {
  language: string;
  disclosureLanguage: string;
  voiceId: string;
  firstMessage: string;
  disclosureOwnerFallback: string;
}

interface Zugriff {
  tenantId: string;
  numberRecord: unknown;
}

const aufgeloesteSprache: (state: unknown, zugriff: Zugriff) => string = resolveCallLanguage;
const sprachwahlFuer: (language: string) => Sprachwahl = localeFor;

const SPRACHE_JE_LAND: Readonly<Record<string, string>> = LANGUAGE_FOR_COUNTRY;

function calleeLanguage(to: string): string | null {
  const land = countryForE164(to);
  return (land && SPRACHE_JE_LAND[land]) ?? null;
}

function conversationLanguageOf(state: unknown, { tenantId, numberRecord, callLanguage }: Zugriff & { callLanguage?: string | undefined }): string {
  if (callLanguage) return callLanguage;
  return aufgeloesteSprache(state, { tenantId, numberRecord });
}

function disclosureLanguageOf(state: unknown, { tenantId, numberRecord, to }: Zugriff & { to: string }): string {
  return calleeLanguage(to) ?? aufgeloesteSprache(state, { tenantId, numberRecord });
}

const OPENING_LINE_PLACEHOLDER = "{{opening_line}}";

const EROEFFNUNG_PLATZHALTER = "{{eroeffnung}}";

const providerDisclosureFirst = (locale: Sprachwahl, ownerName: string): string =>
  [locale.disclosure(ownerName), OPENING_LINE_PLACEHOLDER].join(" ");

export function providerVoicemailMessage({ locale, ownerName, openingLine }: { locale: Sprachwahl; ownerName: string; openingLine: string }): string {
  return [locale.disclosure(ownerName), locale.voicemailBody(openingLine)].join(" ");
}

export function callLocaleFor(
  state: unknown,
  { tenantId, numberRecord, ownerName, defaultVoiceId, to, callLanguage }: Zugriff & { ownerName: string; defaultVoiceId: string; to: string; callLanguage?: string | undefined },
): AnrufSprache {
  const gespraech = sprachwahlFuer(conversationLanguageOf(state, { tenantId, numberRecord, callLanguage }));
  const offenlegung = sprachwahlFuer(disclosureLanguageOf(state, { tenantId, numberRecord, to }));
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
