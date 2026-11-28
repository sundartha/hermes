import { EIGENE_SPRACHE_JE_LAND, SUPPORTED_LANGUAGES, localeFor } from "../i18n/locales.ts";
import { countryForE164 } from "../begriffe/rufnummern.ts";
import { STARTSPRACHE } from "../konfiguration/standardsprache.ts";
import { EINE_STIMME_ID } from "./stimme-festlegen.ts";
import { ersteAeusserung, type Sprachwahl } from "../anrufe/start/anrufstart.ts";

interface AnrufSprache {
  language: string;
  providerLanguage: string;
  disclosureLanguage: string;
  voiceId: string;
  firstMessage: string;
  disclosureOwnerFallback: string;
}

const sprachwahlFuer: (language: string) => Sprachwahl = localeFor;

const SPRACHE_JE_LAND: Readonly<Record<string, string>> = EIGENE_SPRACHE_JE_LAND;

const OFFENLEGUNG_OHNE_LANDESTEXT = "en";

function primaererSprachcode(code: string): string {
  return code.split("-")[0] ?? code;
}

function calleeLanguage(to: string | null): string | null {
  const land = countryForE164(to);
  return (land && SPRACHE_JE_LAND[land]) ?? null;
}

function conversationLanguageOf(callLanguage: string | undefined): string {
  return callLanguage ? primaererSprachcode(callLanguage) : STARTSPRACHE;
}

function disclosureLanguageOf({
  to,
  callLanguage,
  ausdruecklich,
}: {
  to: string | null;
  callLanguage?: string | undefined;
  ausdruecklich?: boolean | undefined;
}): string {
  const startsprache = conversationLanguageOf(callLanguage);
  if (ausdruecklich ?? startsprache !== STARTSPRACHE) return SUPPORTED_LANGUAGES.includes(startsprache) ? startsprache : OFFENLEGUNG_OHNE_LANDESTEXT;
  return calleeLanguage(to) ?? STARTSPRACHE;
}

export function callLocaleFor({
  ownerName,
  to,
  callLanguage,
  ausdruecklich,
  anbieterSpracheDurchreichen,
}: {
  ownerName: string | null;
  to: string | null;
  callLanguage?: string | undefined;
  ausdruecklich?: boolean | undefined;
  anbieterSpracheDurchreichen?: boolean | undefined;
}): AnrufSprache {
  const gespraech = sprachwahlFuer(conversationLanguageOf(callLanguage));
  const offenlegung = sprachwahlFuer(disclosureLanguageOf({ to, callLanguage, ausdruecklich }));
  const providerLanguage = callLanguage && anbieterSpracheDurchreichen ? primaererSprachcode(callLanguage) : gespraech.language;
  return {
    language: gespraech.language,
    providerLanguage,
    disclosureLanguage: offenlegung.language,
    voiceId: EINE_STIMME_ID,
    firstMessage: ersteAeusserung({ providerLanguage, offenlegung, ownerName }),
    disclosureOwnerFallback: offenlegung.disclosureOwnerFallback,
  };
}

export interface LocaleAnruf {
  to: string;
  language?: string | null | undefined;
  languageExplicit?: boolean | undefined;
}

export function callLocaleOf({ call, ownerName }: { call: LocaleAnruf; ownerName: string | null }): AnrufSprache {
  return callLocaleFor({
    ownerName,
    to: call.to,
    callLanguage: call.language ?? STARTSPRACHE,
    ausdruecklich: call.languageExplicit,
    anbieterSpracheDurchreichen: true,
  });
}

export function inboundElLocaleOf({ call }: { call: Pick<LocaleAnruf, "language"> }): AnrufSprache {
  return callLocaleFor({
    ownerName: null,
    to: null,
    callLanguage: call.language ?? undefined,
    anbieterSpracheDurchreichen: false,
  });
}
