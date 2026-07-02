// Telnyx-Adapter: renderDirectives - uebersetzt neutrale Direktiven (directives.js)
// in TeXML. EINZIGER Telnyx-Ort mit Provider-Voice-Namen + TeXML-Markup. Kein SDK:
// TeXML wird als String gebaut (Telnyx liefert keinen TwiML-aequivalenten Builder).
// Fail-closed wie der Twilio-Renderer (unbekanntes voiceProfile -> wirft). STREAM
// rendert seit P7 echtes <Connect><Stream> (Telnyx-Realtime ueber Port 4).
import { DIRECTIVE, VOICE_PROFILE } from "../../directives.js";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

// Logisches Voice-Profil -> Telnyx-TeXML-Voice-Attribute. Telnyx TeXML akzeptiert
// Azure-NTTS-Voices im Format "Azure.<locale>-<VoiceId>Neural" (Telnyx-Doku, Say-Verb;
// Owner-Wahl 2026-06-16: natuerlichere deutsche Stimme als AWS Polly Vicki-Neural).
// Die Locale steckt im Voice-Namen; `language` (volles BCP-47) bleibt konsistent und
// liefert zugleich die STT-Locale des Gathers (siehe gatherAttrs) - eine Quelle pro
// Sprache. Fail-closed: unbekanntes Profil ist ein Programmierfehler (wirft), kein
// stiller Default-Voice-Fallback. Twilio-Renderer bleibt bewusst auf Polly (anderer Pfad).
const TELNYX_VOICE = Object.freeze({
  [VOICE_PROFILE.DE_FEMALE_NEURAL]: { voice: "Azure.de-DE-KatjaNeural", language: "de-DE" },
  [VOICE_PROFILE.FR_FEMALE_NEURAL]: { voice: "Azure.fr-FR-DeniseNeural", language: "fr-FR" },
  // EN (F1 P4): GB-Englisch. Azure en-GB-SoniaNeural ist die britische Neural-Stimme;
  // en-GB als volles BCP-47 fuer TTS UND STT-Locale (R9). Nova-3 deckt EN mit ab (kein
  // model-Override noetig). Live-Freischaltung (Azure Sonia / Deepgram EN) = Smoke-Gate.
  [VOICE_PROFILE.EN_FEMALE_NEURAL]: { voice: "Azure.en-GB-SoniaNeural", language: "en-GB" },
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

function voiceAttrs(profile) {
  const attrs = TELNYX_VOICE[profile];
  if (!attrs) throw new Error(`unbekanntes voiceProfile: ${profile}`);
  return attrs;
}

// Attribut-Objekt -> ' k="v" ...' in Einfuege-Reihenfolge (vertraglich, Snapshot).
function attrString(obj) {
  return Object.entries(obj)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join("");
}

// ElevenLabs-TTS (globale Plattform-Stimme): Telnyx relayt
// <Say voice="ElevenLabs.<Model>.<VoiceId>" api_key_ref="..."> an die ElevenLabs-
// API; der ElevenLabs-API-Key liegt als Telnyx-Integration-Secret und wird ueber
// den api_key_ref-IDENTIFIER referenziert. opts.elevenLabs injiziert die Registry
// aus config.telnyxElevenLabs - der Renderer bleibt config-frei und pur. KEIN
// language-Attribut am ElevenLabs-Say: die Voice ist multilingual, die gesprochene
// Sprache folgt dem Text (Telnyx-Doku-Beispiel traegt keins). Gate fail-safe statt
// fail-closed: ElevenLabs NUR wenn apiKeyRef UND voiceId gesetzt, sonst Azure-
// Bestand byte-identisch - ein halbes/leeres Env ist ein Betriebszustand, kein
// Programmierfehler, und darf kein laufendes Gespraech toeten (anders als das
// werfende voiceAttrs beim Code-Enum voiceProfile). STT bleibt UNBERUEHRT
// (gatherAttrs unten - Telnyx unterstuetzt ElevenLabs nur fuer TTS). Risiken im
// Live-Smoke-Gate (tasks/todo.md): Telnyx-Verhalten bei leerem ElevenLabs-Guthaben/
// ungueltigem Key ist undokumentiert (kein Auto-Fallback); die TTS-Zeichen aller
// Tenants laufen ohne per-Tenant-Metering aufs Owner-ElevenLabs-Konto.
function sayVoiceAttrs(d, opts) {
  const el = opts.elevenLabs || {};
  if (el.apiKeyRef && el.voiceId)
    return {
      voice: `ElevenLabs.${el.model || "Default"}.${el.voiceId}`,
      api_key_ref: el.apiKeyRef,
    };
  return voiceAttrs(d.voiceProfile);
}

function renderSay(d, opts) {
  return `<Say${attrString(sayVoiceAttrs(d, opts))}>${escapeXml(d.text)}</Say>`;
}

// Telnyx-TeXML-Gather-Attribute (Spracherkennung). transcriptionEngine ist PFLICHT,
// damit Telnyx ueberhaupt transkribiert: ohne Engine erkennt `<Gather input="speech">`
// keine Sprache und sendet kein SpeechResult zurueck (Telnyx-TeXML-Spec) - das war der
// Inbound-Audio-Bug (Agent hoerte den Angerufenen nie). "Deepgram" + model
// "deepgram/nova-3" = hoechste Erkennungsgenauigkeit (Owner-Wahl 2026-06-16; Premium-
// Add-on, ersetzt die in-house-Engine); Nova-3 ist mehrsprachig (DE+FR), der model-Vendor
// MUSS zu transcriptionEngine passen (Telnyx-Doku). language kommt aus dem voiceProfile
// des Gathers (dieselbe TELNYX_VOICE-Map wie der Say-Voice), nicht hartkodiert: so
// transkribiert STT IMMER in der Sprache, in der gesprochen wird. R9: language MUSS das
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
function gatherAttrs(d) {
  return {
    input: "speech",
    language: voiceAttrs(d.voiceProfile).language,
    transcriptionEngine: "Deepgram",
    model: "deepgram/nova-3",
    speechTimeout: d.speechTimeoutSec === undefined ? "auto" : String(d.speechTimeoutSec),
  };
}

function renderGather(d, opts) {
  const open = `<Gather${attrString(gatherAttrs(d))} action="${escapeXml(d.action)}" method="POST">`;
  if (!d.promptText) return open.replace(/>$/, "/>");
  return `${open}${renderSay({ text: d.promptText, voiceProfile: d.voiceProfile }, opts)}</Gather>`;
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

// opts (optional, Telnyx-eigene Erweiterung ueber den Port hinaus): { elevenLabs }
// - die Registry injiziert config.telnyxElevenLabs, Aufrufe ohne opts bleiben
// byte-identisch zum Bestand (Azure).
/** @type {import("../../ports.js").VoiceRenderer["renderDirectives"]} */
export function renderDirectives(directives, opts = {}) {
  return XML_DECL + "<Response>" + directives.map((d) => renderDirective(d, opts)).join("") + "</Response>";
}
