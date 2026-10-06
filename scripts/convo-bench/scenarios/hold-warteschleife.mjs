import { BENCH_MAX_OPENING_CHARS, MEASUREMENT_CHECKS } from "../checks.mjs";

export default {
  id: "hold-warteschleife",
  direction: "outbound",
  assistantContextEnabled: false,
  goal: "Erfragen, ob am Samstag um 19 Uhr ein Tisch für zwei Personen frei ist",
  briefing: null,
  constraints: null,
  context: null,
  personaPrompt:
    "Du arbeitest im Restaurant 'Zur Linde' und bist gerade ans Telefon gegangen. Du hast " +
    "im Reservierungsbuch nachgesehen: Samstag 19 Uhr ist noch ein Tisch für zwei frei. " +
    "Antworte IMMER in GENAU 1 kurzem gesprochenen Satz, KEIN Meta-Kommentar, keine " +
    "Regieanweisungen.",
  scriptedTurns: { 0: "Moment, ich schaue kurz im Buch nach." },
  silentTurns: [1, 2],
  sttNoise: false,
  maxTurns: 8,
  minTurnsBeforeAgentHangup: 5,
  expectDegradation: false,
  drivers: ["texml"],
  maxOpeningChars: BENCH_MAX_OPENING_CHARS,
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
    "Bewerte streng, ob der Agent die Wartezeit aushält: Auflegen oder Themenwechsel " +
    "während der Stille ist ein FAIL. Nach der Rückkehr des Angerufenen muss er an " +
    "SEINE offene Frage anknüpfen, statt das Anliegen neu zu eröffnen.",
};
