import { EIGENE_SPRACHE_JE_LAND, SUPPORTED_LANGUAGES, localeFor } from "../i18n/locales.ts";
import { countryForE164 } from "../begriffe/rufnummern.ts";
import { resolveCallLanguage } from "../store/state-ops.js";
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

interface Zugriff {
  tenantId: string;
  numberRecord: { language?: string | null } | null | undefined;
}

type MandantZustand = Parameters<typeof resolveCallLanguage>[0];
const aufgeloesteSprache: (state: MandantZustand, zugriff: Zugriff) => string = resolveCallLanguage;
const sprachwahlFuer: (language: string) => Sprachwahl = localeFor;

const SPRACHE_JE_LAND: Readonly<Record<string, string>> = EIGENE_SPRACHE_JE_LAND;

const OFFENLEGUNG_OHNE_LANDESTEXT = "en";

const AN_ANBIETER_DURCHGEREICHTE_SPRACHEN = Object.freeze(["pt", "es", "fr", "de", "en", "it", "nl"]);

function primaererSprachcode(code: string): string {
  return code.split("-")[0] ?? code;
}

function providerSpracheVon(textSprache: string, callLanguage: string | null | undefined): string {
  if (!callLanguage) return textSprache;
  const basis = primaererSprachcode(callLanguage);
  return AN_ANBIETER_DURCHGEREICHTE_SPRACHEN.includes(basis) ? basis : textSprache;
}

function calleeLanguage(to: string | null): string | null {
  const land = countryForE164(to);
  return (land && SPRACHE_JE_LAND[land]) ?? null;
}

function conversationLanguageOf(state: MandantZustand, { tenantId, numberRecord, callLanguage }: Zugriff & { callLanguage?: string | undefined }): string {
  if (callLanguage) return callLanguage;
  return aufgeloesteSprache(state, { tenantId, numberRecord });
}

function disclosureLanguageOf(
  state: MandantZustand,
  { tenantId, numberRecord, to, callLanguage }: Zugriff & { to: string | null; callLanguage?: string | undefined },
): string {
  const fremdeStartsprache = callLanguage !== undefined && !SUPPORTED_LANGUAGES.includes(callLanguage);
  if (fremdeStartsprache) return calleeLanguage(to) ?? OFFENLEGUNG_OHNE_LANDESTEXT;
  return calleeLanguage(to) ?? aufgeloesteSprache(state, { tenantId, numberRecord });
}

export function callLocaleFor(
  state: MandantZustand,
  { tenantId, numberRecord, ownerName, to, callLanguage }: Zugriff & { ownerName: string | null; to: string | null; callLanguage?: string | undefined },
): AnrufSprache {
  const gespraech = sprachwahlFuer(conversationLanguageOf(state, { tenantId, numberRecord, callLanguage }));
  const offenlegung = sprachwahlFuer(disclosureLanguageOf(state, { tenantId, numberRecord, to, callLanguage }));
  const providerLanguage = providerSpracheVon(gespraech.language, callLanguage);
  return {
    language: gespraech.language,
    providerLanguage,
    disclosureLanguage: offenlegung.language,
    voiceId: EINE_STIMME_ID,
    firstMessage: ersteAeusserung({ providerLanguage, offenlegung, ownerName }),
    disclosureOwnerFallback: offenlegung.disclosureOwnerFallback,
  };
}

export interface LocaleSpeicher {
  load: () => MandantZustand;
  numberRecordByE164: (e164: string | undefined) => Zugriff["numberRecord"];
}

export interface LocaleAnruf {
  tenantId: string;
  from?: string | undefined;
  to: string;
  language?: string | undefined;
}

export function callLocaleOf({ store, call, ownerName }: { store: LocaleSpeicher; call: LocaleAnruf; ownerName: string | null }): AnrufSprache {
  return callLocaleFor(store.load(), {
    tenantId: call.tenantId,
    numberRecord: store.numberRecordByE164(call.from),
    ownerName,
    to: call.to,
    callLanguage: call.language,
  });
}

export function inboundElLocaleOf({ store, call }: { store: LocaleSpeicher; call: LocaleAnruf }): AnrufSprache {
  return callLocaleFor(store.load(), {
    tenantId: call.tenantId,
    numberRecord: store.numberRecordByE164(call.to),
    ownerName: null,
    to: null,
    callLanguage: call.language,
  });
}
