// Telnyx-Adapter: renderDirectives - uebersetzt neutrale Direktiven (directives.js)
// in TeXML. EINZIGER Telnyx-Ort mit Provider-Voice-Namen + TeXML-Markup. Kein SDK:
// TeXML wird als String gebaut (Telnyx liefert keinen TwiML-aequivalenten Builder).
// Fail-closed wie der Twilio-Renderer (unbekanntes voiceProfile / STREAM -> wirft).
import { DIRECTIVE, VOICE_PROFILE } from "../../directives.js";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

// Logisches Voice-Profil -> Telnyx-TeXML-Voice-Attribute. Telnyx TeXML akzeptiert
// AWS-Polly-Voices im Format "Polly.<VoiceId>-Neural" (Telnyx-Doku, Say-Verb), also
// derselbe Bezeichner wie der Twilio-Renderer. Fail-closed: unbekanntes Profil ist
// ein Programmierfehler (wirft), kein stiller Default-Voice-Fallback.
const TELNYX_VOICE = Object.freeze({
  [VOICE_PROFILE.DE_FEMALE_NEURAL]: { voice: "Polly.Vicki-Neural", language: "de-DE" },
});

// Telnyx-TeXML-Gather-Attribute (deutsche Spracherkennung). Bewusst nur die in der
// Telnyx-Doku belegten Attribute - Twilios speechModel/actionOnEmptyResult und
// speechTimeout="auto" sind Twilio-spezifisch und werden von Telnyx nicht
// dokumentiert (s. deviations). Attribut-Reihenfolge ist vertraglich (Einfuege-
// Reihenfolge); der Snapshot-Test nagelt sie fest.
const GATHER_ATTRS = Object.freeze({
  input: "speech",
  language: "de-DE",
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
      // Telnyx-Realtime ist nicht in P5 (deferred P7). Fail-closed statt stiller
      // Fallback - sonst wuerde ein realtime-Inbound ueber Telnyx still brechen.
      throw new Error("Telnyx-Realtime (STREAM) ist nicht in P5 - P7");
    default:
      throw new Error(`unbekannte Direktive: ${d.kind}`);
  }
}

/** @type {import("../../ports.js").VoiceRenderer["renderDirectives"]} */
export function renderDirectives(directives) {
  return XML_DECL + "<Response>" + directives.map(renderDirective).join("") + "</Response>";
}
