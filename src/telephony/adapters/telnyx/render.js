// Telnyx-Adapter: renderDirectives - uebersetzt neutrale Direktiven (directives.js)
// in TeXML. EINZIGER Telnyx-Ort mit Provider-Voice-Namen + TeXML-Markup. Kein SDK:
// TeXML wird als String gebaut (Telnyx liefert keinen TwiML-aequivalenten Builder).
// Fail-closed: unbekanntes voiceProfile -> wirft. STREAM
// rendert seit P7 echtes <Connect><Stream> (Telnyx-Realtime ueber Port 4).
//
// KEIN ElevenLabs-ZWEIG AM <Say> - UND GENAU DAS IST DER RIEGEL (IP3). Bis IP3 schaltete
// dieser Renderer auf den Telnyx-gehosteten ElevenLabs-LIVE-RELAY um
// (<Say voice="ElevenLabs.<Model>.<VoiceId>" api_key_ref="...">), sobald
// TELNYX_ELEVENLABS_API_KEY_REF UND TELNYX_ELEVENLABS_VOICE_ID beide gesetzt waren -
// ohne Flag, ohne Logzeile, also eine Selbstarmierung. Der Relay ist A/B-belegt DEFEKT
// (Messung 2026-07-06): er unterdrueckt den Inbound-Audio-Track, Deepgram liefert ein
// LEERES Transkript, der Agent hoert den Anrufer nicht. Der ElevenLabs-Weg dieses
// Adapters ist die Vorab-Synthese via <Play> (src/tts/directive-synth.js, Flag
// ELEVENLABS_PLAY_TTS_ENABLED): eine STATISCHE Datei laesst den Inbound-Track leben.
// Ein `elevenLabs`-Schluessel in opts ist seit IP3 INERT und kein Fehler - ein Wurf
// mitten im Gespraech waere eine neue Fehlerquelle. Gepinnt in
// test/telnyx-elevenlabs-render.test.js.
import { DIRECTIVE, VOICE_PROFILE } from "../../directives.js";
import { sttLocaleForVoiceProfile } from "../../voice-locale.js";
import { sttAttrs } from "./stt-model.js";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

// IEL-B7: Grenzen des TeXML-<Dial> (Telnyx-Doku Dial-Verb, abgerufen 2026-09-15): timeLimit
// 60-14400 s, Default 14400. Immer gesetzt und geklemmt - weggelassen hiesse vier Stunden
// Bruecke. Anbieter-Grenze, deshalb hier im Adapter und nicht in der neutralen Direktive.
const DIAL_TIME_LIMIT_MIN_S = 60;
const DIAL_TIME_LIMIT_MAX_S = 14400;
// Das SIP-Bein meldet nur "answered": damit startet die innere Bindungsfrist (E9-1).
const SIP_STATUS_CALLBACK_EVENT = "answered";

// Logisches Voice-Profil -> Telnyx-TeXML-Voice-NAME. Telnyx TeXML akzeptiert
// Azure-NTTS-Voices im Format "Azure.<locale>-<VoiceId>Neural" (Telnyx-Doku, Say-Verb;
// Owner-Wahl 2026-06-16: natuerlichere deutsche Stimme als AWS Polly Vicki-Neural).
// Die Locale steckt im Voice-Namen; das `language`-Attribut kommt seit P9 NICHT mehr aus
// dieser Tabelle, sondern aus dem Locale-Buendel (voice-locale.js) - eine Quelle fuer den
// Say-Voice UND die STT-Locale des Gathers (siehe gatherAttrs), kein Drift zwischen
// Buendel und Adapter. EN = GB-Englisch (Azure Sonia); Nova-3 deckt EN mit ab (kein
// model-Override noetig). Fail-closed: unbekanntes Profil ist ein Programmierfehler
// (wirft), kein stiller Default-Voice-Fallback.
const TELNYX_VOICE_NAME = Object.freeze({
  [VOICE_PROFILE.DE_FEMALE_NEURAL]: "Azure.de-DE-KatjaNeural",
  [VOICE_PROFILE.FR_FEMALE_NEURAL]: "Azure.fr-FR-DeniseNeural",
  [VOICE_PROFILE.EN_FEMALE_NEURAL]: "Azure.en-GB-SoniaNeural",
});

