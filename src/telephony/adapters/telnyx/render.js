// Telnyx-Adapter: renderDirectives - uebersetzt neutrale Direktiven (directives.js)
// in TeXML. EINZIGER Telnyx-Ort mit Provider-Voice-Namen + TeXML-Markup. Kein SDK:
// TeXML wird als String gebaut (Telnyx liefert keinen TwiML-aequivalenten Builder).
// Fail-closed wie der Twilio-Renderer (unbekanntes voiceProfile -> wirft). STREAM
// rendert seit P7 echtes <Connect><Stream> (Telnyx-Realtime ueber Port 4).
import { DIRECTIVE, VOICE_PROFILE } from "../../directives.js";
import { sttLocaleForVoiceProfile } from "../../voice-locale.js";
import { elevenLabsVoiceNameFor, hasElevenLabsVoice } from "./elevenlabs-voice.js";
import { sttAttrs } from "./stt-model.js";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

// Logisches Voice-Profil -> Telnyx-TeXML-Voice-NAME. Telnyx TeXML akzeptiert
// Azure-NTTS-Voices im Format "Azure.<locale>-<VoiceId>Neural" (Telnyx-Doku, Say-Verb;
// Owner-Wahl 2026-06-16: natuerlichere deutsche Stimme als AWS Polly Vicki-Neural).
// Die Locale steckt im Voice-Namen; das `language`-Attribut kommt seit P9 NICHT mehr aus
// dieser Tabelle, sondern aus dem Locale-Buendel (voice-locale.js) - eine Quelle fuer den
// Say-Voice UND die STT-Locale des Gathers (siehe gatherAttrs), kein Drift zwischen
// Buendel und Adapter. EN = GB-Englisch (Azure Sonia); Nova-3 deckt EN mit ab (kein
// model-Override noetig). Fail-closed: unbekanntes Profil ist ein Programmierfehler
// (wirft), kein stiller Default-Voice-Fallback. Twilio-Renderer bleibt bewusst auf Polly.
const TELNYX_VOICE_NAME = Object.freeze({
  [VOICE_PROFILE.DE_FEMALE_NEURAL]: "Azure.de-DE-KatjaNeural",
  [VOICE_PROFILE.FR_FEMALE_NEURAL]: "Azure.fr-FR-DeniseNeural",
  [VOICE_PROFILE.EN_FEMALE_NEURAL]: "Azure.en-GB-SoniaNeural",
});

// XML-Sonderzeichen escapen (&, <, >, ", ' -> Entities). & zuerst, sonst werden
// die nachfolgenden Entities doppelt escaped.
function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
function attrString(obj) {
  return Object.entries(obj)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join("");
}

// ElevenLabs-TTS: Telnyx relayt
// <Say voice="ElevenLabs.<Model>.<VoiceId>" api_key_ref="..."> an die ElevenLabs-
// API; der ElevenLabs-API-Key liegt als Telnyx-Integration-Secret und wird ueber
// den api_key_ref-IDENTIFIER referenziert. opts.elevenLabs injiziert die Registry
// aus config.telnyx.telnyxElevenLabs - der Renderer bleibt config-frei und pur. KEIN
// language-Attribut am ElevenLabs-Say: die Voice ist multilingual, die gesprochene
// Sprache folgt dem Text (Telnyx-Doku-Beispiel traegt keins). Die VOICE-ID folgt seit P9
// trotzdem der Sprache (Owner-Entscheidung 2026-07-27): das MODELL ist multilingual, die
// Sprecherin soll dennoch Muttersprachlerin sein - kein Widerspruch. Gate fail-safe statt
// fail-closed: ElevenLabs NUR wenn apiKeyRef UND voiceId gesetzt, sonst Azure-
// Bestand byte-identisch - ein halbes/leeres Env ist ein Betriebszustand, kein
// Programmierfehler, und darf kein laufendes Gespraech toeten (anders als das
// werfende voiceAttrs beim Code-Enum voiceProfile). KORRIGIERT (A/B-belegt
// 2026-07-06): Der ElevenLabs-LIVE-RELAY unterdrueckt den Inbound-Track ->
// Deepgram-STT liefert LEER (Agent hoert den Angerufenen NICHT). Die Relay-
// Attribute bleiben als Referenz erhalten, sind aber NICHT der Sprech-Pfad der
// Wahl. Native Wiedergabe einer vorab synthetisierten Datei via <Play> (audioUrl,
// server.js Play-TTS-Seam) laesst den Inbound-Track leben - das ist der aktive Weg.
// Risiken im Live-Smoke-Gate (tasks/todo.md): Telnyx-Verhalten bei leerem
// ElevenLabs-Guthaben/ungueltigem Key ist undokumentiert (kein Auto-Fallback); die
// TTS-Zeichen aller Tenants laufen ohne per-Tenant-Metering aufs Owner-ElevenLabs-Konto.
function sayVoiceAttrs(d, opts) {
  const el = opts.elevenLabs;
  if (hasElevenLabsVoice(el))
    return { voice: elevenLabsVoiceNameFor(el, d.voiceProfile), api_key_ref: el.apiKeyRef };
  return voiceAttrs(d.voiceProfile);
}

