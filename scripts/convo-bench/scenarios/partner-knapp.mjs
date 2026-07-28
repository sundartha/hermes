// Szenario "partner-knapp" (Spec §9): outbound, Persona erzwingt 1-3-Wort-Antworten,
// teils unkooperativ. Prueft, ob der Agent auf einsilbige/wortkarge Antworten sinnvoll
// reagiert statt sich zu wiederholen oder das Gespraech abrupt/unhoeflich zu beenden.
import { BENCH_MAX_OPENING_CHARS, MEASUREMENT_CHECKS } from "../checks.mjs";

export default {
  id: "partner-knapp",
  direction: "outbound",
  assistantContextEnabled: false,
  goal: "Termin fuer eine Fahrzeuginspektion in der Werkstatt vereinbaren",
  briefing: null,
  constraints: null,
  context: null,
  personaPrompt:
    "Du bist ein wortkarger, teils unkooperativer Angerufener in einer Autowerkstatt. " +
    "Antworte IMMER in 1-3 Worten, oft einsilbig ('Ja.', 'Nein.', 'Weiss nicht.', " +
    "'Mittwoch vielleicht.'). Kein Meta-Kommentar, keine ganzen ausformulierten Saetze.",
  scriptedTurns: {},
  sttNoise: false,
  maxTurns: 8,
  expectDegradation: false,
  maxOpeningChars: BENCH_MAX_OPENING_CHARS,
  checks: [
    ...MEASUREMENT_CHECKS,
    "no_verbatim_question_repeat",
    "farewell_before_terminal",
    "turn_count_within_budget",
    "no_transliterated_umlauts_de",
  ],
  mustNotAskSubstrings: [],
  judgeFocus:
    "Bewerte besonders, ob der Agent auf einsilbige/unkooperative Antworten angemessen " +
    "reagiert (nachfragt statt zu raten, nicht wortgleich wiederholt) statt das Gespraech " +
    "abrupt oder unhoeflich zu beenden.",
};
