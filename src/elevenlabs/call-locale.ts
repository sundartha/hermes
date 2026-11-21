import { LANGUAGE_FOR_COUNTRY, localeFor } from "../i18n/locales.ts";
import { countryForE164 } from "../begriffe/rufnummern.js";
import { resolveCallLanguage } from "../store/state-ops.js";
import { elevenLabsVoiceIdFor } from "../telephony/adapters/telnyx/elevenlabs-voice.ts";

interface Sprachwahl {
  language: string;
  voiceProfile: string;
  disclosure: (ownerName: string | null) => string;
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
  numberRecord: { language?: string | null } | null | undefined;
}

type MandantZustand = Parameters<typeof resolveCallLanguage>[0];
const aufgeloesteSprache: (state: MandantZustand, zugriff: Zugriff) => string = resolveCallLanguage;
const sprachwahlFuer: (language: string) => Sprachwahl = localeFor;

const SPRACHE_JE_LAND: Readonly<Record<string, string>> = LANGUAGE_FOR_COUNTRY;

function calleeLanguage(to: string | null): string | null {
  const land = countryForE164(to);
  return (land && SPRACHE_JE_LAND[land]) ?? null;
}

function conversationLanguageOf(state: MandantZustand, { tenantId, numberRecord, callLanguage }: Zugriff & { callLanguage?: string | undefined }): string {
  if (callLanguage) return callLanguage;
  return aufgeloesteSprache(state, { tenantId, numberRecord });
}

function disclosureLanguageOf(state: MandantZustand, { tenantId, numberRecord, to }: Zugriff & { to: string | null }): string {
  return calleeLanguage(to) ?? aufgeloesteSprache(state, { tenantId, numberRecord });
}

const OPENING_LINE_PLACEHOLDER = "{{opening_line}}";

const EROEFFNUNG_PLATZHALTER = "{{eroeffnung}}";

const providerDisclosureFirst = (locale: Sprachwahl, ownerName: string | null): string =>
  [locale.disclosure(ownerName), OPENING_LINE_PLACEHOLDER].join(" ");

export function providerVoicemailMessage({ locale, ownerName, openingLine }: { locale: Sprachwahl; ownerName: string; openingLine: string }): string {
  return [locale.disclosure(ownerName), locale.voicemailBody(openingLine)].join(" ");
}

export function callLocaleFor(
  state: MandantZustand,
  { tenantId, numberRecord, ownerName, defaultVoiceId, to, callLanguage }: Zugriff & { ownerName: string | null; defaultVoiceId: string; to: string | null; callLanguage?: string | undefined },
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

export interface LocaleSpeicher {
  load: () => MandantZustand;
  numberRecordByE164: (e164: string | undefined) => Zugriff["numberRecord"];
}

export interface LocaleKonfiguration {
  telnyx: { telnyxElevenLabs: { voiceId: string } };
}

export interface LocaleAnruf {
  tenantId: string;
  from?: string | undefined;
  to: string;
  language?: string | undefined;
}

export function callLocaleOf({ store, config, call, ownerName }: { store: LocaleSpeicher; config: LocaleKonfiguration; call: LocaleAnruf; ownerName: string | null }): AnrufSprache {
  return callLocaleFor(store.load(), {
    tenantId: call.tenantId,
    numberRecord: store.numberRecordByE164(call.from),
    ownerName,
    defaultVoiceId: config.telnyx.telnyxElevenLabs.voiceId,
    to: call.to,
    callLanguage: call.language,
  });
}

export function inboundElLocaleOf({ store, config, call }: { store: LocaleSpeicher; config: LocaleKonfiguration; call: LocaleAnruf }): AnrufSprache {
  return callLocaleFor(store.load(), {
    tenantId: call.tenantId,
    numberRecord: store.numberRecordByE164(call.to),
    ownerName: null,
    defaultVoiceId: config.telnyx.telnyxElevenLabs.voiceId,
    to: null,
    callLanguage: call.language,
  });
}
