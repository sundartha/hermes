// Szenario "personenwechsel" (P4): ab dem DRITTEN Callee-Turn (turnIndex 2, 0-basiert)
// uebernimmt ein anderer Mensch den Hoerer, der das bisherige Gespraech nicht mitbekommen
// hat. Gemessen wird, ob der Agent den Wechsel bemerkt und sein Anliegen der NEUEN Person
// knapp neu darlegt - statt weiterzureden, als spraeche er noch mit der ersten Person,
// oder verwirrt aufzulegen. scriptedTurns[1] pinnt die Uebergabe-Ansage deterministisch.
import { MEASUREMENT_CHECKS } from "../checks.mjs";

export default {
  id: "personenwechsel",
  direction: "outbound",
  assistantContextEnabled: false,
  goal: "Klären, ob die Rechnung vom letzten Monat schon bearbeitet wurde",
  briefing: null,
  constraints: null,
  context: null,
  personaPrompt:
    "Du bist die Empfangskraft einer kleinen Firma und gerade ans Telefon gegangen. Für " +
    "Rechnungen bist du nicht zuständig. Antworte IMMER in GENAU 1 kurzem gesprochenen " +
    "Satz, KEIN Meta-Kommentar.",
  personaSwitch: {
    fromTurnIndex: 2,
    personaPrompt:
      "Du bist eine ANDERE Person: die Kollegin aus der Buchhaltung, die den Hörer gerade " +
      "übernommen hat. Du hast das bisherige Gespräch NICHT mitgehört und weißt nicht, " +
      "worum es geht. Frage einmal nach, worum es geht, und antworte danach sachlich: " +
      "die Rechnung ist letzte Woche bezahlt worden. Antworte IMMER in GENAU 1 kurzem " +
      "gesprochenen Satz, KEIN Meta-Kommentar.",
  },
  scriptedTurns: { 1: "Einen Moment, ich gebe Ihnen die Kollegin aus der Buchhaltung." },
  sttNoise: false,
  maxTurns: 8,
  minTurnsBeforeAgentHangup: 5,
  expectDegradation: false,
  checks: [
    ...MEASUREMENT_CHECKS,
    "disclosure_first",
    "no_early_agent_hangup",
    "no_verbatim_question_repeat",
    "farewell_before_terminal",
    "turn_count_within_budget",
  ],
  mustNotAskSubstrings: [],
  judgeFocus:
    "Bewerte streng, ob der Agent den Personenwechsel bemerkt und der neuen Person sein " +
    "Anliegen knapp neu darlegt. Weiterreden, als spräche er noch mit der ersten Person, " +
    "ist ein FAIL; ebenso Auflegen aus Verwirrung. Ein vollständiger Neustart des " +
    "gesamten Gesprächs ist ein Mangel (Überkorrektur).",
};
