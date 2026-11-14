const SECOND_ATTEMPT_STREAK = 2;

interface NoSpeechTexte {
  noSpeechReprompt: string;
  noSpeechRepromptAgain: string;
  noSpeechFarewell: string;
}

export function noSpeechEscalation(streak: number, locale: NoSpeechTexte): { speech: string; endCall: boolean } {
  if (streak < SECOND_ATTEMPT_STREAK) return { speech: locale.noSpeechReprompt, endCall: false };
  if (streak === SECOND_ATTEMPT_STREAK)
    return { speech: locale.noSpeechRepromptAgain, endCall: false };
  return { speech: locale.noSpeechFarewell, endCall: true };
}
