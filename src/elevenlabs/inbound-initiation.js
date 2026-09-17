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
//
// EROEFFNUNG (IEX-A3, O1/E1/E2): first_message = bundle.inboundEroeffnung(ownerName) - Sprache
// aus inboundElLocaleOf (dieselbe Aufloesung wie agent.language und tts.voice_id), Name aus
// tenantContext. Kein serverseitiger Pflichtsatz davor: der Hinweis steckt in diesem Satz.
// RIEGEL (E3) zweimal: vor der Bindung (Route, Stufe 3b) und am fertigen Koerper im Waechter.
//
// ZWEI VARIANTEN (IEP-P6): hat der Server callerIsOwner set-once auf true gesetzt (eigene
// hinterlegte Nummer des ANGERUFENEN Tenants, Schalter an, Tenant gepinnt) UND liegt ein
// Vorname vor, spricht die Owner-Fassung - Anrede mit Vornamen statt Selbstvorstellung in
// der dritten Person. Sonst die freigegebene Fremd-Fassung. Die Variante faellt GENAU
// EINMAL (inboundEroeffnungFuer) und faerbt zwei Felder: first_message und
// inbound_situation. Die KI-Kennzeichnung und der Transkriptions-Hinweis bleiben in BEIDEN
// Fassungen woertlich; kein Werkzeug, kein Datum und kein Recht haengt an der Variante
// (Owner-Entscheidung 5 - eine Anrufernummer ist faelschbar).
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

// Der Header entsteht in der SIP-Ziel-URI (inbound-sip-uri.js, EINE Quelle); der Anbieter
// reicht ihn als sip_headers bzw. als dynamische Systemvariable weiter ([M1] F-B).
export { EL_CALL_BINDING_SIP_HEADER };
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

// E12/E19: EINE Aufloesung von Sprache und Stimme - fuer die Init-Antwort und fuer die Stimme
// des Fehlersatzes (routes/voice.js).
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
    // E12: kein Anrufbeantworter-Text - eingehend spricht der Anbieter nie auf eine Mailbox.
    voicemail_line: "",
    // L5/B3 + IEP-P6: die Inbound-Sektion der Vorlage - Fremd- oder Owner-Fassung,
    // entschieden an DERSELBEN Variante wie die Eroeffnung (eine Entscheidung, G5).
    inbound_situation: situation,
  };
}

// IEP-P6: Fremd- oder Owner-Fassung der Vorlagen-Sektion. Der Rueckfall-Text ist die
// FERTIGE Fremd-Eroeffnung - das Modell formuliert eine Rechtspflicht nicht selbst.
function inboundSituationFuer({ variante, owner, fremdEroeffnung }) {
  const vorlage = LOCALES.en.prompt;
  return variante === EROEFFNUNG_VARIANTE.OWNER
    ? vorlage.inboundSituationOwner({ owner, fremdEroeffnung })
    : vorlage.inboundSituation({ owner });
}

// E1/E2 + IEP-P6: EINE Quelle fuer Text, Sprache, Namen UND Variante - Riegel (Route),
// Waechter und Builder lesen dasselbe (G5).
//
// FAIL-CLOSED DURCH KONSTRUKTION: die Owner-Fassung entsteht nur, wenn (1) der Server
// callerIsOwner set-once auf true gesetzt hat (Schalter + Allowlist + exakter
// Nummern-Treffer, routes/voice.js) UND (2) ein Vorname vorliegt - sonst liefert
// inboundEroeffnungOwner "" und die freigegebene Fremd-Eroeffnung spricht. `=== true`
// strikt: undefined (Bestands-Datensatz ohne das Feld) heisst FREMD.
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
    // Die Eingabe des Riegels, als EIN Wert - beide Pruefstellen bekommen dieselbe.
    sollform: { bundle, ownerName, firstName, variante },
  };
}

// IEX-A3 Stufe 3b der Init-Route: Defekt-Namen der Eroeffnung dieses Anrufs, VOR der Bindung.
export function inboundEroeffnungsDefekteFuer({ store, config, call }) {
  const { text, sollform } = inboundEroeffnungFuer({ store, config, call });
  return inboundEroeffnungDefekte({ text, ...sollform });
}

function inboundOverride({ text, locale }) {
  return {
    agent: { first_message: text, language: locale.language },
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

const EROEFFNUNG_BEFUND_PRAEFIX = "eroeffnung.";

// E3 am TATSAECHLICH gesendeten first_message, nicht an einer Neuberechnung.
function eroeffnungsDefekteDer(antwort, sollform) {
  const text = wertAmPfad(antwort.conversation_config_override, FIRST_MESSAGE_PFAD);
  return inboundEroeffnungDefekte({ text, ...sollform }).map((defekt) => `${EROEFFNUNG_BEFUND_PRAEFIX}${defekt}`);
}

// Fehlertext nennt nur Namen und Pfade, nie Werte (Regel 4).
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