// <Play> einer vorab synthetisierten Audiodatei (native Telnyx-Wiedergabe, KEIN Relay).
// Gemeinsam von renderSay und renderGather genutzt (eine Quelle, G5).
function renderPlay(url) {
  return `<Play>${escapeXml(url)}</Play>`;
}

function renderSay(d, opts) {
  if (d.audioUrl) return renderPlay(d.audioUrl);
  return `<Say${attrString(sayVoiceAttrs(d, opts))}>${escapeXml(d.text)}</Say>`;
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
function gatherAttrs(d, opts) {
  const stt = sttAttrs(opts.sttProfile);
  return {
    input: "speech",
    language: voiceAttrs(d.voiceProfile).language,
    transcriptionEngine: stt.engine,
    model: stt.model,
    speechTimeout: d.speechTimeoutSec === undefined ? "auto" : String(d.speechTimeoutSec),
  };
}

function renderGather(d, opts) {
  const open = `<Gather${attrString(gatherAttrs(d, opts))} action="${escapeXml(d.action)}" method="POST">`;
  const prompt = gatherPrompt(d, opts);
  if (!prompt) return open.replace(/>$/, "/>");
  return `${open}${prompt}</Gather>`;
}

// Prompt-Inhalt des Gathers: vorab synthetisiertes Audio (promptAudioUrl) -> <Play>,
// sonst der bestehende innere <Say> (byte-identisch), leer -> "" (self-closing oben).
function gatherPrompt(d, opts) {
  if (d.promptAudioUrl) return renderPlay(d.promptAudioUrl);
  if (d.promptText) return renderSay({ text: d.promptText, voiceProfile: d.voiceProfile }, opts);
  return "";
}

// Realtime-Media-Stream als TeXML <Connect><Stream> mit <Parameter>-Kindern.
// Symmetrisch zum Twilio-Renderer (connect().stream({url}) + parameter(p)).
// Parameter-Reihenfolge ist vertraglich (Snapshot-Test).
function renderStream(d) {
  const params = d.params
    .map((p) => `<Parameter name="${escapeXml(p.name)}" value="${escapeXml(p.value)}"/>`)
    .join("");
  return `<Connect><Stream url="${escapeXml(d.url)}">${params}</Stream></Connect>`;
}

// Eine Direktive in TeXML uebersetzen (eine Abstraktionsebene, G34).
function renderDirective(d, opts) {
  switch (d.kind) {
    case DIRECTIVE.SAY:
      return renderSay(d, opts);
    case DIRECTIVE.GATHER:
      return renderGather(d, opts);
    case DIRECTIVE.REDIRECT:
      return `<Redirect method="POST">${escapeXml(d.url)}</Redirect>`;
    case DIRECTIVE.HANGUP:
      return "<Hangup/>";
    case DIRECTIVE.STREAM:
      return renderStream(d);
    default:
      throw new Error(`unbekannte Direktive: ${d.kind}`);
  }
}

// opts (optional, Telnyx-eigene Erweiterung ueber den Port hinaus): { elevenLabs, sttProfile }
// - die Registry injiziert config.telnyx.telnyxElevenLabs, Aufrufe ohne opts bleiben
// byte-identisch zum Bestand (Azure). sttProfile ist die neutrale STT-Wahl (stt-profile.js);
// fehlt sie, greift das Default-Profil.
/** @type {import("../../ports.js").VoiceRenderer["renderDirectives"]} */
export function renderDirectives(directives, opts = {}) {
  return XML_DECL + "<Response>" + directives.map((d) => renderDirective(d, opts)).join("") + "</Response>";
}
