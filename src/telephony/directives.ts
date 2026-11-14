export const VOICE_PROFILE = Object.freeze({
  DE_FEMALE_NEURAL: "de-female-neural",
  FR_FEMALE_NEURAL: "fr-female-neural",
  EN_FEMALE_NEURAL: "en-female-neural",
});

export const DIRECTIVE = Object.freeze({
  SAY: "say",
  GATHER: "gather",
  HANGUP: "hangup",
  REDIRECT: "redirect",
  DIAL_SIP: "dial_sip",
});

export type VoiceProfile = (typeof VOICE_PROFILE)[keyof typeof VOICE_PROFILE];

interface VoiceIdFeld {
  voiceId?: string;
}

export interface SayDirective {
  kind: "say";
  text: string;
  voiceProfile: VoiceProfile;
  audioUrl: string | undefined;
}

export type SayMitStimme = SayDirective & VoiceIdFeld;

export type GatherDirective = {
  kind: "gather";
  promptText: string;
  action: string;
  voiceProfile: VoiceProfile;
  speechTimeoutSec: number | undefined;
  promptAudioUrl: string | undefined;
} & VoiceIdFeld;

export interface HangupDirective {
  kind: "hangup";
}

export interface RedirectDirective {
  kind: "redirect";
  url: string;
}

export interface DialSipDirective {
  kind: "dial_sip";
  uri: string;
  username: string | undefined;
  password: string | undefined;
  callerId: string | undefined;
  timeoutS: number | undefined;
  timeLimitS: number | undefined;
  statusCallbackUrl: string | undefined;
  answerOnBridge: boolean | undefined;
  ringbackAudioUrl: string | undefined;
}

export const say = (
  text: string,
  voiceProfile: VoiceProfile = VOICE_PROFILE.DE_FEMALE_NEURAL,
  audioUrl?: string,
): SayDirective => ({
  kind: DIRECTIVE.SAY,
  text,
  voiceProfile,
  audioUrl,
});

const voiceIdField = (voiceId: unknown): VoiceIdFeld => (typeof voiceId === "string" && voiceId.length > 0 ? { voiceId } : {});

export const sayWithVoiceId = ({
  text,
  voiceProfile,
  voiceId,
}: {
  text: string;
  voiceProfile?: VoiceProfile;
  voiceId?: string;
}): SayMitStimme => ({
  ...say(text, voiceProfile),
  ...voiceIdField(voiceId),
});

export const gather = ({
  promptText,
  action,
  voiceProfile = VOICE_PROFILE.DE_FEMALE_NEURAL,
  speechTimeoutSec,
  promptAudioUrl,
  voiceId,
}: {
  promptText: string;
  action: string;
  voiceProfile?: VoiceProfile;
  speechTimeoutSec?: number;
  promptAudioUrl?: string;
  voiceId?: string;
}): GatherDirective => ({
  kind: DIRECTIVE.GATHER,
  promptText,
  action,
  voiceProfile,
  speechTimeoutSec,
  promptAudioUrl,
  ...voiceIdField(voiceId),
});

export const hangup = (): HangupDirective => ({ kind: DIRECTIVE.HANGUP });

export const redirect = (url: string): RedirectDirective => ({ kind: DIRECTIVE.REDIRECT, url });

export const dialSip = ({
  uri,
  username,
  password,
  callerId,
  timeoutS,
  timeLimitS,
  statusCallbackUrl,
  answerOnBridge,
  ringbackAudioUrl,
}: {
  uri: string;
  username?: string;
  password?: string;
  callerId?: string;
  timeoutS?: number;
  timeLimitS?: number;
  statusCallbackUrl?: string;
  answerOnBridge?: boolean;
  ringbackAudioUrl?: string | undefined;
}): DialSipDirective => ({
  kind: DIRECTIVE.DIAL_SIP,
  uri,
  username,
  password,
  callerId,
  timeoutS,
  timeLimitS,
  statusCallbackUrl,
  answerOnBridge,
  ringbackAudioUrl,
});
