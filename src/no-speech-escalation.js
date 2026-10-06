const SECOND_ATTEMPT_STREAK = 2;

export function noSpeechEscalation(streak, locale) {
  if (streak < SECOND_ATTEMPT_STREAK) return { speech: locale.noSpeechReprompt, endCall: false };
  if (streak === SECOND_ATTEMPT_STREAK)
    return { speech: locale.noSpeechRepromptAgain, endCall: false };
  return { speech: locale.noSpeechFarewell, endCall: true };
}
