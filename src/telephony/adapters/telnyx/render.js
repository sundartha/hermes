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
// Die Locale steckt im Voice-Namen; language="de-DE" bleibt konsistent erhalten.
// Fail-closed: unbekanntes Profil ist ein Programmierfehler (wirft), kein stiller
// Default-Voice-Fallback. Twilio-Renderer bleibt bewusst auf Polly (anderer Pfad).
const TELNYX_VOICE = Object.freeze({
  [VOICE_PROFILE.DE_FEMALE_NEURAL]: { voice: "Azure.de-DE-KatjaNeural", language: "de-DE" },
});

// Telnyx-TeXML-Gather-Attribute (deutsche Spracherkennung). transcriptionEngine ist
// PFLICHT, damit Telnyx ueberhaupt transkribiert: ohne Engine erkennt `<Gather
// input="speech">` keine Sprache und sendet kein SpeechResult zurueck (Telnyx-
// TeXML-Spec) - das war der Inbound-Audio-Bug (Agent hoerte den Angerufenen nie).
// "Deepgram" + model "deepgram/nova-3" = hoechste Erkennungsgenauigkeit (Owner-Wahl
// 2026-06-16; Premium-Add-on, ersetzt die in-house-Engine). KRITISCH: language MUSS das
// volle Locale "de-DE" sein. Die fruehere Annahme "de allein" (2026-06-16) war FALSCH und
// durch echte STT-Billing-Records widerlegt: Telnyx erkennt "de" nicht als Deutsch ->
// Fallback auf Englisch (Records zeigten language:'en') -> deutsche Sprache wird mit
// englischem Modell transkribiert -> leeres Transcript (Telnyx-Support-AI + Account-
// Records 2026-06-20). Der model-Vendor MUSS zu transcriptionEngine passen (Telnyx-Doku). Twilios
// speechModel/speechTimeout/actionOnEmptyResult sind Twilio-spezifisch und hier
// bewusst NICHT gesetzt. Attribut-Reihenfolge ist vertraglich (Einfuege-Reihenfolge);
// der Snapshot-Test nagelt sie fest.
const GATHER_ATTRS = Object.freeze({
  input: "speech",
  language: "de-DE",
  transcriptionEngine: "Deepgram",
  model: "deepgram/nova-3",
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

function renderSay(d) {
  return `<Say${attrString(voiceAttrs(d.voiceProfile))}>${escapeXml(d.text)}</Say>`;
}

function renderGather(d) {
  const open = `<Gather${attrString(GATHER_ATTRS)} action="${escapeXml(d.action)}" method="POST">`;
  if (!d.promptText) return open.replace(/>$/, "/>");
  return `${open}${renderSay({ text: d.promptText, voiceProfile: d.voiceProfile })}</Gather>`;
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
function renderDirective(d) {
  switch (d.kind) {
    case DIRECTIVE.SAY:
      return renderSay(d);
    case DIRECTIVE.GATHER:
      return renderGather(d);
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

/** @type {import("../../ports.js").VoiceRenderer["renderDirectives"]} */
export function renderDirectives(directives) {
  return XML_DECL + "<Response>" + directives.map(renderDirective).join("") + "</Response>";
}
