// IEL-B6 (E11/E12): die Antwort auf den Conversation-Initiation-Webhook eines eingehenden
// Anrufs, der an den ElevenLabs-Agenten uebergeben wird - plus die Lesart des
// Bindungs-Tokens aus dem Webhook. Rein bis auf Store-Lesezugriffe: kein Netz, kein Log.
//
// EINE QUELLE DER VARIABLEN (G5): die Schluesselmenge entsteht aus
// outbound.js#dynamicVariables - derselbe Baustein wie beim Anrufstart, mit einem leeren
// Auftrag. Jedes Auftragsfeld faellt dabei auf seinen Leerwert; nur voicemail_line und
// inbound_situation werden fuer eingehende Anrufe ueberschrieben. Dass die Menge der
// Vorlage entspricht, pinnt der Test (templatePlaceholderNames).
//
// KEIN WERKZEUG-TOKEN (E12, R-F): tenant_token reist leer. Die Werkzeug-Routen sperren
// eingehende Anrufe an der Richtung bzw. am fehlenden Token - fuer Inbound wird der
// abgeleitete Wert nie berechnet und nie gesendet.
//
// WAECHTER (fail-closed): die Antwort wird VOR dem Senden geprueft und der Bau wirft, statt
// einen unsicheren Wert still durchzulassen - ein unaufgeloestes Platzhalter-Paar im Wert
// ist beim Anbieter im schlimmsten Fall der 1008-Abbruch (Stille).
import { localeFor, LOCALES } from "../i18n/locales.js";
import { gespeicherteBegruessungFuer } from "../i18n/greeting-catalog.js";
import { begruessungOhnePflichtsatz } from "../i18n/inbound-notice.js";
import { callLocaleFor } from "./call-locale.js";
import { callTimeContext } from "./time-context.js";
import {
  OVERRIDE_ALLOWED_LEAF_PATHS,
  OVERRIDE_FIRST_MESSAGE_LEAF_PATHS,
  overrideLeafPaths,
} from "./convai.js";
import { PLACEHOLDER_OPENER, auftraggeberAusdruck, dynamicVariables } from "./outbound.js";

// B7 setzt den SIP-Header am <Dial><Sip>; der Anbieter reicht ihn als sip_headers bzw. als
// dynamische Systemvariable weiter ([M1] F-B).
export const EL_CALL_BINDING_SIP_HEADER = "X-Hermes-Call-Binding";
export const EL_CALL_BINDING_VARIABLE = "sip_hermes_call_binding";
export const INITIATION_RESPONSE_TYPE = "conversation_initiation_client_data";

// Nur fuer das Log (M7: welche Form der Anbieter wirklich schickt, ist ungemessen).
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
// Eingehend gibt es keinen Auftrag: jedes Auftragsfeld faellt auf seinen Leerwert (E12).
const OHNE_AUFTRAG = Object.freeze({});
// S7: keine Gegenstelle - der Agent nennt dann keine absolute Uhrzeit, der Anrufer nennt
// sie selbst. Die Anrufernummer verriete die Zone, reist aber aus Datenminimierung nicht mit.
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

// E11: das Bindungs-Token aus dem Webhook - sip_headers als Objekt (Namen case-insensitiv)
// oder als Liste [{name, value}], sonst die dynamische Variable. "" wenn nichts Brauchbares
// da ist; ein leeres Token wird nie verglichen.
export function callBindingTokenOf(body) {
  return tokenAusKopfzeilen(body) || alsToken(body?.dynamic_variables?.[EL_CALL_BINDING_VARIABLE]);
}

// E12/E19: EINE Aufloesung von Sprache und Stimme - fuer die Init-Antwort jetzt und fuer die
// Stimme des Pflichtsatzes in B8.
export function inboundElLocaleOf({ store, config, call }) {
  return callLocaleFor(store.load(), {
    tenantId: call.tenantId,
    // Die EIGENE DID (eingehend ist sie das Ziel; der Anrufstart liest call.from).
    numberRecord: store.numberRecordByE164(call.to),
    // firstMessage der Aufloesung wird hier nicht gelesen.
    ownerName: null,
    defaultVoiceId: config.telnyx.telnyxElevenLabs.voiceId,
    // Eingehend gibt es keinen "Angerufenen" im Sinne des Anrufstarts.
    to: null,
    callLanguage: call.language,
  });
}

function inboundDynamicVariables({ owner, bundle, time }) {
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
    // E12: kein Anrufbeantworter-Text - eingehend spricht der Anbieter nie auf eine Mailbox.
    voicemail_line: "",
    // L5/B3: die Inbound-Sektion der Vorlage.
    inbound_situation: LOCALES.en.prompt.inboundSituation({ owner }),
  };
}

function inboundOverride({ call, locale, bundle, ctx }) {
  const begruessung = gespeicherteBegruessungFuer({
    storedGreeting: ctx.settings.greeting,
    language: call.language,
    ownerName: ctx.ownerName,
  });
  return {
    agent: {
      // E1: der Pflichtsatz ist vor der Uebergabe bereits gesprochen.
      first_message: begruessungOhnePflichtsatz({ greeting: begruessung, notice: bundle.inboundNotice }),
      language: locale.language,
    },
    // Leere Stimme -> kein tts-Zweig; die Stimme am Agenten bleibt stehen (wie Outbound).
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

// Fehlertext nennt nur Namen und Pfade, nie Werte (Regel 4).
function assertAntwortSicher(antwort, callId) {
  const befunde = [
    ...unsichereVariablen(antwort.dynamic_variables),
    ...unsichereOverridePfade(antwort.conversation_config_override),
  ];
  if (befunde.length === 0) return;
  throw new Error(`Init-Antwort abgebrochen (call=${callId}): unsichere Felder ${[...new Set(befunde)].join(", ")}`);
}

export function buildInitiationResponse({ store, config, call }) {
  const locale = inboundElLocaleOf({ store, config, call });
  const bundle = localeFor(locale.language);
  const ctx = store.tenantContext(call.tenantId);
  const owner = auftraggeberAusdruck(ctx.ownerName, bundle);
  const time = callTimeContext({ tenantTimezone: store.tenantTimezone(call.tenantId), callee: OHNE_GEGENSTELLE });
  const antwort = {
    type: INITIATION_RESPONSE_TYPE,
    dynamic_variables: inboundDynamicVariables({ owner, bundle, time }),
    conversation_config_override: inboundOverride({ call, locale, bundle, ctx }),
  };
  assertAntwortSicher(antwort, call.id);
  return antwort;
}