// XML-Sonderzeichen -> Entities. Eine Ersetzungsrunde statt einer verketteten .replace-
// Kette (G36, Gesetz von Demeter) - dieselbe Wirkung, weil jedes Sonderzeichen in der
// Eingabe hoechstens einmal getroffen wird, also keine Reihenfolge-Abhaengigkeit besteht
// (& muesste bei einer Kette zuerst stehen, hier ist das gegenstandslos).
const XML_ENTITY_BY_CHAR = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
});

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => XML_ENTITY_BY_CHAR[char]);
}

// Exportiert (P4.5, G5): der Call-Control-speak-Adapter (voice.js) nutzt dieselbe
// Voice-Map statt eine zweite Telnyx-Voice-Namens-Quelle zu fuehren.
// Attribut-Reihenfolge (voice, language) ist vertraglich (attrString, Snapshot).
export function voiceAttrs(profile) {
  const voice = TELNYX_VOICE_NAME[profile];
  if (!voice) throw new Error(`unbekanntes voiceProfile: ${profile}`);
  return { voice, language: sttLocaleForVoiceProfile(profile) };
}

// Attribut-Objekt -> ' k="v" ...' in Einfuege-Reihenfolge (vertraglich, Snapshot).
function attrString(attrs) {
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
}

// <Play> einer vorab synthetisierten Audiodatei (native Telnyx-Wiedergabe, KEIN Relay).
// Gemeinsam von renderSay und renderGather genutzt (eine Quelle, G5).
function renderPlay(url) {
  return `<Play>${escapeXml(url)}</Play>`;
}

function renderSay(directive) {
  if (directive.audioUrl) return renderPlay(directive.audioUrl);
  return `<Say${attrString(voiceAttrs(directive.voiceProfile))}>${escapeXml(directive.text)}</Say>`;
}

// Telnyx-TeXML-Gather-Attribute (Spracherkennung). transcriptionEngine ist PFLICHT,
// damit Telnyx ueberhaupt transkribiert: ohne Engine erkennt `<Gather input="speech">`
// keine Sprache und sendet kein SpeechResult zurueck (Telnyx-TeXML-Spec) - das war der
// Inbound-Audio-Bug (Agent hoerte den Angerufenen nie). Engine UND Modell kommen als EIN
// Datensatz aus stt-model.js (dieselbe Quelle wie der Call-Control-Assistant-Pfad, G5):
// der model-Vendor MUSS zu transcriptionEngine passen, deshalb duerfen sie nie zwei
// getrennt gewaehlte Groessen werden. Fehlt opts.sttProfile (arg-loser Aufruf), greift das
// Default-Profil -> byte-identisch. language kommt aus dem voiceProfile
// des Gathers (ueber voiceAttrs aus dem Locale-Buendel, dieselbe Quelle wie der
// Say-Voice), nicht hartkodiert: so transkribiert STT IMMER in der Sprache, in der
// gesprochen wird; der Snapshot-Wert bleibt derselbe. R9: language MUSS das
// volle Locale ("de-DE"/"fr-FR") sein. Die fruehere Annahme "de allein" (2026-06-16) war
// FALSCH und durch echte STT-Billing-Records widerlegt: Telnyx erkennt "de" nicht als
// Deutsch -> Fallback auf Englisch (Records zeigten language:'en') -> deutsche Sprache wird
// mit englischem Modell transkribiert -> leeres Transcript (Telnyx-Support-AI + Account-
// Records 2026-06-20). Fail-closed: unbekanntes Profil wirft (via voiceAttrs).
// speechTimeout="auto" ist Default (Telnyx-Empfehlung 2026-06-20, Gather-Doku): aktiviert
// End-of-Speech-Erkennung, damit der Gather nach dem Sprechende prompt zurueckpostet statt
// auf einen festen Stille-Timeout zu warten. Override-Seam (G3): gesetztes speechTimeoutSec
// ersetzt "auto" an DERSELBEN Attribut-Position (nur Folge-Gathers setzen den Wert).
// speechModel/actionOnEmptyResult bleiben Twilio-spezifisch und ungesetzt. Attribut-
// Reihenfolge ist vertraglich (Einfuege-Reihenfolge); der Snapshot-Test nagelt sie fest
// (DE bleibt dadurch byte-identisch).
function gatherAttrs(directive, opts) {
  const stt = sttAttrs(opts.sttProfile);
  return {
    input: "speech",
    language: voiceAttrs(directive.voiceProfile).language,
    transcriptionEngine: stt.engine,
    model: stt.model,
    speechTimeout: directive.speechTimeoutSec === undefined ? "auto" : String(directive.speechTimeoutSec),
  };
}

