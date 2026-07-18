// P3.2 (PLAN-CONVERSATION-QUALITY-V2): gestaffelte Antwort auf einen leeren Gather.
// Der Bestand schoss bei JEDEM leeren SpeechResult denselben Satz zurueck - ohne Zaehler,
// ohne Eskalation; einzige Obergrenze war der wortlose Max-Dauer-Cap. Diese Funktion ist
// die EINE Quelle der Staffel; sie ist rein (kein Store, kein I/O, kein Nebeneffekt) und
// damit ohne Server-Spawn testbar. Der Zaehler selbst lebt am Call (store.countNoSpeechTurn).
//
// Stufe 1 -> knappe Rueckfrage (BYTE-IDENTISCH zum Bestand, von g4-no-speech-reprompt gepinnt)
// Stufe 2 -> deutlichere Formulierung ("ich hoere Sie nicht")
// Stufe 3+ -> Abschied + Hangup statt Endlosschleife bis zum stillen Cap
//
// Die Schwellen sind bewusst KEIN Config-Knopf: die Staffel ist eine Gespraechs-Dramaturgie,
// kein Betriebsparameter, und config.voice.maxEmptyTurns gehoert einer anderen Achse
// (LLM-end_call-Guard in claude.js), die hier nicht mitgedreht werden darf.
const SECOND_ATTEMPT_STREAK = 2;

export function noSpeechEscalation(streak, locale) {
  if (streak < SECOND_ATTEMPT_STREAK) return { speech: locale.noSpeechReprompt, endCall: false };
  if (streak === SECOND_ATTEMPT_STREAK)
    return { speech: locale.noSpeechRepromptAgain, endCall: false };
  return { speech: locale.noSpeechFarewell, endCall: true };
}
