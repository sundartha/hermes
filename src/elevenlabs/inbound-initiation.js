import { localeFor, LOCALES } from "../i18n/locales.js";
import { EROEFFNUNG_VARIANTE, inboundEroeffnungDefekte } from "../i18n/inbound-opening.js";
import { callLocaleFor } from "./call-locale.js";
import { callTimeContext } from "./time-context.js";
import {
  OVERRIDE_ALLOWED_LEAF_PATHS,
  OVERRIDE_FIRST_MESSAGE_LEAF_PATHS,
  overrideLeafPaths,
} from "./convai.js";
import { PLACEHOLDER_OPENER, auftraggeberAusdruck, dynamicVariables } from "./outbound.js";
import { EL_CALL_BINDING_SIP_HEADER } from "./inbound-sip-uri.js";

export { EL_CALL_BINDING_SIP_HEADER };
export const EL_CALL_BINDING_VARIABLE = "sip_hermes_call_binding";
export const INITIATION_RESPONSE_TYPE = "conversation_initiation_client_data";

export const SIP_HEADERS_FORM = Object.freeze({
  OBJEKT: "objekt",
  LISTE: "liste",
  FEHLT: "fehlt",
  UNBEKANNT: "unbekannt",
});

const HEADER_KLEIN = EL_CALL_BINDING_SIP_HEADER.toLowerCase();
const KEIN_TOKEN = "";
const ERLAUBTE_OVERRIDE_PFADE = Object.freeze([
  ...OVERRIDE_ALLOWED_LEAF_PATHS,
  ...OVERRIDE_FIRST_MESSAGE_LEAF_PATHS,
]);
const OVERRIDE_PFAD_TRENNER = ".";
const FIRST_MESSAGE_PFAD = OVERRIDE_FIRST_MESSAGE_LEAF_PATHS[0];
const OHNE_AUFTRAG = Object.freeze({});
const OHNE_GEGENSTELLE = "";

const alsToken = (wert) => (typeof wert === "string" ? wert : KEIN_TOKEN);
const istEinfachesObjekt = (wert) => wert !== null && typeof wert === "object" && !Array.isArray(wert);

export function sipHeadersFormOf(body) {
  const kopfzeilen = body?.sip_headers;
  if (kopfzeilen === undefined || kopfzeilen === null) return SIP_HEADERS_FORM.FEHLT;
  if (Array.isArray(kopfzeilen)) return SIP_HEADERS_FORM.LISTE;
  return istEinfachesObjekt(kopfzeilen) ? SIP_HEADERS_FORM.OBJEKT : SIP_HEADERS_FORM.UNBEKANNT;
}

function tokenAusObjekt(kopfzeilen) {
  const schluessel = Object.keys(kopfzeilen).find((name) => name.toLowerCase() === HEADER_KLEIN);
  return schluessel ? alsToken(kopfzeilen[schluessel]) : KEIN_TOKEN;
}

function tokenAusListe(kopfzeilen) {
  const eintrag = kopfzeilen.find(
    (kandidat) => typeof kandidat?.name === "string" && kandidat.name.toLowerCase() === HEADER_KLEIN,
  );
  return alsToken(eintrag?.value);
}

function tokenAusKopfzeilen(body) {
  const form = sipHeadersFormOf(body);
  if (form === SIP_HEADERS_FORM.OBJEKT) return tokenAusObjekt(body.sip_headers);
  if (form === SIP_HEADERS_FORM.LISTE) return tokenAusListe(body.sip_headers);
  return KEIN_TOKEN;
}

export function callBindingTokenOf(body) {
  return tokenAusKopfzeilen(body) || alsToken(body?.dynamic_variables?.[EL_CALL_BINDING_VARIABLE]);
}

export function inboundElLocaleOf({ store, config, call }) {
  return callLocaleFor(store.load(), {
    tenantId: call.tenantId,
    numberRecord: store.numberRecordByE164(call.to),
    ownerName: null,
    defaultVoiceId: config.telnyx.telnyxElevenLabs.voiceId,
    to: null,
    callLanguage: call.language,
  });
}

function inboundDynamicVariables({ owner, bundle, time, situation }) {
  return {
    ...dynamicVariables({
      call: OHNE_AUFTRAG,
      owner,
      offenlegung: bundle,
      openingLine: "",
      time,
      consultAllowed: false,
      lookupAllowed: false,
      tenantToken: KEIN_TOKEN,
    }),
    voicemail_line: "",
    inbound_situation: situation,
  };
}