function renderGather(directive, opts) {
  const open = `<Gather${attrString(gatherAttrs(directive, opts))} action="${escapeXml(directive.action)}" method="POST">`;
  const prompt = gatherPrompt(directive);
  if (!prompt) return open.replace(/>$/, "/>");
  return `${open}${prompt}</Gather>`;
}

// Prompt-Inhalt des Gathers: vorab synthetisiertes Audio (promptAudioUrl) -> <Play>,
// sonst der bestehende innere <Say> (byte-identisch), leer -> "" (self-closing oben).
function gatherPrompt(directive) {
  if (directive.promptAudioUrl) return renderPlay(directive.promptAudioUrl);
  if (directive.promptText)
    return renderSay({ text: directive.promptText, voiceProfile: directive.voiceProfile });
  return "";
}

// Fehlertext nennt nie einen Attributwert (Passwort liegt in derselben Direktive).
function dialTimeLimitS(seconds) {
  if (!Number.isFinite(seconds)) throw new Error("Dial-Direktive: timeLimitS ist keine Zahl");
  return Math.min(DIAL_TIME_LIMIT_MAX_S, Math.max(DIAL_TIME_LIMIT_MIN_S, seconds));
}

// Pflichtfelder der Dial-Direktive (uri, username, password, callerId, statusCallbackUrl):
// fail-closed statt stillem String(undefined) -> "undefined" im TeXML (IEL-B7-S1a). Ein
// SIP-INVITE mit woertlich falschem Digest-Username an eine echte Gegenstelle
// (sip.rtc.elevenlabs.io) darf nie klaglos rausgehen. Eine Pruef-Funktion fuer alle fuenf
// Felder (G5, keine Duplizierung) statt fuenf gleichlautender Checks; der Feldname im
// Fehlertext ist kein Wert der Direktive (username/password/callerId/uri/statusCallbackUrl
// sind reine Schluesselnamen, keine Secrets).
function requireDialField(directive, fieldName) {
  const value = directive[fieldName];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Dial-Direktive: ${fieldName} fehlt oder ist kein nichtleerer String`);
  }
  return value;
}

// <Dial><Sip>: alle Attribute und die URI laufen durch escapeXml (attrString). Attribut-
// Reihenfolge ist vertraglich (Snapshot test/iel-dial-render.test.js).
function renderDialSip(directive) {
  const uri = requireDialField(directive, "uri");
  const username = requireDialField(directive, "username");
  const password = requireDialField(directive, "password");
  const callerId = requireDialField(directive, "callerId");
  const statusCallbackUrl = requireDialField(directive, "statusCallbackUrl");
  const dial = attrString({
    callerId,
    timeout: directive.timeoutS,
    timeLimit: dialTimeLimitS(directive.timeLimitS),
  });
  const sip = attrString({
    username,
    password,
    statusCallback: statusCallbackUrl,
    statusCallbackEvent: SIP_STATUS_CALLBACK_EVENT,
  });
  return `<Dial${dial}><Sip${sip}>${escapeXml(uri)}</Sip></Dial>`;
}

// Eine Direktive in TeXML uebersetzen (eine Abstraktionsebene, G34).
function renderDirective(directive, opts) {
  switch (directive.kind) {
    case DIRECTIVE.SAY:
      return renderSay(directive);
    case DIRECTIVE.GATHER:
      return renderGather(directive, opts);
    case DIRECTIVE.REDIRECT:
      return `<Redirect method="POST">${escapeXml(directive.url)}</Redirect>`;
    case DIRECTIVE.HANGUP:
      return "<Hangup/>";
    case DIRECTIVE.DIAL_SIP:
      return renderDialSip(directive);
    default:
      throw new Error(`unbekannte Direktive: ${directive.kind}`);
  }
}

// opts (optional, Telnyx-eigene Erweiterung ueber den Port hinaus): { sttProfile } - die
// neutrale STT-Wahl (stt-profile.js), von der Registry lazy injiziert; fehlt sie (arg-loser
// Aufruf), greift das Default-Profil und das TeXML bleibt byte-identisch zum Bestand.
/** @type {import("../../ports.js").VoiceRenderer["renderDirectives"]} */
export function renderDirectives(directives, opts = {}) {
  return (
    XML_DECL + "<Response>" + directives.map((directive) => renderDirective(directive, opts)).join("") + "</Response>"
  );
}
