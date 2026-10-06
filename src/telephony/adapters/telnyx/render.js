import { DIRECTIVE, VOICE_PROFILE } from "../../directives.js";
import { sttLocaleForVoiceProfile } from "../../voice-locale.js";
import { sttAttrs } from "./stt-model.js";

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

const DIAL_TIME_LIMIT_MIN_S = 60;
const DIAL_TIME_LIMIT_MAX_S = 14400;
const DIAL_TIMEOUT_MIN_S = 5;
const DIAL_TIMEOUT_MAX_S = 600;
const SIP_STATUS_CALLBACK_EVENT = "answered";

const TELNYX_VOICE_NAME = Object.freeze({
  [VOICE_PROFILE.DE_FEMALE_NEURAL]: "Azure.de-DE-KatjaNeural",
  [VOICE_PROFILE.FR_FEMALE_NEURAL]: "Azure.fr-FR-DeniseNeural",
  [VOICE_PROFILE.EN_FEMALE_NEURAL]: "Azure.en-GB-SoniaNeural",
});

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

export function voiceAttrs(profile) {
  const voice = TELNYX_VOICE_NAME[profile];
  if (!voice) throw new Error(`unbekanntes voiceProfile: ${profile}`);
  return { voice, language: sttLocaleForVoiceProfile(profile) };
}

function attrString(attrs) {
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
}

function renderPlay(url) {
  return `<Play>${escapeXml(url)}</Play>`;
}

function renderSay(directive) {
  if (directive.audioUrl) return renderPlay(directive.audioUrl);
  return `<Say${attrString(voiceAttrs(directive.voiceProfile))}>${escapeXml(directive.text)}</Say>`;
}

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

function gatherPrompt(directive) {
  if (directive.promptAudioUrl) return renderPlay(directive.promptAudioUrl);
  if (directive.promptText)
    return renderSay({ text: directive.promptText, voiceProfile: directive.voiceProfile });
  return "";
}

function clampDialSeconds(seconds, fieldName, { minS, maxS }) {
  if (!Number.isFinite(seconds)) throw new Error(`Dial-Direktive: ${fieldName} ist keine Zahl`);
  return Math.min(maxS, Math.max(minS, seconds));
}

function requireDialField(directive, fieldName) {
  const value = directive[fieldName];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Dial-Direktive: ${fieldName} fehlt oder ist kein nichtleerer String`);
  }
  return value;
}

function answerOnBridgeAttr(directive) {
  return directive.answerOnBridge === true ? { answerOnBridge: "true" } : {};
}

function ringbackAudioAttr(directive) {
  const url = directive.ringbackAudioUrl;
  return typeof url === "string" && url.length > 0 ? { audioUrl: url } : {};
}

function renderDialSip(directive) {
  const uri = requireDialField(directive, "uri");
  const username = requireDialField(directive, "username");
  const password = requireDialField(directive, "password");
  const callerId = requireDialField(directive, "callerId");
  const statusCallbackUrl = requireDialField(directive, "statusCallbackUrl");
  const dial = attrString({
    ...answerOnBridgeAttr(directive),
    ...ringbackAudioAttr(directive),
    callerId,
    timeout: clampDialSeconds(directive.timeoutS, "timeoutS", {
      minS: DIAL_TIMEOUT_MIN_S,
      maxS: DIAL_TIMEOUT_MAX_S,
    }),
    timeLimit: clampDialSeconds(directive.timeLimitS, "timeLimitS", {
      minS: DIAL_TIME_LIMIT_MIN_S,
      maxS: DIAL_TIME_LIMIT_MAX_S,
    }),
  });
  const sip = attrString({
    username,
    password,
    statusCallback: statusCallbackUrl,
    statusCallbackEvent: SIP_STATUS_CALLBACK_EVENT,
  });
  return `<Dial${dial}><Sip${sip}>${escapeXml(uri)}</Sip></Dial>`;
}

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

export function renderDirectives(directives, opts = {}) {
  return (
    XML_DECL + "<Response>" + directives.map((directive) => renderDirective(directive, opts)).join("") + "</Response>"
  );
}