function inboundSituationFuer({ variante, owner, fremdEroeffnung }) {
  const vorlage = LOCALES.en.prompt;
  return variante === EROEFFNUNG_VARIANTE.OWNER
    ? vorlage.inboundSituationOwner({ owner, fremdEroeffnung })
    : vorlage.inboundSituation({ owner });
}

function inboundEroeffnungFuer({ store, config, call }) {
  const locale = inboundElLocaleOf({ store, config, call });
  const bundle = localeFor(locale.language);
  const { ownerName, firstName } = store.tenantContext(call.tenantId);
  const fremd = bundle.inboundEroeffnung(ownerName);
  const ownerText = call.callerIsOwner === true ? bundle.inboundEroeffnungOwner(firstName) : "";
  const variante = ownerText ? EROEFFNUNG_VARIANTE.OWNER : EROEFFNUNG_VARIANTE.FREMD;
  return {
    text: ownerText || fremd,
    locale,
    fremd,
    sollform: { bundle, ownerName, firstName, variante },
  };
}

export function inboundEroeffnungsDefekteFuer({ store, config, call }) {
  const { text, sollform } = inboundEroeffnungFuer({ store, config, call });
  return inboundEroeffnungDefekte({ text, ...sollform });
}

function inboundOverride({ text, locale }) {
  return {
    agent: { first_message: text, language: locale.language },
    ...(locale.voiceId ? { tts: { voice_id: locale.voiceId } } : {}),
  };
}

const istSichererText = (wert) => typeof wert === "string" && !wert.includes(PLACEHOLDER_OPENER);

const wertAmPfad = (objekt, pfad) =>
  pfad.split(OVERRIDE_PFAD_TRENNER).reduce((knoten, schluessel) => knoten?.[schluessel], objekt);

function unsichereVariablen(variablen) {
  return Object.entries(variablen)
    .filter(([, wert]) => !istSichererText(wert))
    .map(([name]) => `dynamic_variables.${name}`);
}

function unsichereOverridePfade(override) {
  const pfade = overrideLeafPaths(override, []);
  const verboten = pfade.filter((pfad) => !ERLAUBTE_OVERRIDE_PFADE.includes(pfad));
  const unsicher = pfade.filter((pfad) => !istSichererText(wertAmPfad(override, pfad)));
  const eroeffnung = wertAmPfad(override, FIRST_MESSAGE_PFAD);
  const ohneEroeffnung = typeof eroeffnung === "string" && eroeffnung.trim() ? [] : [FIRST_MESSAGE_PFAD];
  return [...verboten, ...unsicher, ...ohneEroeffnung];
}

const EROEFFNUNG_BEFUND_PRAEFIX = "eroeffnung.";

function eroeffnungsDefekteDer(antwort, sollform) {
  const text = wertAmPfad(antwort.conversation_config_override, FIRST_MESSAGE_PFAD);
  return inboundEroeffnungDefekte({ text, ...sollform }).map((defekt) => `${EROEFFNUNG_BEFUND_PRAEFIX}${defekt}`);
}

function assertAntwortSicher(antwort, { callId, sollform }) {
  const befunde = [
    ...unsichereVariablen(antwort.dynamic_variables),
    ...unsichereOverridePfade(antwort.conversation_config_override),
    ...eroeffnungsDefekteDer(antwort, sollform),
  ];
  if (befunde.length === 0) return;
  throw new Error(`Init-Antwort abgebrochen (call=${callId}): unsichere Felder ${[...new Set(befunde)].join(", ")}`);
}

export function buildInitiationResponse({ store, config, call }) {
  const eroeffnung = inboundEroeffnungFuer({ store, config, call });
  const { sollform, fremd } = eroeffnung;
  const { bundle, ownerName, variante } = sollform;
  const owner = auftraggeberAusdruck(ownerName, bundle);
  const time = callTimeContext({ tenantTimezone: store.tenantTimezone(call.tenantId), callee: OHNE_GEGENSTELLE });
  const antwort = {
    type: INITIATION_RESPONSE_TYPE,
    dynamic_variables: inboundDynamicVariables({
      owner,
      bundle,
      time,
      situation: inboundSituationFuer({ variante, owner, fremdEroeffnung: fremd }),
    }),
    conversation_config_override: inboundOverride(eroeffnung),
  };
  assertAntwortSicher(antwort, { callId: call.id, sollform });
  return antwort;
}
