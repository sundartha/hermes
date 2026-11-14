import { DIRECTIVE, VOICE_PROFILE } from "../../directives.js";
import { sttLocaleForVoiceProfile } from "../../voice-locale.ts";
import { sttAttrs } from "./stt-model.ts";

interface GatherDirektive {
  kind: typeof DIRECTIVE.GATHER;
  action: string;
  voiceProfile: string;
  promptText?: string | undefined;
  promptAudioUrl?: string | undefined;
  speechTimeoutSec?: number | undefined;
}

type DialFeld = "uri" | "username" | "password" | "callerId" | "statusCallbackUrl";

interface DialSipDirektive {
  kind: typeof DIRECTIVE.DIAL_SIP;
  uri?: unknown;
  username?: unknown;
  password?: unknown;
  callerId?: unknown;
  statusCallbackUrl?: unknown;
  answerOnBridge?: unknown;
  ringbackAudioUrl?: unknown;
  timeoutS: number;
  timeLimitS: number;
}

type Direktive =
  | { kind: typeof DIRECTIVE.SAY; text: string; voiceProfile: string; audioUrl?: string | undefined }
  | GatherDirektive
  | { kind: typeof DIRECTIVE.REDIRECT; url: string }
  | { kind: typeof DIRECTIVE.HANGUP }
  | DialSipDirektive
  | { kind: "unbekannt" };

interface RenderOptionen {
  sttProfile?: string | undefined;
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

const DIAL_TIME_LIMIT_MIN_S = 60;
const DIAL_TIME_LIMIT_MAX_S = 14400;
const DIAL_TIMEOUT_MIN_S = 5;
const DIAL_TIMEOUT_MAX_S = 600;
const SIP_STATUS_CALLBACK_EVENT = "answered";

const TELNYX_VOICE_NAME: Readonly<Record<string, string>> = Object.freeze({
  [VOICE_PROFILE.DE_FEMALE_NEURAL]: "Azure.de-DE-KatjaNeural",
  [VOICE_PROFILE.FR_FEMALE_NEURAL]: "Azure.fr-FR-DeniseNeural",
  [VOICE_PROFILE.EN_FEMALE_NEURAL]: "Azure.en-GB-SoniaNeural",
});

const XML_ENTITY_BY_CHAR: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
});

export function escapeXml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => XML_ENTITY_BY_CHAR[char] ?? char);
}

export function voiceAttrs(profile: string): { voice: string; language: string } {
  const voice = TELNYX_VOICE_NAME[profile];
  if (!voice) throw new Error(`unbekanntes voiceProfile: ${profile}`);
  return { voice, language: sttLocaleForVoiceProfile(profile) };
}

function attrString(attrs: Record<string, unknown>) {
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
}

function renderPlay(url: string) {
  return `<Play>${escapeXml(url)}</Play>`;
}

function renderSay(directive: { text: string; voiceProfile: string; audioUrl?: string | undefined }) {
  if (directive.audioUrl) return renderPlay(directive.audioUrl);
  return `<Say${attrString(voiceAttrs(directive.voiceProfile))}>${escapeXml(directive.text)}</Say>`;
}

function gatherAttrs(directive: GatherDirektive, opts: RenderOptionen) {
  const stt = sttAttrs(opts.sttProfile);
  return {
    input: "speech",
    language: voiceAttrs(directive.voiceProfile).language,
    transcriptionEngine: stt.engine,
    model: stt.model,
    speechTimeout: directive.speechTimeoutSec === undefined ? "auto" : String(directive.speechTimeoutSec),
  };
}

function renderGather(directive: GatherDirektive, opts: RenderOptionen) {
  const open = `<Gather${attrString(gatherAttrs(directive, opts))} action="${escapeXml(directive.action)}" method="POST">`;
  const prompt = gatherPrompt(directive);
  if (!prompt) return open.replace(/>$/, "/>");
  return `${open}${prompt}</Gather>`;
}

function gatherPrompt(directive: GatherDirektive) {
  if (directive.promptAudioUrl) return renderPlay(directive.promptAudioUrl);
  if (directive.promptText)
    return renderSay({ text: directive.promptText, voiceProfile: directive.voiceProfile });
  return "";
}

function clampDialSeconds(seconds: number, fieldName: string, { minS, maxS }: { minS: number; maxS: number }) {
  if (!Number.isFinite(seconds)) throw new Error(`Dial-Direktive: ${fieldName} ist keine Zahl`);
  return Math.min(maxS, Math.max(minS, seconds));
}

function requireDialField(directive: DialSipDirektive, fieldName: DialFeld) {
  const value = directive[fieldName];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Dial-Direktive: ${fieldName} fehlt oder ist kein nichtleerer String`);
  }
  return value;
}

function answerOnBridgeAttr(directive: DialSipDirektive) {
  return directive.answerOnBridge === true ? { answerOnBridge: "true" } : {};
}

function ringbackAudioAttr(directive: DialSipDirektive) {
  const url = directive.ringbackAudioUrl;
  return typeof url === "string" && url.length > 0 ? { audioUrl: url } : {};
}

function renderDialSip(directive: DialSipDirektive) {
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

function renderDirective(directive: Direktive, opts: RenderOptionen) {
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

export function renderDirectives(directives: Direktive[], opts: RenderOptionen = {}): string {
  return (
    XML_DECL + "<Response>" + directives.map((directive) => renderDirective(directive, opts)).join("") + "</Response>"
  );
}
