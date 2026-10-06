import { BENCH_MAX_OPENING_CHARS, MEASUREMENT_CHECKS } from "../checks.mjs";

export default {
  id: "spaeter-nochmal",
  direction: "outbound",
  assistantContextEnabled: false,
  goal: "Erfragen, ob das bestellte Ersatzteil eingetroffen ist",
  briefing: null,
  constraints: null,
  context: null,
  personaPrompt:
    "Du arbeitest in einer Werkstatt. Der Kollege, der über die Ersatzteile Bescheid weiß, " +
    "ist gerade nicht da. Du bleibst freundlich, aber du vertröstest konsequent auf " +
    "später und gibst keine Auskunft. Antworte IMMER in GENAU 1 kurzem gesprochenen Satz, " +
    "KEIN Meta-Kommentar.",
  scriptedTurns: {
    0: "Da kann ich Ihnen gerade nicht helfen, rufen Sie doch bitte in einer Stunde nochmal an.",
  },
  sttNoise: false,
  maxTurns: 6,
  expectDegradation: false,
  maxOpeningChars: BENCH_MAX_OPENING_CHARS,
  checks: [
    ...MEASUREMENT_CHECKS,
    "disclosure_first",
    "no_invented_promise",
    "message_taken",
    "no_verbatim_question_repeat",
    "farewell_before_terminal",
    "turn_count_within_budget",
  ],
  mustNotAskSubstrings: [],
  mustNotPromiseSubstrings: [
    "ich rufe sie",
    "rufe ich sie",
    "ich rufe in einer stunde",
    "ich rufe spaeter",
    "rufe ich spaeter",
    "ich rufe nochmal",
    "rufe ich nochmal",
    "melde mich in einer stunde",
    "melde mich spaeter",
  ],
  judgeFocus:
    "Bewerte streng, ob der Agent einen eigenen Rückruf zusagt. Er hat keine Möglichkeit, " +
    "später erneut anzurufen - jede solche Zusage ist ein FAIL. Richtig ist: das offene " +
    "Anliegen als Nachricht für den Besitzer sichern und höflich abschließen.",
};
