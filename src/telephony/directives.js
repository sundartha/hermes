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

export const say = (text, voiceProfile = VOICE_PROFILE.DE_FEMALE_NEURAL, audioUrl) => ({
  kind: DIRECTIVE.SAY,
  text,
  voiceProfile,
  audioUrl,
});

const voiceIdField = (voiceId) => (typeof voiceId === "string" && voiceId.length > 0 ? { voiceId } : {});

export const sayWithVoiceId = ({ text, voiceProfile, voiceId }) => ({
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
}) => ({
  kind: DIRECTIVE.GATHER,
  promptText,
  action,
  voiceProfile,
  speechTimeoutSec,
  promptAudioUrl,
  ...voiceIdField(voiceId),
});

export const hangup = () => ({ kind: DIRECTIVE.HANGUP });

export const redirect = (url) => ({ kind: DIRECTIVE.REDIRECT, url });

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
}) => ({
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
